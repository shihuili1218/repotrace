export const webhookEvents = [
  { event: 'star', label: 'Stars', feature: 'Star 关注' },
  { event: 'fork', label: 'Forks', feature: 'Fork 增长' },
  { event: 'issues', label: 'Issues', feature: 'Issue 状态' },
  { event: 'issue_comment', label: 'Issue comments', feature: 'Issue / PR 回复' },
  { event: 'pull_request', label: 'Pull requests', feature: 'PR 进度' },
  { event: 'pull_request_review', label: 'Pull request reviews', feature: 'PR 评审' },
  { event: 'release', label: 'Releases', feature: '发版动态' },
] as const;
export type Category = 'star' | 'fork' | 'issue' | 'pull_request' | 'release';
export const categoryLabels: Record<Category, string> = {
  star: 'Star',
  fork: 'Fork',
  issue: 'Issue',
  pull_request: 'PR',
  release: 'Release',
};
