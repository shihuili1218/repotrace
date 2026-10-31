import { nowSeconds } from './types';

const DAY = 86400;
export const localDay = (at: number) => new Date((at + 8 * 3600) * 1000).toISOString().slice(0, 10);
export function latestDue(at: number, hour: number) {
  const midnight = Math.floor((at + 8 * 3600) / DAY) * DAY - 8 * 3600;
  const cutoff = midnight + hour * 3600;
  return cutoff <= at ? cutoff : cutoff - DAY;
}

export async function summarizePeriod(db: D1Database, project: string, start: number, end: number) {
  const id = `daily:${project}:${localDay(end)}`;
  // A user's first and last action determine their net change for the window.
  // created→deleted and deleted→created cancel; repeated delivery IDs are removed on receipt.
  const net = `WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY received_at,delivery_seq) AS first_rank,
      ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY received_at DESC,delivery_seq DESC) AS last_rank
    FROM star_events WHERE project_id=? AND received_at>=(SELECT period_start FROM summaries WHERE id=?) AND received_at<(SELECT period_end FROM summaries WHERE id=?)
  ) SELECT last.user_id,last.login,last.kind,last.starred_at,last.received_at FROM ranked last
    JOIN ranked first ON first.user_id=last.user_id AND first.first_rank=1
    WHERE last.last_rank=1 AND first.kind=last.kind`;
  const results = await db.batch<{ period_end: number }>([
    db
      .prepare(
        `INSERT INTO summaries(id,project_id,kind,source,day,period_start,period_end,computed_at)
      VALUES (?,?,'daily','webhook',?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, project, localDay(end), start, end, nowSeconds()),
    // Keep the window immutable if an overlapping cron saw a different schedule.
    db
      .prepare(
        `UPDATE summaries SET computed_at=?,
      delivery_cursor=COALESCE((SELECT seq FROM webhook_deliveries WHERE project_id=summaries.project_id AND recorded=1 AND received_at<summaries.period_end ORDER BY seq DESC LIMIT 1),0),
      total=(SELECT observed_total FROM webhook_deliveries WHERE project_id=summaries.project_id AND recorded=1 AND received_at<summaries.period_end ORDER BY received_at DESC,seq DESC LIMIT 1),
      event_count=(SELECT COUNT(*) FROM star_events WHERE project_id=summaries.project_id AND received_at>=summaries.period_start AND received_at<summaries.period_end)
      WHERE id=?`,
      )
      .bind(nowSeconds(), id),
    db.prepare('DELETE FROM summary_changes WHERE summary_id=?').bind(id),
    db
      .prepare(
        `INSERT INTO summary_changes(summary_id,user_id,login,kind,starred_at,observed_at) SELECT ?,* FROM (${net})`,
      )
      .bind(id, project, id, id),
    db
      .prepare(
        `UPDATE summaries SET added=(SELECT COUNT(*) FROM summary_changes WHERE summary_id=? AND kind='added'),
      removed=(SELECT COUNT(*) FROM summary_changes WHERE summary_id=? AND kind='removed') WHERE id=? RETURNING period_end`,
      )
      .bind(id, id, id),
  ]);
  return results[4].results[0].period_end;
}

export async function summarizeDue(db: D1Database, at = nowSeconds()) {
  const setting = await db
    .prepare("SELECT value FROM monitor_settings WHERE key='daily_hour'")
    .first<{ value: string }>();
  const hour = Number(setting?.value ?? 23);
  const cutoff = latestDue(at, hour);
  const projects = await db
    .prepare(
      `SELECT c.project_id,c.first_received_at,
      s.period_start AS last_start,s.period_end AS last_end,
      COALESCE((SELECT seq FROM webhook_deliveries WHERE project_id=c.project_id AND recorded=1 AND received_at<s.period_end ORDER BY seq DESC LIMIT 1),0)>s.delivery_cursor AS dirty
    FROM webhook_connections c LEFT JOIN summaries s ON s.id=(
      SELECT id FROM summaries WHERE project_id=c.project_id AND source='webhook' AND kind='daily'
      ORDER BY period_end DESC LIMIT 1)
    WHERE c.first_received_at IS NOT NULL ORDER BY COALESCE(s.computed_at,0),c.project_id`,
    )
    .all<{
      project_id: string;
      first_received_at: number;
      last_start: number | null;
      last_end: number | null;
      dirty: number | null;
    }>();
  // Each summary uses five statements. This global budget leaves room for routing,
  // migrations and metadata within the free Workers/D1 per-invocation query limit.
  let budget = 6;
  for (const project of projects.results) {
    if (!budget) break;
    if (project.last_end !== null && project.dirty) {
      // A request received before a cutoff can commit after the preceding cron.
      await summarizePeriod(db, project.project_id, project.last_start!, project.last_end);
      budget--;
    }
    let start = project.last_end ?? project.first_received_at;
    let end = latestDue(start, hour) + DAY;
    // Moving today's hour later must not create a second summary for today.
    if (project.last_end !== null && localDay(end) === localDay(project.last_end)) end += DAY;
    while (budget && end <= cutoff) {
      start = await summarizePeriod(db, project.project_id, start, end);
      budget--;
      end = latestDue(start, hour) + DAY;
      if (localDay(end) === localDay(start)) end += DAY;
    }
  }
}
