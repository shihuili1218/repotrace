import type {
  ActivityRecord,
  Dashboard,
  ReleaseRecord,
  RepoSummary,
  StarChange,
  Summary,
} from '../shared/types';
import { localDay, localMidnight } from './time';
import { monitorMetrics } from './monitoring';
import { AppError, nowSeconds } from './types';

const historySQL = `WITH RECURSIVE
  params AS (SELECT ? AS project,? AS from_day,? AS to_day,? AS since,? AS until),
  days(day) AS (SELECT from_day FROM params UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<(SELECT to_day FROM params)),
  chosen AS (SELECT * FROM projects WHERE (SELECT project FROM params) IS NULL OR id=(SELECT project FROM params)),
  ranked AS (
    SELECT *,date(received_at,'unixepoch','+8 hours') AS day,
      ROW_NUMBER() OVER(PARTITION BY project_id,user_id,date(received_at,'unixepoch','+8 hours') ORDER BY received_at,delivery_seq) AS first_rank,
      ROW_NUMBER() OVER(PARTITION BY project_id,user_id,date(received_at,'unixepoch','+8 hours') ORDER BY received_at DESC,delivery_seq DESC) AS last_rank
    FROM star_events WHERE project_id IN(SELECT id FROM chosen) AND received_at>=(SELECT since FROM params) AND received_at<(SELECT until FROM params)
  ),
  net AS (
    SELECT last.day,SUM(last.kind='added') AS added,SUM(last.kind='removed') AS removed FROM ranked last
    JOIN ranked first ON first.project_id=last.project_id AND first.user_id=last.user_id AND first.day=last.day AND first.first_rank=1
    WHERE last.last_rank=1 AND first.kind=last.kind GROUP BY last.day
  ),
  old_changes AS (
    SELECT s.day,s.added,s.removed FROM summaries s WHERE source='legacy' AND kind='daily' AND project_id IN(SELECT id FROM chosen)
      AND day>=(SELECT from_day FROM params) AND day<=(SELECT to_day FROM params)
      AND NOT EXISTS(SELECT 1 FROM star_events e WHERE e.project_id=s.project_id AND date(e.received_at,'unixepoch','+8 hours')=s.day)
  ),
  daily_changes AS (SELECT day,SUM(added) AS added,SUM(removed) AS removed FROM(SELECT * FROM net UNION ALL SELECT * FROM old_changes) GROUP BY day),
  observed AS (
    SELECT d.day,p.id,COALESCE(
      (SELECT observed_total FROM webhook_deliveries w WHERE w.project_id=p.id AND recorded=1 AND observed_total>=0 AND received_at<MIN(unixepoch(d.day,'+1 day','-8 hours'),(SELECT until FROM params)) ORDER BY received_at DESC,seq DESC LIMIT 1),
      (SELECT total FROM summaries s WHERE s.project_id=p.id AND total IS NOT NULL AND s.day<=d.day AND s.period_end<MIN(unixepoch(d.day,'+1 day','-8 hours'),(SELECT until FROM params)) ORDER BY period_end DESC LIMIT 1)
    ) AS stars,
    (SELECT observed_forks FROM webhook_deliveries w WHERE w.project_id=p.id AND recorded=1 AND observed_forks IS NOT NULL AND received_at<MIN(unixepoch(d.day,'+1 day','-8 hours'),(SELECT until FROM params)) ORDER BY received_at DESC,seq DESC LIMIT 1) AS forks
    FROM days d CROSS JOIN chosen p
  )
  SELECT d.day,COALESCE(SUM(o.stars),0) AS total,COUNT(o.stars) AS repos,COALESCE(SUM(o.forks),0) AS fork_total,COUNT(o.forks) AS fork_repos,
    COALESCE(c.added,0) AS added,COALESCE(c.removed,0) AS removed,
    (SELECT COUNT(*) FROM forks f WHERE project_id IN(SELECT id FROM chosen) AND date(received_at,'unixepoch','+8 hours')=d.day AND received_at<(SELECT until FROM params)) AS fork_new
  FROM days d LEFT JOIN observed o ON o.day=d.day LEFT JOIN daily_changes c ON c.day=d.day GROUP BY d.day ORDER BY d.day`;

