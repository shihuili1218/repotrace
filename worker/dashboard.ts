import type { Dashboard, Repository, Snapshot, StarChange } from '../shared/types';
import { localDay } from './monitors/stars';
import { AppError, nowSeconds } from './types';

export async function dashboard(db: D1Database, url: URL): Promise<Dashboard> {
  const repoId = url.searchParams.get('repo') || null;
  const snapshotId = url.searchParams.get('snapshot') || null;
  const kind = url.searchParams.get('kind') || 'all';
  const days = Number(url.searchParams.get('days') || 30);
  const page = Number(url.searchParams.get('page') || 1);
  if (
    ![7, 30, 90].includes(days) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !['all', 'added', 'removed'].includes(kind)
  )
    throw new AppError(400, '筛选参数无效。');
  const [repoResult, recent, list, history] = await Promise.all([
    db
      .prepare(
        `SELECT r.*, EXISTS(SELECT 1 FROM repository_tokens t WHERE t.repo_id = r.id) AS token_configured
      FROM repositories r ORDER BY created_at,full_name`,
      )
      .all<Repository & { token_configured: number }>(),
    db
      .prepare(
        `SELECT * FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY repo_id,status ORDER BY started_at DESC,rowid DESC) AS rn FROM snapshots s) WHERE rn = 1`,
      )
      .all<Snapshot>(),
    db
      .prepare(
        `SELECT s.*, r.full_name, p.day AS comparison_day FROM snapshots s JOIN repositories r ON r.id = s.repo_id
      LEFT JOIN snapshots p ON p.id = s.comparison_id WHERE (? IS NULL OR s.repo_id = ?) ORDER BY s.started_at DESC,s.rowid DESC LIMIT 100`,
      )
      .bind(repoId, repoId)
      .all<Snapshot & { full_name: string; comparison_day: string | null }>(),
    db
      .prepare(
        `WITH RECURSIVE days(day) AS (SELECT ? UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < ?)
      SELECT d.day,
        COALESCE(SUM(COALESCE((SELECT s.total FROM snapshots s WHERE s.repo_id = r.id AND s.status = 'complete'
          AND s.kind IN ('daily','baseline') AND s.day <= d.day ORDER BY s.day DESC,s.started_at DESC,s.rowid DESC LIMIT 1),0)),0) AS total,
        (SELECT COALESCE(SUM(s.added),0) FROM snapshots s WHERE s.day = d.day AND s.kind = 'daily' AND s.status = 'complete' AND (? IS NULL OR s.repo_id = ?)) AS added,
        (SELECT COALESCE(SUM(s.removed),0) FROM snapshots s WHERE s.day = d.day AND s.kind = 'daily' AND s.status = 'complete' AND (? IS NULL OR s.repo_id = ?)) AS removed,
        COUNT(CASE WHEN EXISTS (SELECT 1 FROM snapshots s WHERE s.repo_id = r.id AND s.status = 'complete' AND s.kind IN ('daily','baseline') AND s.day <= d.day) THEN 1 END) AS repos
      FROM days d LEFT JOIN repositories r ON (? IS NULL OR r.id = ?) GROUP BY d.day ORDER BY d.day`,
      )
      .bind(
        localDay(nowSeconds() - (days - 1) * 86400),
        localDay(nowSeconds()),
        repoId,
        repoId,
        repoId,
        repoId,
        repoId,
        repoId,
      )
      .all<Dashboard['history'][number]>(),
  ]);
  if (repoId && !repoResult.results.some((repo) => repo.id === repoId))
    throw new AppError(404, '仓库不存在。');
  if (
    snapshotId &&
    !(await db
      .prepare(
        "SELECT 1 FROM snapshots WHERE id = ? AND status = 'complete' AND (? IS NULL OR repo_id = ?)",
      )
      .bind(snapshotId, repoId, repoId)
      .first())
  )
    throw new AppError(404, '完整快照不存在。');
  const selected = `WITH latest AS (SELECT id FROM (SELECT id,ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY started_at DESC,rowid DESC) AS rn
    FROM snapshots WHERE status = 'complete' AND (? IS NULL OR repo_id = ?)) WHERE rn = 1)
    SELECT c.*, r.full_name, s.completed_at AS observed_at FROM star_changes c JOIN snapshots s ON s.id = c.snapshot_id
    JOIN repositories r ON r.id = s.repo_id WHERE s.status = 'complete' AND (? IS NULL OR s.repo_id = ?)
    AND ((? IS NOT NULL AND c.snapshot_id = ?) OR (? IS NULL AND c.snapshot_id IN (SELECT id FROM latest))) AND (? = 'all' OR c.kind = ?)`;
  const params = [repoId, repoId, repoId, repoId, snapshotId, snapshotId, snapshotId, kind, kind];
  const [changes, count] = await Promise.all([
    db
      .prepare(`${selected} ORDER BY s.completed_at DESC,c.login COLLATE NOCASE LIMIT 30 OFFSET ?`)
      .bind(...params, (page - 1) * 30)
      .all<StarChange>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM (${selected})`)
      .bind(...params)
      .first<{ count: number }>(),
  ]);
  return {
    repositories: repoResult.results.map(({ token_configured, ...repo }) => ({
      ...repo,
      tokenConfigured: !!token_configured,
      latest: recent.results.find((s) => s.repo_id === repo.id && s.status === 'complete') ?? null,
      active:
        recent.results.find((s) => s.repo_id === repo.id && s.status === 'collecting') ?? null,
      lastError: (() => {
        const failed = recent.results.find((s) => s.repo_id === repo.id && s.status === 'failed');
        const success = recent.results.find(
          (s) => s.repo_id === repo.id && s.status === 'complete',
        );
        return failed && (!success || failed.started_at >= success.started_at)
          ? failed.error
          : null;
      })(),
    })),
    history: history.results,
    snapshots: list.results,
    changes: changes.results,
    changeTotal: count?.count ?? 0,
    page,
  };
}
