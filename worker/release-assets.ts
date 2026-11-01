import { AppError } from './types';
export interface AssetInput {
  id: number;
  name: string;
  size: number;
  content_type: string;
  state: string;
  download_count: number | null;
  download_url: string | null;
}
export function normalizeAssets(input: unknown, name: string): AssetInput[] | null {
  if (input === undefined) return null;
  if (!Array.isArray(input) || input.length > 2000)
    throw new AppError(400, 'Release 产物数据无效。');
  const seen = new Set<number>();
  const rows = input.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new AppError(400, 'Release 产物数据无效。');
    const a = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(a.id) ||
      (a.id as number) <= 0 ||
      typeof a.name !== 'string' ||
      !a.name ||
      a.name.length > 255 ||
      !Number.isSafeInteger(a.size) ||
      (a.size as number) < 0
    )
      throw new AppError(400, 'Release 产物字段无效。');
    if (seen.has(a.id as number)) throw new AppError(400, 'Release 产物 ID 重复。');
    seen.add(a.id as number);
    const downloads = a.download_count;
    if (
      downloads !== undefined &&
      downloads !== null &&
      (!Number.isSafeInteger(downloads) || (downloads as number) < 0)
    )
      throw new AppError(400, '产物下载量无效。');
    let link: string | null = null;
    if (typeof a.browser_download_url === 'string') {
      try {
        const url = new URL(a.browser_download_url);
        if (
          url.protocol === 'https:' &&
          url.hostname === 'github.com' &&
          !url.port &&
          !url.username &&
          !url.password &&
          url.pathname.toLowerCase().startsWith(`/${name.toLowerCase()}/releases/download/`)
        ) {
          url.search = '';
          url.hash = '';
          link = url.href;
        }
      } catch {
        /* Keep an unusable link out of the page. */
      }
    }
    return {
      id: a.id as number,
      name: a.name,
      size: a.size as number,
      content_type:
        typeof a.content_type === 'string'
          ? a.content_type.slice(0, 255)
          : 'application/octet-stream',
      state: a.state === 'open' ? 'open' : 'uploaded',
      download_count: typeof downloads === 'number' ? downloads : null,
      download_url: link,
    };
  });
  if (new TextEncoder().encode(JSON.stringify(rows)).length > 1800000)
    throw new AppError(413, '产物信息过多，暂时无法保存完整清单。');
  return rows;
}
export function assetSnapshotStatements(
  db: D1Database,
  project: string,
  release: number,
  assets: AssetInput[] | null,
  at: number,
  source: 'webhook' | 'github',
  guard = '1',
  params: (string | number | null)[] = [],
): D1PreparedStatement[] {
  if (assets === null) return [];
  const snapshot = crypto.randomUUID();
  return [
    db
      .prepare(
        `UPDATE releases SET assets_seen_at=?,assets_source=?,assets_snapshot_id=? WHERE project_id=? AND github_id=? AND COALESCE(assets_seen_at,0)<=? AND (${guard})`,
      )
      .bind(at, source, snapshot, project, release, at, ...params),
    db
      .prepare(
        'DELETE FROM release_assets WHERE project_id=? AND release_id=? AND EXISTS(SELECT 1 FROM releases WHERE project_id=? AND github_id=? AND assets_snapshot_id=?)',
      )
      .bind(project, release, project, release, snapshot),
    db
      .prepare(
        `INSERT INTO release_assets(project_id,release_id,github_id,name,size,content_type,state,download_count,download_url,observed_at)
      SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.size'),json_extract(value,'$.content_type'),json_extract(value,'$.state'),json_extract(value,'$.download_count'),json_extract(value,'$.download_url'),?
      FROM json_each(?) WHERE EXISTS(SELECT 1 FROM releases WHERE project_id=? AND github_id=? AND assets_snapshot_id=?)`,
      )
      .bind(project, release, at, JSON.stringify(assets), project, release, snapshot),
  ];
}
