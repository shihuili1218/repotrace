import { AppError } from './types';
import { parseRepository } from './projects';
import { normalizeAssets, assetSnapshotStatements } from './release-assets';
import type { Category } from '../shared/monitors';

export type ObjectData = Record<string, unknown>;
export function object(value: unknown): ObjectData {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError(400, 'Webhook 对象无效。');
  return value as ObjectData;
}
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new AppError(400, 'Webhook ID 或编号无效。');
  return value as number;
}
export function text(value: unknown, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError(400, 'Webhook 文本无效。');
  return value;
}
export function user(value: unknown) {
  const u = object(value);
  const id = integer(u.id);
  const login = text(u.login, 50);
  if (!/^[a-zA-Z0-9-]{1,39}(?:\[bot\])?$/.test(login))
    throw new AppError(400, 'GitHub 用户名无效。');
  return { id, login, bot: u.type === 'Bot' || login.endsWith('[bot]') };
}
export function date(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value)))
    throw new AppError(400, 'Webhook 时间无效。');
  return Math.floor(Date.parse(value) / 1000);
}
export function count(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new AppError(400, 'Webhook 总量无效。');
  return value as number;
}
interface NormalizedEvent {
  category: Category;
  action: string;
  objectId: number;
  actor: { id: number; login: string };
  title: string;
  number: number | null;
  url: string;
  statements: (
    db: D1Database,
    project: string,
    delivery: string,
    at: number,
  ) => D1PreparedStatement[];
}
export function normalizeEvent(
  event: string,
  data: ObjectData,
  repoName: string,
  at: number,
): NormalizedEvent | null {
  if (event === 'ping') return null;
  const actor = user(data.sender);
  if (event === 'star') {
    if (!['created', 'deleted'].includes(String(data.action)))
      throw new AppError(400, 'Star 事件内容无效。');
    const starredAt =
      data.action === 'created' && data.starred_at
        ? new Date(date(data.starred_at)! * 1000).toISOString()
        : null;
    return {
      category: 'star',
      action: String(data.action),
      objectId: actor.id,
      actor,
      title: repoName,
      number: null,
      url: `https://github.com/${repoName}`,
      statements: (db, project, delivery) => [
        db
          .prepare(
            `INSERT OR IGNORE INTO star_events(delivery_seq,project_id,user_id,login,kind,starred_at,received_at)
        SELECT seq,project_id,?,?,?,?,received_at FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0 AND recorded=1`,
          )
          .bind(
            actor.id,
            actor.login,
            data.action === 'created' ? 'added' : 'removed',
            starredAt,
            project,
            delivery,
          ),
      ],
    };
  }
  const action = event === 'fork' ? 'created' : text(data.action, 50);
  if (!/^[a-z_]+$/.test(action)) throw new AppError(400, 'Webhook 动作无效。');
  if (event === 'fork') {
    const fork = object(data.forkee);
    const id = integer(fork.id);
    const name = parseRepository(fork.full_name);
    const owner = user(fork.owner);
    return {
      category: 'fork',
      action,
      objectId: id,
      actor,
      title: name,
      number: null,
      url: `https://github.com/${name}`,
      statements: (db, project, delivery) => [
        db
          .prepare(
            `INSERT OR IGNORE INTO forks(project_id,github_id,full_name,owner_id,owner_login,created_at,received_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0 AND recorded=1)`,
          )
          .bind(
            project,
            id,
            name,
            owner.id,
            owner.login,
            date(fork.created_at, at),
            at,
            project,
            delivery,
          ),
      ],
    };
  }
  if (event === 'release') {
    const release = object(data.release);
    const id = integer(release.id);
    const tag = text(release.tag_name, 255);
    const author = user(release.author);
    const assets = normalizeAssets(release.assets, repoName);
    const published = date(release.published_at);
    const deleted = action === 'deleted' ? at : null;
    const draft = action === 'unpublished' ? 1 : Number(!!release.draft);
    const publication =
      !draft &&
      published !== null &&
      ['published', 'released', 'prereleased', 'created'].includes(action)
        ? at
        : null;
    return {
      category: 'release',
      action,
      objectId: id,
      actor,
      title:
        typeof release.name === 'string' && release.name.trim() ? release.name.slice(0, 500) : tag,
      number: null,
      url: `https://github.com/${repoName}/releases/tag/${encodeURIComponent(tag)}`,
      statements: (db, project, delivery) => [
        db
          .prepare(
            `INSERT INTO releases(project_id,github_id,tag_name,name,author_login,prerelease,draft,created_at,published_at,published_received_at,deleted_at,first_seen_at,last_delivery_seq,metadata_observed_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,seq,? FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0 AND recorded=1
        ON CONFLICT(project_id,github_id) DO UPDATE SET tag_name=excluded.tag_name,name=excluded.name,author_login=excluded.author_login,prerelease=excluded.prerelease,
        draft=excluded.draft,published_at=excluded.published_at,published_received_at=COALESCE(releases.published_received_at,excluded.published_received_at),deleted_at=excluded.deleted_at,last_delivery_seq=excluded.last_delivery_seq,metadata_observed_at=excluded.metadata_observed_at
        WHERE releases.deleted_at IS NULL AND excluded.last_delivery_seq>releases.last_delivery_seq AND releases.metadata_observed_at<=excluded.metadata_observed_at`,
          )
          .bind(
            project,
            id,
            tag,
            typeof release.name === 'string' ? release.name.slice(0, 500) : tag,
            author.login,
            Number(!!release.prerelease),
            draft,
            date(release.created_at, at),
            published,
            publication,
            deleted,
            at,
            at,
            project,
            delivery,
          ),
        ...assetSnapshotStatements(
          db,
          project,
          id,
          assets,
          at,
          'webhook',
          'last_delivery_seq=(SELECT seq FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0 AND recorded=1)',
          [project, delivery],
        ),
      ],
    };
  }
  const comment = event === 'issue_comment';
  const review = event === 'pull_request_review';
  const item = object(comment || event === 'issues' ? data.issue : data.pull_request);
  const kind =
    event === 'pull_request' || review || (comment && item.pull_request) ? 'pull_request' : 'issue';
  const id = integer(item.id);
  const number = integer(item.number);
  const author = user(item.user);
  const title = text(item.title, 1000);
  const created = date(item.created_at, at)!;
  const updated = date(item.updated_at, at)!;
  const merged = date(item.merged_at);
  const closed = date(item.closed_at);
  const state =
    event === 'issues' && action === 'deleted'
      ? 'deleted'
      : item.merged === true || merged !== null
        ? 'merged'
        : item.state === 'closed'
          ? 'closed'
          : 'open';
  let reply: number | null = null;
  let reviewState: string | null = null;
  let reviewed: number | null = null;
  if (comment && action === 'created') {
    const c = object(data.comment);
    const commenter = user(c.user);
    if (commenter.id !== author.id && !commenter.bot) reply = date(c.created_at, at);
  }
  if (review) {
    const r = object(data.review);
    const reviewer = user(r.user);
    reviewed = date(r.submitted_at, at);
    const verdict = typeof r.state === 'string' ? r.state.toLowerCase() : '';
    if (['approved', 'changes_requested', 'commented', 'dismissed'].includes(verdict))
      reviewState = verdict;
    if (reviewer.id !== author.id && !reviewer.bot) reply = reviewed;
  }
  const labels = Array.isArray(item.labels)
    ? item.labels
        .slice(0, 100)
        .map((label) =>
          typeof label === 'string'
            ? label.slice(0, 100)
            : typeof object(label).name === 'string'
              ? (object(label).name as string).slice(0, 100)
              : '',
        )
        .filter(Boolean)
    : [];
  const head = item.head && typeof item.head === 'object' ? object(item.head).sha : null;
  const headSha = typeof head === 'string' ? head.slice(0, 64) : null;
  if (
    review &&
    headSha &&
    typeof object(data.review).commit_id === 'string' &&
    object(data.review).commit_id !== headSha
  ) {
    reviewState = null;
    reviewed = null;
  }
  if (reply !== null && reply < created) reply = null;
  const fresh =
    '(excluded.updated_at>work_items.updated_at OR (excluded.updated_at=work_items.updated_at AND excluded.last_delivery_seq>work_items.last_delivery_seq))';
  const headFresh = review
    ? '(excluded.updated_at>work_items.updated_at OR work_items.head_sha IS NULL OR excluded.head_sha=work_items.head_sha)'
    : fresh;
  const newerReview =
    '(excluded.reviewed_at IS NOT NULL AND (work_items.reviewed_at IS NULL OR excluded.reviewed_at>=work_items.reviewed_at) AND (excluded.head_sha IS NULL OR work_items.head_sha IS NULL OR excluded.head_sha=work_items.head_sha OR excluded.updated_at>work_items.updated_at))';
  return {
    category: kind,
    action: comment
      ? `comment_${action}`
      : review
        ? `review_${action}`
        : kind === 'pull_request' && action === 'closed' && state === 'merged'
          ? 'merged'
          : action,
    objectId: id,
    actor,
    title,
    number,
    url: `https://github.com/${repoName}/${kind === 'issue' ? 'issues' : 'pull'}/${number}`,
    statements: (db, project, delivery) => [
      db
        .prepare(
          `INSERT INTO work_items(project_id,github_id,kind,number,title,author_id,author_login,state,draft,labels,created_at,updated_at,closed_at,merged_at,first_seen_at,first_reply_at,review_state,reviewed_at,head_sha,last_delivery_seq)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,seq FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0 AND recorded=1
      ON CONFLICT(project_id,kind,github_id) DO UPDATE SET
      title=CASE WHEN ${fresh} THEN excluded.title ELSE work_items.title END,
      author_login=CASE WHEN ${fresh} THEN excluded.author_login ELSE work_items.author_login END,
      state=CASE WHEN work_items.state IN ('deleted','merged') THEN work_items.state WHEN ${fresh} THEN excluded.state ELSE work_items.state END,
      draft=CASE WHEN ${fresh} AND ?=0 THEN excluded.draft ELSE work_items.draft END,
      labels=CASE WHEN ${fresh} THEN excluded.labels ELSE work_items.labels END,
      updated_at=MAX(work_items.updated_at,excluded.updated_at),
      closed_at=CASE WHEN ${fresh} THEN excluded.closed_at ELSE work_items.closed_at END,
      merged_at=COALESCE(excluded.merged_at,work_items.merged_at),
      first_reply_at=CASE WHEN excluded.first_reply_at IS NULL THEN work_items.first_reply_at WHEN work_items.first_reply_at IS NULL THEN excluded.first_reply_at ELSE MIN(work_items.first_reply_at,excluded.first_reply_at) END,
      review_state=CASE WHEN ${newerReview} THEN excluded.review_state WHEN ${headFresh} AND ((excluded.head_sha IS NOT NULL AND work_items.head_sha IS NOT NULL AND excluded.head_sha<>work_items.head_sha) OR ?=1) THEN NULL ELSE work_items.review_state END,
      reviewed_at=CASE WHEN ${newerReview} THEN excluded.reviewed_at ELSE work_items.reviewed_at END,
      head_sha=CASE WHEN ${headFresh} THEN COALESCE(excluded.head_sha,work_items.head_sha) ELSE work_items.head_sha END,
      last_delivery_seq=MAX(work_items.last_delivery_seq,excluded.last_delivery_seq)`,
        )
        .bind(
          project,
          id,
          kind,
          number,
          title,
          author.id,
          author.login,
          state,
          Number(!!item.draft),
          JSON.stringify(labels),
          created,
          updated,
          closed,
          merged,
          at,
          reply,
          reviewState,
          reviewed,
          headSha,
          project,
          delivery,
          Number(comment),
          Number(action === 'review_requested'),
        ),
    ],
  };
}
