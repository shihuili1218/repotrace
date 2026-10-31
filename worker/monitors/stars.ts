import type { Snapshot } from '../../shared/types';
import { github, GitHubError, type StarProvider } from '../github';
import { type Env, nowSeconds, AppError } from '../types';

export const starMonitor = { key: 'stars', label: 'Star 监控', version: 1 } as const;
const PAGE_BUDGET = 6; // Bounded work per invocation; cron resumes persisted pages every minute.
const LEASE_SECONDS = 180;

export function localDay(seconds: number) {
  return new Date((seconds + 8 * 3600) * 1000).toISOString().slice(0, 10);
}
export function latestDue(now: number, hour: number) {
  const today = localDay(now);
  let due = Math.floor(Date.parse(`${today}T${String(hour).padStart(2, '0')}:00:00+08:00`) / 1000);
  if (due > now) due -= 86400;
  return { day: localDay(due), at: due };
}

export async function enqueueSnapshot(
  db: D1Database,
  repoId: string,
  kind: Snapshot['kind'],
  day = localDay(nowSeconds()),
  startedAt = nowSeconds(),
) {
  const active = await db
    .prepare("SELECT id FROM snapshots WHERE repo_id = ? AND status = 'collecting'")
    .bind(repoId)
    .first<{ id: string }>();
  if (active) return active.id;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT OR IGNORE INTO snapshots(id,repo_id,kind,day,started_at)
    SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM repositories WHERE id = ? AND enabled = 1)`,
    )
    .bind(id, repoId, kind, day, startedAt, repoId)
    .run();
  const created = await db
    .prepare('SELECT id FROM snapshots WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (created) return created.id;
  const other = await db
    .prepare(
      "SELECT id FROM snapshots WHERE repo_id = ? AND (status = 'collecting' OR (kind = 'daily' AND day = ?)) ORDER BY started_at DESC LIMIT 1",
    )
    .bind(repoId, day)
    .first<{ id: string }>();
  return other?.id ?? null;
}

export async function enqueueDue(db: D1Database, now = nowSeconds()) {
  const setting = await db
    .prepare("SELECT value FROM monitor_settings WHERE key = 'daily_hour'")
    .first<{ value: string }>();
  const due = latestDue(now, Number(setting?.value ?? '23'));
  // Only monitor dates after the project was added; never invent historical snapshots.
  const repos = await db
    .prepare(
      `SELECT id FROM repositories r WHERE enabled = 1 AND created_at <= ?
    AND NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.repo_id = r.id AND s.kind = 'daily' AND s.day = ?)
    AND NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.repo_id = r.id AND s.status = 'collecting')`,
    )
    .bind(due.at, due.day)
    .all<{ id: string }>();
  for (const repo of repos.results) await enqueueSnapshot(db, repo.id, 'daily', due.day, now);
}

async function completeSnapshot(db: D1Database, snapshot: Snapshot, token: string, count: number) {
  // Daily snapshots compare ONLY with prior daily snapshots (falling back to baseline).
  const comparison =
    snapshot.kind === 'daily'
      ? await db
          .prepare(
            `SELECT id FROM snapshots WHERE repo_id = ? AND status = 'complete' AND id != ?
        AND ((kind = 'daily' AND day < ?) OR (kind = 'baseline' AND day <= ?))
        ORDER BY day DESC, CASE kind WHEN 'daily' THEN 0 ELSE 1 END, started_at DESC, rowid DESC LIMIT 1`,
          )
          .bind(snapshot.repo_id, snapshot.id, snapshot.day, snapshot.day)
          .first<{ id: string }>()
      : await db
          .prepare(
            `SELECT id FROM snapshots WHERE repo_id = ? AND status = 'complete' AND id != ? AND started_at <= ?
        ORDER BY started_at DESC, rowid DESC LIMIT 1`,
          )
          .bind(snapshot.repo_id, snapshot.id, snapshot.started_at)
          .first<{ id: string }>();
  const previous = comparison?.id ?? null;
  const guard = `EXISTS (SELECT 1 FROM snapshots WHERE id = ? AND lease_token = ? AND status = 'collecting')`;
  const statements: D1PreparedStatement[] = [];
  if (previous) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO star_changes(snapshot_id,user_id,login,kind,starred_at)
        SELECT ?, m.user_id, m.login, 'added', m.starred_at FROM snapshot_members m
        WHERE m.snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM snapshot_members p WHERE p.snapshot_id = ? AND p.user_id = m.user_id) AND ${guard}`,
        )
        .bind(snapshot.id, snapshot.id, previous, snapshot.id, token),
      db
        .prepare(
          `INSERT OR IGNORE INTO star_changes(snapshot_id,user_id,login,kind,starred_at)
        SELECT ?, p.user_id, p.login, 'removed', p.starred_at FROM snapshot_members p
        WHERE p.snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM snapshot_members m WHERE m.snapshot_id = ? AND m.user_id = p.user_id) AND ${guard}`,
        )
        .bind(snapshot.id, previous, snapshot.id, snapshot.id, token),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE snapshots SET status = 'complete', total = ?, comparison_id = ?, completed_at = ?,
    added = (SELECT COUNT(*) FROM star_changes WHERE snapshot_id = ? AND kind = 'added'),
    removed = (SELECT COUNT(*) FROM star_changes WHERE snapshot_id = ? AND kind = 'removed'),
    error = NULL, lease_token = NULL, lease_until = 0 WHERE id = ? AND lease_token = ? AND status = 'collecting'`,
      )
      .bind(count, previous, nowSeconds(), snapshot.id, snapshot.id, snapshot.id, token),
  );
  // D1 batch is transactional: the diff and completed flag are published together.
  await db.batch(statements);
}

export async function collectStars(
  env: Env,
  provider: StarProvider = github(env),
  budget = PAGE_BUDGET,
) {
  const db = env.DB;
  const candidates = await db
    .prepare(
      `SELECT s.*, r.full_name, r.github_id FROM snapshots s JOIN repositories r ON r.id = s.repo_id
    WHERE s.status = 'collecting' AND r.enabled = 1 AND s.retry_at <= ? AND s.lease_until <= ?
    ORDER BY s.started_at, s.rowid LIMIT 3`,
    )
    .bind(nowSeconds(), nowSeconds())
    .all<Snapshot & { full_name: string; github_id: number }>();
  let pages = 0;
  for (const candidate of candidates.results) {
    if (pages >= budget) break;
    const token = crypto.randomUUID();
    const leased = await db
      .prepare(
        `UPDATE snapshots SET lease_token = ?, lease_until = ? WHERE id = ? AND status = 'collecting' AND lease_until <= ? RETURNING *`,
      )
      .bind(token, nowSeconds() + LEASE_SECONDS, candidate.id, nowSeconds())
      .first<Snapshot>();
    if (!leased) continue;
    // Re-read the checkpoint atomically with the lease, not from the earlier candidate list.
    const snapshot = { ...candidate, ...leased };
    try {
      const repo = await provider.repository(snapshot.full_name);
      if (repo.id !== snapshot.github_id)
        throw new GitHubError('仓库身份已变化，请移除后重新添加该仓库。');
      await db
        .prepare('UPDATE snapshots SET expected_total = ? WHERE id = ? AND lease_token = ?')
        .bind(repo.stargazers_count, snapshot.id, token)
        .run();
      await db
        .prepare(
          'UPDATE repositories SET full_name = ?, description = ?, language = ? WHERE id = ?',
        )
        .bind(repo.full_name, repo.description ?? '', repo.language, snapshot.repo_id)
        .run();
      for (; pages < budget;) {
        const page = await provider.stargazers(repo.full_name, snapshot.page);
        pages++;
        await db.batch([
          db
            .prepare(
              `INSERT OR REPLACE INTO snapshot_members(snapshot_id,user_id,login,starred_at)
            SELECT ?, json_extract(value,'$.id'), json_extract(value,'$.login'), json_extract(value,'$.starred_at') FROM json_each(?)
            WHERE EXISTS (SELECT 1 FROM snapshots WHERE id = ? AND lease_token = ? AND status = 'collecting')`,
            )
            .bind(snapshot.id, JSON.stringify(page.users), snapshot.id, token),
          db
            .prepare(
              `UPDATE snapshots SET page = ?, total = (SELECT COUNT(*) FROM snapshot_members WHERE snapshot_id = ?),
            failures = 0, error = NULL, retry_at = 0, lease_until = ? WHERE id = ? AND lease_token = ? AND status = 'collecting'`,
            )
            .bind(snapshot.page + 1, snapshot.id, nowSeconds() + LEASE_SECONDS, snapshot.id, token),
        ]);
        snapshot.page++;
        if (!page.hasNext) {
          const finalRepo = await provider.repository(repo.full_name);
          const result = await db
            .prepare('SELECT COUNT(*) AS count FROM snapshot_members WHERE snapshot_id = ?')
            .bind(snapshot.id)
            .first<{ count: number }>();
          // A shifting paginated set can miss users. Refuse obviously incomplete results.
          if (finalRepo.id !== snapshot.github_id || result?.count !== finalRepo.stargazers_count) {
            throw new GitHubError(
              '采集期间 Star 数量发生变化，完整性检查未通过。请重试快照；上一份有效数据仍保留。',
            );
          }
          await completeSnapshot(db, snapshot, token, result.count);
          break;
        }
      }
    } catch (error) {
      const failure =
        error instanceof GitHubError
          ? error
          : new GitHubError('快照暂时采集失败，将自动重试。', 0, true);
      const retry = failure.transient && (failure.retryAt > 0 || snapshot.failures < 4);
      await db
        .prepare(
          `UPDATE snapshots SET status = ?, error = ?, failures = failures + 1, retry_at = ?, lease_token = NULL, lease_until = 0
        WHERE id = ? AND lease_token = ? AND status = 'collecting'`,
        )
        .bind(
          retry ? 'collecting' : 'failed',
          failure.message,
          failure.retryAt || nowSeconds() + Math.min(3600, 60 * 2 ** snapshot.failures),
          snapshot.id,
          token,
        )
        .run();
      // Failed partial snapshots never produce changes. Leave previous complete snapshot intact.
    } finally {
      await db
        .prepare(
          'UPDATE snapshots SET lease_token = NULL, lease_until = 0 WHERE id = ? AND lease_token = ?',
        )
        .bind(snapshot.id, token)
        .run();
    }
  }
}

export async function retrySnapshot(db: D1Database, id: string) {
  const snapshot = await db
    .prepare('SELECT * FROM snapshots WHERE id = ?')
    .bind(id)
    .first<Snapshot>();
  if (!snapshot) throw new AppError(404, '快照不存在。');
  if (snapshot.status !== 'failed') throw new AppError(409, '只能重试失败的快照。');
  const repo = await db
    .prepare('SELECT enabled FROM repositories WHERE id = ?')
    .bind(snapshot.repo_id)
    .first<{ enabled: number }>();
  if (!repo?.enabled) throw new AppError(409, '请先恢复此仓库的监控。');
  if (
    await db
      .prepare("SELECT 1 FROM snapshots WHERE repo_id = ? AND status = 'collecting'")
      .bind(snapshot.repo_id)
      .first()
  )
    throw new AppError(409, '此仓库已有快照正在采集。');
  const setting = await db
    .prepare("SELECT value FROM monitor_settings WHERE key = 'daily_hour'")
    .first<{ value: string }>();
  const currentDay =
    snapshot.kind === 'daily'
      ? latestDue(nowSeconds(), Number(setting?.value ?? 23)).day
      : localDay(nowSeconds());
  // Retrying an old date cannot recreate its historical GitHub state. Keep the failure
  // for the audit trail and take a new manual observation instead of backdating it.
  if (snapshot.day !== currentDay) return enqueueSnapshot(db, snapshot.repo_id, 'manual');
  await db.batch([
    db.prepare('DELETE FROM snapshot_members WHERE snapshot_id = ?').bind(id),
    db
      .prepare(
        `UPDATE snapshots SET status = 'collecting', page = 1, total = 0, error = NULL, failures = 0,
      retry_at = 0, lease_until = 0, lease_token = NULL, started_at = ? WHERE id = ? AND status = 'failed'`,
      )
      .bind(nowSeconds(), id),
  ]);
  return id;
}
