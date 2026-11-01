import type {
  ForkRecord,
  MonitorData,
  MonitorMetrics,
  ReleaseRecord,
  WorkItem,
} from '../shared/types';
import { AppError } from './types';

export async function monitorMetrics(
  db: D1Database,
  project: string | null,
  since: number,
): Promise<MonitorMetrics> {
  const [work, activity, forks, releases, latest] = await Promise.all([
    db
      .prepare(
        `SELECT
      COALESCE(SUM(kind='issue' AND state='open'),0) AS openIssues,
      COALESCE(SUM(kind='issue' AND state='open' AND first_reply_at IS NULL),0) AS unansweredIssues,
      COALESCE(SUM(kind='pull_request' AND state='open'),0) AS openPRs,
      COALESCE(SUM(kind='pull_request' AND state='open' AND draft=0 AND (review_state IS NULL OR review_state='dismissed')),0) AS awaitingReview,
      COUNT(DISTINCT CASE WHEN kind='pull_request' THEN author_id END) AS contributors,
      AVG(CASE WHEN kind='issue' AND first_reply_at>=created_at THEN first_reply_at-created_at END) AS avgReplySeconds,
      AVG(CASE WHEN kind='pull_request' AND merged_at>=created_at THEN merged_at-created_at END) AS avgMergeSeconds
      FROM work_items WHERE (? IS NULL OR project_id=?)`,
      )
      .bind(project, project)
      .first<
        Pick<
          MonitorMetrics,
          | 'openIssues'
          | 'unansweredIssues'
          | 'openPRs'
          | 'awaitingReview'
          | 'contributors'
          | 'avgReplySeconds'
          | 'avgMergeSeconds'
        >
      >(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT CASE WHEN category='issue' AND action='opened' THEN project_id||':'||object_id END) AS issuesOpened,
      COUNT(DISTINCT CASE WHEN category='issue' AND action='closed' THEN project_id||':'||object_id END) AS issuesClosed,
      COUNT(DISTINCT CASE WHEN category='pull_request' AND action='opened' THEN project_id||':'||object_id END) AS prsOpened,
      COUNT(DISTINCT CASE WHEN category='pull_request' AND action='merged' THEN project_id||':'||object_id END) AS prsMerged,
      COUNT(DISTINCT CASE WHEN category='pull_request' AND action='closed' THEN project_id||':'||object_id END) AS prsClosed
      FROM project_events WHERE received_at>=? AND (? IS NULL OR project_id=?)`,
      )
      .bind(since, project, project)
      .first<
        Pick<
          MonitorMetrics,
          'issuesOpened' | 'issuesClosed' | 'prsOpened' | 'prsMerged' | 'prsClosed'
        >
      >(),
    db
      .prepare(
        'SELECT COUNT(*) AS count FROM forks WHERE received_at>=? AND (? IS NULL OR project_id=?)',
      )
      .bind(since, project, project)
      .first<number>('count'),
    db
      .prepare(
        'SELECT COUNT(*) AS count FROM releases WHERE published_received_at>=? AND (? IS NULL OR project_id=?)',
      )
      .bind(since, project, project)
      .first<number>('count'),
    db
      .prepare(
        `SELECT r.*,p.full_name FROM releases r JOIN projects p ON p.id=r.project_id WHERE draft=0 AND prerelease=0 AND deleted_at IS NULL AND published_at IS NOT NULL AND (? IS NULL OR project_id=?) ORDER BY published_at DESC,r.last_delivery_seq DESC LIMIT 1`,
      )
      .bind(project, project)
      .first<ReleaseRecord>(),
  ]);
  return {
    ...work!,
    ...activity!,
    forks: forks ?? 0,
    releasesPublished: releases ?? 0,
    latestRelease: latest,
  };
}

export async function monitoring(db: D1Database, url: URL): Promise<MonitorData> {
  const project = url.searchParams.get('repo') || null;
  const type = url.searchParams.get('type') || 'forks';
  const state = url.searchParams.get('state') || 'all';
  const label = url.searchParams.get('label') || '';
  const page = Number(url.searchParams.get('page') || 1);
  if (
    !['forks', 'issues', 'pull_requests', 'releases'].includes(type) ||
    ![
      'all',
      'open',
      'closed',
      'merged',
      'deleted',
      'unanswered',
      'awaiting_review',
      'stable',
      'prerelease',
      'draft',
    ].includes(state) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    label.length > 100
  )
    throw new AppError(400, '筛选参数无效。');
  if (project && !(await db.prepare('SELECT 1 FROM projects WHERE id=?').bind(project).first()))
    throw new AppError(404, '仓库不存在。');
  const result: MonitorData = {
    type: type as MonitorData['type'],
    forks: [],
    items: [],
    releases: [],
    total: 0,
    page,
    labels: [],
    contributors: [],
  };
  let selected: string;
  let params: (string | number | null)[];
  if (type === 'forks') {
    selected =
      'SELECT f.*,p.full_name AS source_name FROM forks f JOIN projects p ON p.id=f.project_id WHERE (? IS NULL OR project_id=?)';
    params = [project, project];
  } else if (type === 'releases') {
    selected = `SELECT r.*,p.full_name,(SELECT MAX(old.published_at) FROM releases old WHERE old.project_id=r.project_id AND old.published_at<r.published_at AND old.draft=0 AND old.deleted_at IS NULL) AS previous_published_at FROM releases r JOIN projects p ON p.id=r.project_id WHERE (? IS NULL OR project_id=?) AND
      (?='all' OR (?='stable' AND prerelease=0 AND draft=0 AND deleted_at IS NULL) OR (?='prerelease' AND prerelease=1 AND draft=0 AND deleted_at IS NULL) OR (?='draft' AND draft=1 AND deleted_at IS NULL) OR (?='deleted' AND deleted_at IS NOT NULL))`;
    params = [project, project, state, state, state, state, state];
  } else {
    const kind = type === 'issues' ? 'issue' : 'pull_request';
    selected = `SELECT w.*,p.full_name FROM work_items w JOIN projects p ON p.id=w.project_id WHERE kind=? AND (? IS NULL OR project_id=?)
      AND (?='all' OR state=? OR (?='unanswered' AND state='open' AND first_reply_at IS NULL) OR (?='awaiting_review' AND state='open' AND draft=0 AND (review_state IS NULL OR review_state='dismissed')))
      AND (?='' OR EXISTS(SELECT 1 FROM json_each(w.labels) WHERE value=?))`;
    params = [kind, project, project, state, state, state, state, label, label];
    const labels = await db
      .prepare(
        `SELECT DISTINCT j.value AS label FROM work_items w,json_each(w.labels) j WHERE kind=? AND (? IS NULL OR project_id=?) ORDER BY label COLLATE NOCASE`,
      )
      .bind(kind, project, project)
      .all<{ label: string }>();
    result.labels = labels.results.map((r) => r.label);
    if (type === 'pull_requests') {
      const contributors = await db
        .prepare(
          `SELECT author_id AS id,MAX(author_login) AS login,COUNT(*) AS prs,SUM(state='merged') AS merged FROM work_items WHERE kind='pull_request' AND (? IS NULL OR project_id=?) GROUP BY author_id ORDER BY prs DESC,id LIMIT 12`,
        )
        .bind(project, project)
        .all<MonitorData['contributors'][number]>();
      result.contributors = contributors.results;
    }
  }
  const order =
    type === 'forks'
      ? 'f.received_at DESC,f.github_id DESC'
      : type === 'releases'
        ? 'COALESCE(r.published_at,r.created_at) DESC,r.github_id DESC'
        : 'w.updated_at DESC,w.github_id DESC';
  const [rows, total] = await Promise.all([
    db
      .prepare(`${selected} ORDER BY ${order} LIMIT 30 OFFSET ?`)
      .bind(...params, (page - 1) * 30)
      .all(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM (${selected})`)
      .bind(...params)
      .first<number>('count'),
  ]);
  result.total = total ?? 0;
  if (type === 'forks') result.forks = rows.results as unknown as ForkRecord[];
  else if (type === 'releases') result.releases = rows.results as unknown as ReleaseRecord[];
  else
    result.items = (
      rows.results as unknown as (Omit<WorkItem, 'labels'> & { labels: string })[]
    ).map((r) => ({ ...r, labels: JSON.parse(r.labels) as string[] }));
  return result;
}
