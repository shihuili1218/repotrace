import type { Category } from './monitors';
export interface RepoSummary {
  id: string;
  github_id: number | null;
  full_name: string;
  description: string;
  language: string | null;
  enabled: number;
  created_at: number;
  webhookConfigured: boolean;
  first_received_at: number | null;
  last_received_at: number | null;
  last_star_at: number | null;
  current_total: number | null;
  total_reported_at: number | null;
  current_forks: number | null;
  forks_reported_at: number | null;
  event_count: number;
  receivedEvents: string[];
}
export interface Summary {
  id: string;
  project_id: string;
  full_name: string;
  kind: 'baseline' | 'daily' | 'manual';
  source: 'webhook' | 'legacy';
  day: string;
  period_start: number;
  period_end: number;
  computed_at: number;
  total: number | null;
  added: number;
  removed: number;
  event_count: number;
}
export interface StarChange {
  user_id: number;
  login: string;
  kind: 'added' | 'removed';
  starred_at: string | null;
  full_name: string;
  observed_at: number;
  id: string;
}
export interface ActivityRecord {
  id: string;
  project_id: string;
  full_name: string;
  category: Category;
  action: string;
  actor_id: number;
  actor_login: string;
  title: string;
  number: number | null;
  url: string;
  received_at: number;
}
export interface ForkRecord {
  project_id: string;
  github_id: number;
  full_name: string;
  source_name: string;
  owner_id: number;
  owner_login: string;
  created_at: number;
  received_at: number;
}
export interface WorkItem {
  project_id: string;
  github_id: number;
  kind: 'issue' | 'pull_request';
  full_name: string;
  number: number;
  title: string;
  author_id: number;
  author_login: string;
  state: 'open' | 'closed' | 'merged' | 'deleted';
  draft: number;
  labels: string[];
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  merged_at: number | null;
  first_seen_at: number;
  first_reply_at: number | null;
  review_state: string | null;
  reviewed_at: number | null;
}
export interface ReleaseRecord {
  project_id: string;
  github_id: number;
  full_name: string;
  tag_name: string;
  name: string;
  author_login: string;
  prerelease: number;
  draft: number;
  created_at: number;
  published_at: number | null;
  previous_published_at?: number | null;
  published_received_at: number | null;
  deleted_at: number | null;
  first_seen_at: number;
}
export interface MonitorMetrics {
  forks: number;
  issuesOpened: number;
  issuesClosed: number;
  prsOpened: number;
  prsMerged: number;
  prsClosed: number;
  releasesPublished: number;
  openIssues: number;
  unansweredIssues: number;
  openPRs: number;
  awaitingReview: number;
  contributors: number;
  avgReplySeconds: number | null;
  avgMergeSeconds: number | null;
  latestRelease: ReleaseRecord | null;
}
export interface Dashboard {
  repositories: RepoSummary[];
  history: {
    day: string;
    total: number;
    added: number;
    removed: number;
    repos: number;
    fork_total: number;
    fork_repos: number;
    fork_new: number;
    issue_opened: number;
    issue_closed: number;
    pr_opened: number;
    pr_merged: number;
    pr_closed: number;
  }[];
  summaries: Summary[];
  changes: StarChange[];
  changeTotal: number;
  page: number;
  eventCounts: { added: number; removed: number };
  timeline: ActivityRecord[];
  timelineTotal: number;
  metrics: MonitorMetrics;
  releaseMarkers: ReleaseRecord[];
}
export type MonitorType = 'forks' | 'issues' | 'pull_requests' | 'releases';
export interface MonitorData {
  type: MonitorType;
  forks: ForkRecord[];
  items: WorkItem[];
  releases: ReleaseRecord[];
  total: number;
  page: number;
  labels: string[];
  contributors: { login: string; id: number; prs: number; merged: number }[];
}
export interface WebhookConfig {
  id: string;
  full_name: string;
  url: string;
  secret?: string;
  settingsUrl: string;
}
