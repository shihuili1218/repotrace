import type {
  ActivityRecord,
  Dashboard,
  ReleaseRecord,
  RepoSummary,
  StarChange,
  Summary,
  ReleaseBoundary,
} from '../shared/types';
import { statisticsRange } from './range';
import { monitorMetrics } from './monitoring';
import { AppError, nowSeconds } from './types';

const historySQL = `WITH RECURSIVE
  params AS (SELECT ? AS project,? AS from_day,? AS to_day,? AS since,? AS until,? AS step),
  days(day) AS (SELECT from_day FROM params UNION ALL SELECT date(day,'+'||(SELECT step FROM params)||' days') FROM days WHERE date(day,'+'||(SELECT step FROM params)||' days')<=(SELECT to_day FROM params)),
  buckets AS (SELECT day,MAX(unixepoch(day,'-8 hours'),(SELECT since FROM params)) AS start,MIN(unixepoch(day,'+'||(SELECT step FROM params)||' days','-8 hours'),(SELECT until FROM params)) AS end FROM days),
  chosen AS (SELECT * FROM projects WHERE (SELECT project FROM params) IS NULL OR id=(SELECT project FROM params)),
  ranked AS (
    SELECT e.*,b.day,
      ROW_NUMBER() OVER(PARTITION BY e.project_id,e.user_id,b.day ORDER BY received_at,delivery_seq) AS first_rank,
      ROW_NUMBER() OVER(PARTITION BY e.project_id,e.user_id,b.day ORDER BY received_at DESC,delivery_seq DESC) AS last_rank
    FROM star_events e JOIN buckets b ON e.received_at>=b.start AND e.received_at<b.end WHERE e.project_id IN(SELECT id FROM chosen)
  ),
  net AS (
    SELECT last.day,SUM(last.kind='added') AS added,SUM(last.kind='removed') AS removed FROM ranked last
    JOIN ranked first ON first.project_id=last.project_id AND first.user_id=last.user_id AND first.day=last.day AND first.first_rank=1
    WHERE last.last_rank=1 AND first.kind=last.kind GROUP BY last.day
  ),
  old_changes AS (
    SELECT b.day,s.added,s.removed FROM summaries s JOIN buckets b ON s.period_end>=b.start AND s.period_end<b.end
    WHERE source='legacy' AND kind='daily' AND project_id IN(SELECT id FROM chosen) AND s.period_start>=(SELECT since FROM params)
      AND NOT EXISTS(SELECT 1 FROM star_events e WHERE e.project_id=s.project_id AND e.received_at>=b.start AND e.received_at<b.end)
  ),
  daily_changes AS (SELECT day,SUM(added) AS added,SUM(removed) AS removed FROM(SELECT * FROM net UNION ALL SELECT * FROM old_changes) GROUP BY day),
  daily_activity AS (
    SELECT b.day,
      COUNT(DISTINCT CASE WHEN category='issue' AND action='opened' THEN project_id||':'||object_id END) AS issue_opened,
      COUNT(DISTINCT CASE WHEN category='issue' AND action='closed' THEN project_id||':'||object_id END) AS issue_closed,
      COUNT(DISTINCT CASE WHEN category='pull_request' AND action='opened' THEN project_id||':'||object_id END) AS pr_opened,
      COUNT(DISTINCT CASE WHEN category='pull_request' AND action='merged' THEN project_id||':'||object_id END) AS pr_merged,
      COUNT(DISTINCT CASE WHEN category='pull_request' AND action='closed' THEN project_id||':'||object_id END) AS pr_closed
    FROM project_events e JOIN buckets b ON e.received_at>=b.start AND e.received_at<b.end WHERE project_id IN(SELECT id FROM chosen) GROUP BY b.day
  ),
  observed AS (
    SELECT b.day,p.id,COALESCE(
      (SELECT observed_total FROM webhook_deliveries w WHERE w.project_id=p.id AND recorded=1 AND observed_total>=0 AND received_at<b.end ORDER BY received_at DESC,seq DESC LIMIT 1),
      (SELECT total FROM summaries s WHERE s.project_id=p.id AND total IS NOT NULL AND s.period_end<b.end ORDER BY period_end DESC LIMIT 1)
    ) AS stars,
    (SELECT observed_forks FROM webhook_deliveries w WHERE w.project_id=p.id AND recorded=1 AND observed_forks IS NOT NULL AND received_at<b.end ORDER BY received_at DESC,seq DESC LIMIT 1) AS forks
    FROM buckets b CROSS JOIN chosen p
  )
  SELECT b.day,COALESCE(SUM(o.stars),0) AS total,COUNT(o.stars) AS repos,COALESCE(SUM(o.forks),0) AS fork_total,COUNT(o.forks) AS fork_repos,
    COALESCE(c.added,0) AS added,COALESCE(c.removed,0) AS removed,
    COALESCE(a.issue_opened,0) AS issue_opened,COALESCE(a.issue_closed,0) AS issue_closed,
    COALESCE(a.pr_opened,0) AS pr_opened,COALESCE(a.pr_merged,0) AS pr_merged,COALESCE(a.pr_closed,0) AS pr_closed,
    (SELECT COUNT(*) FROM forks f WHERE project_id IN(SELECT id FROM chosen) AND received_at>=b.start AND received_at<b.end) AS fork_new
  FROM buckets b LEFT JOIN observed o ON o.day=b.day LEFT JOIN daily_changes c ON c.day=b.day LEFT JOIN daily_activity a ON a.day=b.day GROUP BY b.day ORDER BY b.day`;

