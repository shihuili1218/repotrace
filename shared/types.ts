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
  event_count: number;
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
export interface Dashboard {
  repositories: RepoSummary[];
  history: { day: string; total: number; added: number; removed: number; repos: number }[];
  summaries: Summary[];
  changes: StarChange[];
  changeTotal: number;
  page: number;
  eventCounts: { added: number; removed: number };
}
export interface WebhookConfig {
  id: string;
  full_name: string;
  url: string;
  secret?: string;
  settingsUrl: string;
}
