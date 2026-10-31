import type { Dashboard, RepoSummary, StarChange, Summary } from '../shared/types';
import { localDay } from './summaries';
import { AppError, nowSeconds } from './types';

export async function dashboard(db: D1Database, url: URL): Promise<Dashboard> {
  const project = url.searchParams.get('repo') || null;
  const summary = url.searchParams.get('summary') || null;
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
  const repositories = await db
    .prepare(
      `SELECT p.*,c.first_received_at,c.last_received_at,c.last_star_at,c.current_total,c.total_reported_at,
    c.project_id IS NOT NULL AS webhookConfigured,(SELECT COUNT(*) FROM star_events WHERE project_id=p.id) AS event_count
    FROM projects p LEFT JOIN webhook_connections c ON c.project_id=p.id ORDER BY p.created_at,p.full_name`,
    )
    .all<RepoSummary>();
  if (project && !repositories.results.some((p) => p.id === project))
    throw new AppError(404, '仓库不存在。');
  if (
    summary &&
    !(await db
      .prepare('SELECT 1 FROM summaries WHERE id=? AND (? IS NULL OR project_id=?)')
      .bind(summary, project, project)
      .first())
  )
    throw new AppError(404, '汇总不存在。');
  const since = nowSeconds() - days * 86400;
  const [summaries, history, eventCounts] = await Promise.all([
    db
      .prepare(
        `SELECT s.*,p.full_name FROM summaries s JOIN projects p ON p.id=s.project_id
      WHERE (? IS NULL OR project_id=?) ORDER BY period_end DESC,s.rowid DESC LIMIT 100`,
      )
      .bind(project, project)
      .all<Summary>(),
    db
      .prepare(
        `WITH RECURSIVE days(day) AS (SELECT ? UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<?)
      SELECT d.day,COALESCE(SUM((SELECT s.total FROM summaries s WHERE s.project_id=p.id AND s.total IS NOT NULL AND s.day<=d.day
        ORDER BY s.day DESC,s.period_end DESC,s.rowid DESC LIMIT 1)),0) AS total,
      (SELECT COALESCE(SUM(s.added),0) FROM summaries s WHERE s.day=d.day AND s.kind='daily' AND (? IS NULL OR s.project_id=?)) AS added,
      (SELECT COALESCE(SUM(s.removed),0) FROM summaries s WHERE s.day=d.day AND s.kind='daily' AND (? IS NULL OR s.project_id=?)) AS removed,
      COUNT(CASE WHEN EXISTS(SELECT 1 FROM summaries s WHERE s.project_id=p.id AND s.day<=d.day AND s.total IS NOT NULL) THEN 1 END) AS repos
      FROM days d LEFT JOIN projects p ON (? IS NULL OR p.id=?) GROUP BY d.day ORDER BY d.day`,
      )
      .bind(
        localDay(nowSeconds() - (days - 1) * 86400),
        localDay(nowSeconds()),
        project,
        project,
        project,
        project,
        project,
        project,
      )
      .all<Dashboard['history'][number]>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(kind='added'),0) AS added,COALESCE(SUM(kind='removed'),0) AS removed
      FROM star_events WHERE received_at>=? AND (? IS NULL OR project_id=?)`,
      )
      .bind(since, project, project)
      .first<Dashboard['eventCounts']>(),
  ]);
  const selected = summary
    ? `SELECT c.user_id,c.login,c.kind,c.starred_at,c.observed_at,p.full_name,s.id||':'||c.user_id AS id
       FROM summary_changes c JOIN summaries s ON s.id=c.summary_id JOIN projects p ON p.id=s.project_id
       WHERE s.id=? AND (?='all' OR c.kind=?)`
    : `SELECT e.user_id,e.login,e.kind,e.starred_at,e.received_at AS observed_at,p.full_name,CAST(e.delivery_seq AS TEXT) AS id
       FROM star_events e JOIN projects p ON p.id=e.project_id
       WHERE (? IS NULL OR e.project_id=?) AND e.received_at>=? AND (?='all' OR e.kind=?)`;
  const params = summary ? [summary, kind, kind] : [project, project, since, kind, kind];
  const [changes, count] = await Promise.all([
    db
      .prepare(`${selected} ORDER BY observed_at DESC,id DESC LIMIT 30 OFFSET ?`)
      .bind(...params, (page - 1) * 30)
      .all<StarChange>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM (${selected})`)
      .bind(...params)
      .first<{ count: number }>(),
  ]);
  return {
    repositories: repositories.results.map((p) => ({
      ...p,
      webhookConfigured: !!p.webhookConfigured,
    })),
    history: history.results,
    summaries: summaries.results,
    changes: changes.results,
    changeTotal: count?.count ?? 0,
    page,
    eventCounts: eventCounts ?? { added: 0, removed: 0 },
  };
}