export async function dashboard(db: D1Database, url: URL): Promise<Dashboard> {
  const project = url.searchParams.get('repo') || null;
  const summary = url.searchParams.get('summary') || null;
  const kind = url.searchParams.get('kind') || 'all';
  const category = url.searchParams.get('category') || 'all';
  const days = Number(url.searchParams.get('days') || 30);
  const page = Number(url.searchParams.get('page') || 1);
  if (
    ![7, 30, 90].includes(days) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !['all', 'added', 'removed'].includes(kind) ||
    !['all', 'star', 'fork', 'issue', 'pull_request', 'release'].includes(category)
  )
    throw new AppError(400, '筛选参数无效。');
  const repositories = await db
    .prepare(
      `SELECT p.*,c.first_received_at,c.last_received_at,c.last_star_at,c.current_total,c.total_reported_at,c.current_forks,c.forks_reported_at,
    c.project_id IS NOT NULL AS webhookConfigured,
    (SELECT COUNT(*) FROM star_events WHERE project_id=p.id)+(SELECT COUNT(*) FROM project_events WHERE project_id=p.id) AS event_count,
    (SELECT json_group_array(event_name) FROM (SELECT DISTINCT event_name FROM webhook_deliveries WHERE project_id=p.id AND event_name<>'ping' AND recorded=1)) AS received_events
    FROM projects p LEFT JOIN webhook_connections c ON c.project_id=p.id ORDER BY p.created_at,p.full_name`,
    )
    .all<RepoSummary & { received_events: string }>();
  if (project && !repositories.results.some((p) => p.id === project))
    throw new AppError(404, '仓库不存在。');
  if (
    summary &&
    !(await db
      .prepare('SELECT 1 FROM summaries WHERE id=? AND (? IS NULL OR project_id=?)')
      .bind(summary, project, project)
      .first())
  )
    throw new AppError(404, '历史记录不存在。');
  const now = nowSeconds();
  const since = localMidnight(now) - (days - 1) * 86400;
  const [summaries, history, eventCounts, metrics, markers] = await Promise.all([
    db
      .prepare(
        `SELECT s.*,p.full_name FROM summaries s JOIN projects p ON p.id=s.project_id WHERE (? IS NULL OR project_id=?) ORDER BY period_end DESC,s.rowid DESC LIMIT 100`,
      )
      .bind(project, project)
      .all<Summary>(),
    db
      .prepare(historySQL)
      .bind(project, localDay(since), localDay(now), since, now + 1)
      .all<Dashboard['history'][number]>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(kind='added'),0) AS added,COALESCE(SUM(kind='removed'),0) AS removed FROM star_events WHERE received_at>=? AND (? IS NULL OR project_id=?)`,
      )
      .bind(since, project, project)
      .first<Dashboard['eventCounts']>(),
    monitorMetrics(db, project, since),
    db
      .prepare(
        `SELECT r.*,p.full_name FROM releases r JOIN projects p ON p.id=r.project_id WHERE draft=0 AND deleted_at IS NULL AND published_at>=? AND (? IS NULL OR project_id=?) ORDER BY published_at DESC LIMIT 100`,
      )
      .bind(since, project, project)
      .all<ReleaseRecord>(),
  ]);
  const selected = summary
    ? `SELECT c.user_id,c.login,c.kind,c.starred_at,c.observed_at,p.full_name,s.id||':'||c.user_id AS id
    FROM summary_changes c JOIN summaries s ON s.id=c.summary_id JOIN projects p ON p.id=s.project_id WHERE s.id=? AND (?='all' OR c.kind=?)`
    : `SELECT e.user_id,e.login,e.kind,e.starred_at,e.received_at AS observed_at,p.full_name,CAST(e.delivery_seq AS TEXT) AS id FROM star_events e JOIN projects p ON p.id=e.project_id WHERE (? IS NULL OR e.project_id=?) AND e.received_at>=? AND (?='all' OR e.kind=?)`;
  const params = summary ? [summary, kind, kind] : [project, project, since, kind, kind];
  const feed = `SELECT * FROM(
    SELECT 'star:'||e.delivery_seq AS id,e.delivery_seq AS seq,e.project_id,p.full_name,'star' AS category,CASE e.kind WHEN 'added' THEN 'created' ELSE 'deleted' END AS action,e.user_id AS actor_id,e.login AS actor_login,p.full_name AS title,NULL AS number,'https://github.com/'||p.full_name AS url,e.received_at FROM star_events e JOIN projects p ON p.id=e.project_id
    UNION ALL SELECT 'event:'||e.delivery_seq,e.delivery_seq,e.project_id,p.full_name,e.category,e.action,e.actor_id,e.actor_login,e.title,e.number,e.url,e.received_at FROM project_events e JOIN projects p ON p.id=e.project_id
    ) WHERE (? IS NULL OR project_id=?) AND received_at>=? AND (?='all' OR category=?)`;
  const feedParams = [project, project, since, category, category];
  const [changes, count, timeline, timelineCount] = await Promise.all([
    db
      .prepare(`${selected} ORDER BY observed_at DESC,id DESC LIMIT 30 OFFSET ?`)
      .bind(...params, (page - 1) * 30)
      .all<StarChange>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM (${selected})`)
      .bind(...params)
      .first<number>('count'),
    db
      .prepare(`${feed} ORDER BY received_at DESC,seq DESC LIMIT 30 OFFSET ?`)
      .bind(...feedParams, (page - 1) * 30)
      .all<ActivityRecord>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM (${feed})`)
      .bind(...feedParams)
      .first<number>('count'),
  ]);
  return {
    repositories: repositories.results.map(({ received_events, ...p }) => ({
      ...p,
      webhookConfigured: !!p.webhookConfigured,
      receivedEvents: JSON.parse(received_events) as string[],
    })),
    history: history.results,
    summaries: summaries.results,
    changes: changes.results,
    changeTotal: count ?? 0,
    page,
    eventCounts: eventCounts ?? { added: 0, removed: 0 },
    metrics,
    releaseMarkers: markers.results,
    timeline: timeline.results,
    timelineTotal: timelineCount ?? 0,
  };
}
