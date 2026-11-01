import { object, integer, text, user, date } from './events';
import { parseRepository } from './projects';
import { assetSnapshotStatements, normalizeAssets } from './release-assets';
import { AppError, nowSeconds, type Env } from './types';
import type { AssetReport, ReleaseAsset } from '../shared/types';

async function github(path: string): Promise<{ data: unknown; next: boolean }> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RepoTrace',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AppError(502, 'GitHub 公开 Release 接口暂时无法访问，请稍后刷新。');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      502,
      `公开 Release 数据读取失败（HTTP ${response.status}）。请确认仓库和版本公开可访问，已有快照会保留。`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AppError(502, 'GitHub 返回了空数据。');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new AppError(502, 'GitHub 返回的版本数据过大。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(502, 'GitHub 返回的版本数据无效。');
  }
  return { data, next: /(?:^|,)\s*<[^>]+>;\s*rel="next"/.test(response.headers.get('Link') ?? '') };
}
async function source(env: Env, id: string) {
  const project = await env.DB.prepare('SELECT github_id,full_name FROM projects WHERE id=?')
    .bind(id)
    .first<{ github_id: number | null; full_name: string }>();
  if (!project) throw new AppError(404, '项目不存在。');
  const repo = object(
    (await github(`/repos/${project.full_name.split('/').map(encodeURIComponent).join('/')}`)).data,
  );
  const githubId = integer(repo.id);
  const name = parseRepository(repo.full_name);
  if (repo.private === true)
    throw new AppError(409, '下载量刷新目前只支持公开仓库；已收到的 Webhook 快照仍可查看。');
  if (project.github_id !== null && project.github_id !== githubId)
    throw new AppError(409, '仓库身份已变化，已停止刷新，请检查项目地址。');
  const duplicate = await env.DB.prepare('SELECT 1 FROM projects WHERE github_id=? AND id<>?')
    .bind(githubId, id)
    .first();
  if (duplicate) throw new AppError(409, '此仓库已在另一个项目中，请使用已有项目。');
  return { githubId, name, path: `/repos/${name.split('/').map(encodeURIComponent).join('/')}` };
}
function publicMetadata(input: unknown) {
  const r = object(input);
  return {
    id: integer(r.id),
    tag: text(r.tag_name, 255),
    name: typeof r.name === 'string' ? r.name.slice(0, 500) : text(r.tag_name, 255),
    author: user(r.author).login,
    prerelease: Number(!!r.prerelease),
    draft: Number(!!r.draft),
    created: date(r.created_at, nowSeconds()),
    published: date(r.published_at),
  };
}
function metadataStatement(
  db: D1Database,
  project: string,
  records: ReturnType<typeof publicMetadata>[],
  at: number,
) {
  return db
    .prepare(
      `INSERT INTO releases(project_id,github_id,tag_name,name,author_login,prerelease,draft,created_at,published_at,first_seen_at,last_delivery_seq,metadata_observed_at)
    SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.tag'),json_extract(value,'$.name'),json_extract(value,'$.author'),json_extract(value,'$.prerelease'),json_extract(value,'$.draft'),json_extract(value,'$.created'),json_extract(value,'$.published'),?,0,? FROM json_each(?) WHERE 1
    ON CONFLICT(project_id,github_id) DO UPDATE SET tag_name=excluded.tag_name,name=excluded.name,author_login=excluded.author_login,prerelease=excluded.prerelease,draft=excluded.draft,created_at=excluded.created_at,published_at=excluded.published_at,metadata_observed_at=excluded.metadata_observed_at
    WHERE releases.deleted_at IS NULL AND releases.metadata_observed_at<=excluded.metadata_observed_at`,
    )
    .bind(project, at, at, JSON.stringify(records));
}
export async function syncPublicReleases(env: Env, project: string, page: number) {
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new AppError(400, '版本页码无效。');
  const cached = await env.DB.prepare(
    'SELECT last_page,next_page,updated_at FROM release_catalog_sync WHERE project_id=?',
  )
    .bind(project)
    .first<{ last_page: number; next_page: number | null; updated_at: number }>();
  if (cached && cached.last_page === page && nowSeconds() - cached.updated_at < 30)
    return { nextPage: cached.next_page, updatedAt: cached.updated_at, cached: true };
  const at = nowSeconds();
  const repo = await source(env, project);
  const result = await github(`${repo.path}/releases?per_page=30&page=${page}`);
  if (!Array.isArray(result.data) || result.data.length > 30)
    throw new AppError(502, 'GitHub 返回的 Release 列表无效。');
  const records = result.data.map(publicMetadata).filter((r) => !r.draft && r.published !== null);
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE projects SET github_id=?,full_name=? WHERE id=? AND (github_id IS NULL OR github_id=?)',
    ).bind(repo.githubId, repo.name, project, repo.githubId),
    metadataStatement(env.DB, project, records, at),
    env.DB.prepare(
      'INSERT INTO release_catalog_sync(project_id,last_page,next_page,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET last_page=excluded.last_page,next_page=excluded.next_page,updated_at=excluded.updated_at',
    ).bind(project, page, result.next ? page + 1 : null, nowSeconds()),
  ]);
  return {
    nextPage: result.next ? page + 1 : null,
    updatedAt: nowSeconds(),
    count: records.length,
    cached: false,
  };
}
export async function assetReport(
  db: D1Database,
  project: string,
  release: number,
): Promise<AssetReport> {
  const version = await db
    .prepare(
      'SELECT github_id,tag_name,assets_seen_at,assets_source,deleted_at FROM releases WHERE project_id=? AND github_id=?',
    )
    .bind(project, release)
    .first<{
      github_id: number;
      tag_name: string;
      assets_seen_at: number | null;
      assets_source: 'webhook' | 'github' | null;
      deleted_at: number | null;
    }>();
  if (!version) throw new AppError(404, '版本不存在。');
  const rows = await db
    .prepare(
      'SELECT * FROM release_assets WHERE project_id=? AND release_id=? ORDER BY name COLLATE NOCASE,github_id',
    )
    .bind(project, release)
    .all<ReleaseAsset>();
  return {
    releaseId: version.github_id,
    tag: version.tag_name,
    observedAt: version.assets_seen_at,
    source: version.assets_source,
    deleted: version.deleted_at !== null,
    assets: rows.results,
  };
}
export async function refreshPublicAssets(env: Env, project: string, release: number) {
  const existing = await assetReport(env.DB, project, release);
  if (existing.deleted) return existing;
  if (
    existing.source === 'github' &&
    existing.observedAt !== null &&
    nowSeconds() - existing.observedAt < 30
  )
    return existing;
  const started = nowSeconds();
  const repo = await source(env, project);
  const metadata = publicMetadata((await github(`${repo.path}/releases/${release}`)).data);
  if (metadata.id !== release) throw new AppError(502, 'GitHub 返回的版本身份不一致。');
  const assets: unknown[] = [];
  for (let page = 1; page <= 20; page++) {
    const result = await github(
      `${repo.path}/releases/${release}/assets?per_page=100&page=${page}`,
    );
    if (!Array.isArray(result.data) || result.data.length > 100)
      throw new AppError(502, 'GitHub 返回的产物清单无效。');
    assets.push(...result.data);
    if (!result.next) break;
    if (page === 20) throw new AppError(502, '产物清单尚未完整读取，已有快照会保留。');
  }
  const normalized = normalizeAssets(assets, repo.name);
  const at = nowSeconds();
  await env.DB.batch([
    metadataStatement(env.DB, project, [metadata], started),
    ...assetSnapshotStatements(
      env.DB,
      project,
      release,
      normalized,
      at,
      'github',
      'deleted_at IS NULL',
    ),
  ]);
  return assetReport(env.DB, project, release);
}
