export interface Repository {
  id: string;
  github_id: number;
  full_name: string;
  description: string;
  language: string | null;
  created_at: number;
  enabled: number;
}

export interface Snapshot {
  id: string;
  repo_id: string;
  kind: 'baseline' | 'daily' | 'manual';
  day: string;
  status: 'collecting' | 'complete' | 'failed';
  page: number;
  total: number;
  expected_total: number;
  added: number;
  removed: number;
  comparison_id: string | null;
  started_at: number;
  completed_at: number | null;
  error: string | null;
  retry_at: number;
  failures: number;
  lease_token: string | null;
  lease_until: number;
}

export interface RepoSummary extends Repository {
  latest: Snapshot | null;
  active: Snapshot | null;
  lastError: string | null;
}

export interface StarChange {
  user_id: number;
  login: string;
  kind: 'added' | 'removed';
  starred_at: string | null;
  full_name: string;
  snapshot_id: string;
  observed_at: number;
}

export interface Dashboard {
  repositories: RepoSummary[];
  history: { day: string; total: number; added: number; removed: number; repos: number }[];
  snapshots: (Snapshot & { full_name: string; comparison_day: string | null })[];
  changes: StarChange[];
  changeTotal: number;
  page: number;
}
