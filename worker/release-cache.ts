import type { ReleaseCacheState } from '../shared/types';
import { AppError, nowSeconds, type Env } from './types';

export interface CacheRow {
  updated_at: number | null;
  error: string | null;
  retry_at: number;
  lease_until: number;
  payload: string | null;
}
export async function readReleaseCache(db: D1Database, project: string, resource: string) {
  return db
    .prepare('SELECT * FROM release_refresh WHERE project_id=? AND resource=?')
    .bind(project, resource)
    .first<CacheRow>();
}
export function cacheState(row: CacheRow | null): ReleaseCacheState {
  return {
    updatedAt: row?.updated_at ?? null,
    error: row?.error ?? null,
    retryAt: row?.retry_at ? row.retry_at : null,
    refreshRequested: (row?.retry_at ?? 0) <= nowSeconds(),
  };
}
export class UpstreamError extends AppError {
  constructor(
    message: string,
    public retryAt: number,
  ) {
    super(502, message);
  }
}

// The response is always built from the snapshot read before this task starts.
// A D1 lease coalesces refreshes across requests and Worker isolates.
export function refreshInBackground(
  env: Env,
  project: string,
  resource: string,
  ctx: ExecutionContext,
  refresh: (signal: AbortSignal) => Promise<unknown>,
) {
  ctx.waitUntil(
    (async () => {
      const at = nowSeconds();
      const token = crypto.randomUUID();
      const lease = await env.DB.prepare(
        `INSERT INTO release_refresh(project_id,resource,lease_token,lease_until)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=?)
      ON CONFLICT(project_id,resource) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until
      WHERE release_refresh.lease_until<=? AND release_refresh.retry_at<=? RETURNING lease_token`,
      )
        .bind(project, resource, token, at + 35, project, at, at)
        .first();
      if (!lease) return;
      try {
        const payload = await refresh(AbortSignal.timeout(25000));
        await env.DB.prepare(
          `UPDATE release_refresh SET updated_at=?,error=NULL,retry_at=0,lease_token=NULL,lease_until=0,payload=?
        WHERE project_id=? AND resource=? AND lease_token=?`,
        )
          .bind(nowSeconds(), JSON.stringify(payload ?? null), project, resource, token)
          .run();
      } catch (error) {
        const message =
          error instanceof AppError ? error.message : '后台刷新暂时失败，已保留上次缓存。';
        const retry = error instanceof UpstreamError ? error.retryAt : nowSeconds() + 60;
        await env.DB.prepare(
          `UPDATE release_refresh SET error=?,retry_at=?,lease_token=NULL,lease_until=0
        WHERE project_id=? AND resource=? AND lease_token=?`,
        )
          .bind(message, retry, project, resource, token)
          .run();
      }
    })().catch(() => {
      console.error('Release cache refresh failed');
    }),
  );
}