export async function dashboard(db: D1Database, url: URL): Promise<Dashboard> {
  const project = url.searchParams.get('repo') || null;
  const summary = url.searchParams.get('summary') || null;
  const kind = url.searchParams.get('kind') || 'all';
  const category = url.searchParams.get('category') || 'all';
  const projectScope = url.searchParams.get('scope') === 'project';
  if (projectScope && !project) throw new AppError(400, '请先选择项目。');
  const page = Number(url.searchParams.get('page') || 1);
  if (
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
  const range = await statisticsRange(db, url, project);
  const { since, until } = range;
  const [summaries, history, eventCounts, metrics, markers] = await Promise.all([
    db
      .prepare(
        `SELECT s.*,p.full_name FROM summaries s JOIN projects p ON p.id=s.project_id WHERE (? IS NULL OR project_id=?) ORDER BY period_end DESC,s.rowid DESC LIMIT 100`,
      )
      .bind(project, project)
      .all<Summary>(),
    db
      .prepare(historySQL)
      .bind(project, range.startDay, range.endDay, since, until, range.bucketDays)
      .all<Dashboard['history'][number]>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(kind='added'),0) AS added,COALESCE(SUM(kind='removed'),0) AS removed FROM star_events WHERE received_at>=? AND received_at<? AND (? IS NULL OR project_id=?)`,
      )
      .bind(since, until, project, project)
      .first<Dashboard['eventCounts']>(),
    monitorMetrics(db, project, range, projectScope),
    projectScope
      ? db
          .prepare(
            `SELECT r.*,p.full_name FROM releases r JOIN projects p ON p.id=r.project_id WHERE draft=0 AND deleted_at IS NULL AND published_at>=? AND published_at<? AND (? IS NULL OR project_id=?) ORDER BY published_at DESC LIMIT 100`,
          )
          .bind(since, until, project, project)
          .all<ReleaseRecord>()
      : Promise.resolve({ results: [] as ReleaseRecord[] }),
  ]);
  const selected = summary
    ? `SELECT c.user_id,c.login,c.kind,c.starred_at,c.observed_at,p.full_name,s.id||':'||c.user_id AS id
    FROM summary_changes c JOIN summaries s ON s.id=c.summary_id JOIN projects p ON p.id=s.project_id WHERE s.id=? AND (?='all' OR c.kind=?)`
    : `SELECT e.user_id,e.login,e.kind,e.starred_at,e.received_at AS observed_at,p.full_name,CAST(e.delivery_seq AS TEXT) AS id FROM star_events e JOIN projects p ON p.id=e.project_id WHERE (? IS NULL OR e.project_id=?) AND e.received_at>=? AND e.received_at<? AND (?='all' OR e.kind=?)`;
  const params = summary ? [summary, kind, kind] : [project, project, since, until, kind, kind];
  const feed = `SELECT * FROM(
    SELECT 'star:'||e.delivery_seq AS id,e.delivery_seq AS seq,e.project_id,p.full_name,'star' AS category,CASE e.kind WHEN 'added' THEN 'created' ELSE 'deleted' END AS action,e.user_id AS actor_id,e.login AS actor_login,p.full_name AS title,NULL AS number,'https://github.com/'||p.full_name AS url,e.received_at FROM star_events e JOIN projects p ON p.id=e.project_id
    UNION ALL SELECT 'event:'||e.delivery_seq,e.delivery_seq,e.project_id,p.full_name,e.category,e.action,e.actor_id,e.actor_login,e.title,e.number,e.url,e.received_at FROM project_events e JOIN projects p ON p.id=e.project_id
    ) WHERE (? IS NULL OR project_id=?) AND received_at>=? AND received_at<? AND (?='all' OR category=?)`;
  const feedParams = [project, project, since, until, category, category];
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
  const [net, choices, catalog] = await Promise.all([
    db
      .prepare(
        `WITH ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY project_id,user_id ORDER BY received_at,delivery_seq) AS first_rank,ROW_NUMBER() OVER(PARTITION BY project_id,user_id ORDER BY received_at DESC,delivery_seq DESC) AS last_rank FROM star_events WHERE received_at>=? AND received_at<? AND (? IS NULL OR project_id=?))
      SELECT COALESCE(SUM(last.kind='added'),0) AS added,COALESCE(SUM(last.kind='removed'),0) AS removed FROM ranked last JOIN ranked first ON first.project_id=last.project_id AND first.user_id=last.user_id AND first.first_rank=1 WHERE last.last_rank=1 AND first.kind=last.kind`,
      )
      .bind(since, until, project, project)
      .first<{ added: number; removed: number }>(),
    projectScope
      ? db
          .prepare(
            'SELECT github_id,tag_name,published_at,prerelease FROM releases WHERE project_id=? AND published_at IS NOT NULL AND draft=0 ORDER BY published_at DESC,github_id DESC LIMIT 1000',
          )
          .bind(project)
          .all<ReleaseBoundary>()
      : Promise.resolve({ results: [] as ReleaseBoundary[] }),
    projectScope
      ? db
          .prepare(
            'SELECT next_page AS nextPage,updated_at AS updatedAt FROM release_catalog_sync WHERE project_id=?',
          )
          .bind(project)
          .first<{ nextPage: number | null; updatedAt: number | null }>()
      : Promise.resolve(null),
  ]);
  return {
    repositories: repositories.results.map(({ received_events, ...p }) => ({
      ...p,
      webhookConfigured: !!p.webhookConfigured,
      receivedEvents: JSON.parse(received_events) as string[],
    })),
    range,
    releaseChoices: choices.results,
    releaseCatalog: catalog ?? { nextPage: null, updatedAt: null },
    starNet: net ?? { added: 0, removed: 0 },
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
