import { object, integer, text, user, date } from './events';
import { parseRepository } from './projects';
import { assetSnapshotStatements, normalizeAssets } from './release-assets';
import { AppError, nowSeconds, type Env } from './types';
import type { AssetReport, ReleaseAsset, DownloadSummary, ReleaseDownload } from '../shared/types';
import { readReleaseCache, cacheState, refreshInBackground, UpstreamError } from './release-cache';

async function github(
  env: Env,
  path: string,
  signal?: AbortSignal,
  allowMissing = false,
): Promise<{ data: unknown; next: boolean }> {
  const cooldown = await env.DB.prepare(
    'SELECT retry_at,error FROM public_api_backoff WHERE host=?',
  )
    .bind('api.github.com')
    .first<{ retry_at: number; error: string }>();
  if (cooldown && cooldown.retry_at > nowSeconds())
    throw new UpstreamError(cooldown.error, cooldown.retry_at);
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RepoTrace',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      // Workers supports only "follow" and "manual". Reject redirects below
      // rather than following an upstream Location outside the GitHub API.
      redirect: 'manual',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
  } catch {
    throw new AppError(502, 'GitHub 公开 Release 接口暂时无法访问，请稍后刷新。');
  }
  if (response.status === 404 && allowMissing) {
    await response.body?.cancel();
    return { data: null, next: false };
  }
  if (!response.ok) {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const limited =
      response.status === 429 ||
      (response.status === 403 && (remaining === '0' || response.headers.has('Retry-After')));
    const reset = Number(response.headers.get('X-RateLimit-Reset'));
    const after = response.headers.get('Retry-After');
    const retry = Math.max(
      nowSeconds() + 60,
      Math.min(
        nowSeconds() + 3600,
        limited && reset > nowSeconds()
          ? reset
          : after && /^\d+$/.test(after)
            ? nowSeconds() + Number(after)
            : nowSeconds() + 120,
      ),
    );
    await response.body?.cancel();
    const message = limited
      ? 'GitHub 公开接口暂时限流，已保留缓存，稍后访问时再尝试刷新。'
      : response.status === 403
        ? 'GitHub 暂时拒绝公开接口访问（HTTP 403），已保留缓存。'
        : `GitHub 公开 Release 数据暂时无法刷新（HTTP ${response.status}），已保留缓存。`;
    if ([403, 429].includes(response.status)) {
      await env.DB.prepare(
        'INSERT INTO public_api_backoff(host,retry_at,error) VALUES (?,?,?) ON CONFLICT(host) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at),error=excluded.error',
      )
        .bind('api.github.com', retry, message)
        .run();
    }
    throw new UpstreamError(message, retry);
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
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'GitHub 数据传输中断，已保留缓存。');
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
async function source(env: Env, id: string, signal?: AbortSignal) {
  const project = await env.DB.prepare('SELECT github_id,full_name FROM projects WHERE id=?')
    .bind(id)
    .first<{ github_id: number | null; full_name: string }>();
  if (!project) throw new AppError(404, '项目不存在。');
  const cached = await readReleaseCache(env.DB, id, 'source');
  if (cached?.payload && cached.updated_at && nowSeconds() - cached.updated_at < 300) {
    const value = JSON.parse(cached.payload) as { githubId: number; name: string; path: string };
    if (project.github_id === value.githubId && project.full_name === value.name) return value;
  }
  const repo = object(
    (
      await github(
        env,
        `/repos/${project.full_name.split('/').map(encodeURIComponent).join('/')}`,
        signal,
      )
    ).data,
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
  const bound = await env.DB.prepare(
    'UPDATE projects SET github_id=?,full_name=? WHERE id=? AND (github_id IS NULL OR github_id=?)',
  )
    .bind(githubId, name, id, githubId)
    .run();
  if (!bound.meta.changes) throw new AppError(409, '仓库身份已变化，已保留原缓存。');
  const value = {
    githubId,
    name,
    path: `/repos/${name.split('/').map(encodeURIComponent).join('/')}`,
  };
  await env.DB.prepare(
    'INSERT INTO release_refresh(project_id,resource,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id,resource) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
  )
    .bind(id, 'source', JSON.stringify(value), nowSeconds())
    .run();
  return value;
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
export async function syncPublicReleases(
  env: Env,
  project: string,
  page: number,
  signal?: AbortSignal,
) {
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new AppError(400, '版本页码无效。');
  const at = nowSeconds();
  const repo = await source(env, project, signal);
  const result = await github(env, `${repo.path}/releases?per_page=30&page=${page}`, signal);
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
export async function refreshPublicAssets(
  env: Env,
  project: string,
  release: number,
  signal?: AbortSignal,
) {
  const existing = await assetReport(env.DB, project, release);
  if (existing.deleted) return existing;
  const started = nowSeconds();
  const repo = await source(env, project, signal);
  const metadata = publicMetadata(
    (await github(env, `${repo.path}/releases/${release}`, signal)).data,
  );
  if (metadata.id !== release) throw new AppError(502, 'GitHub 返回的版本身份不一致。');
  const assets: unknown[] = [];
  for (let page = 1; page <= 20; page++) {
    const result = await github(
      env,
      `${repo.path}/releases/${release}/assets?per_page=100&page=${page}`,
      signal,
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

export async function cachedCatalog(
  env: Env,
  project: string,
  page: number,
  ctx: ExecutionContext,
) {
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new AppError(400, '版本页码无效。');
  const resource = `catalog:${page}`;
  const row = await readReleaseCache(env.DB, project, resource);
  const saved = row?.payload
    ? (JSON.parse(row.payload) as { nextPage: number | null; count: number })
    : null;
  const old = await env.DB.prepare(
    'SELECT next_page,updated_at FROM release_catalog_sync WHERE project_id=? AND last_page=?',
  )
    .bind(project, page)
    .first<{ next_page: number | null; updated_at: number }>();
  const report = {
    nextPage: saved?.nextPage ?? old?.next_page ?? null,
    count: saved?.count ?? 0,
    updatedAt: row?.updated_at ?? old?.updated_at ?? null,
    cache: { ...cacheState(row), updatedAt: row?.updated_at ?? old?.updated_at ?? null },
  };
  refreshInBackground(env, project, resource, ctx, (signal) =>
    syncPublicReleases(env, project, page, signal),
  );
  return report;
}
export async function cachedDownloads(
  env: Env,
  project: string,
  ctx: ExecutionContext,
): Promise<DownloadSummary> {
  const row = await readReleaseCache(env.DB, project, 'downloads');
  const payload = row?.payload ? (JSON.parse(row.payload) as DownloadSummary) : null;
  const saved = payload?.source === 'github' ? payload : null;
  const report: DownloadSummary = {
    total: saved?.total ?? null,
    latest: saved?.latest ?? null,
    source: 'github',
    releases: saved?.releases ?? [],
    cache: cacheState(row),
  };
  refreshInBackground(env, project, 'downloads', ctx, async (signal) => {
    const repo = await source(env, project, signal);
    let total = 0n;
    const versions: ReleaseDownload[] = [];
    const sum = (input: unknown) => {
      if (!Array.isArray(input)) throw new AppError(502, 'GitHub 返回的下载量清单无效。');
      return input.reduce((value: bigint, raw: unknown) => {
        const count = object(raw).download_count;
        if (!Number.isSafeInteger(count) || (count as number) < 0)
          throw new AppError(502, 'GitHub 产物下载量缺失，已保留缓存。');
        return value + BigInt(count as number);
      }, 0n);
    };
    for (let page = 1; page <= 20; page++) {
      const result = await github(env, `${repo.path}/releases?per_page=100&page=${page}`, signal);
      if (!Array.isArray(result.data) || result.data.length > 100)
        throw new AppError(502, 'GitHub 返回的版本清单无效。');
      for (const raw of result.data) {
        const r = object(raw);
        if (r.draft || !r.published_at) continue;
        const downloads = sum(r.assets);
        total += downloads;
        versions.push({
          id: integer(r.id),
          tag: text(r.tag_name, 255),
          name: typeof r.name === 'string' ? r.name : text(r.tag_name, 255),
          publishedAt: date(r.published_at)!,
          prerelease: !!r.prerelease,
          downloads: String(downloads),
        });
      }
      if (!result.next) break;
      if (page === 20) throw new AppError(502, '版本下载量尚未完整汇总，已保留缓存。');
    }
    const latest = versions.length
      ? (await github(env, `${repo.path}/releases/latest`, signal, true)).data
      : null;
    return {
      total: String(total),
      latest: latest === null ? null : String(sum(object(latest).assets)),
      source: 'github',
      releases: versions,
    };
  });
  return report;
}
export async function cachedAssets(
  env: Env,
  project: string,
  release: number,
  ctx: ExecutionContext,
): Promise<AssetReport> {
  const report = await assetReport(env.DB, project, release);
  const resource = `assets:${release}`;
  const row = await readReleaseCache(env.DB, project, resource);
  report.cache = { ...cacheState(row), updatedAt: report.observedAt ?? row?.updated_at ?? null };
  refreshInBackground(env, project, resource, ctx, async (signal) => {
    await refreshPublicAssets(env, project, release, signal);
    return {};
  });
  return report;
}
