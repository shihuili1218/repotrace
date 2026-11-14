import type { Page } from '@playwright/test';
import type {
  Dashboard,
  RepoSummary,
  ReleaseRecord,
  DownloadSummary,
  MonitorData,
} from '../shared/types';

// Deterministic demonstration data. This fixture is used only by browser checks.
const now = Date.UTC(2026, 10, 14, 8, 0) / 1000;
const day = 86400;
export const demoRepositories: RepoSummary[] = [
  [
    'rssh',
    'shihuili1218/rssh',
    '跨平台 SSH 工作台，连接终端与开发工作流',
    'Rust',
    2846,
    186,
    24,
    1284,
  ],
  [
    'repotrace',
    'shihuili1218/repotrace',
    'GitHub 项目事件、协作与版本下载观测',
    'TypeScript',
    368,
    42,
    8,
    396,
  ],
  ['open-cli', 'shihuili1218/open-cli', '面向日常开发的命令行工具集', 'Go', 124, 16, 3, 85],
].map(([id, full_name, description, language, stars, forks, open, events], i) => ({
  id: String(id),
  github_id: i + 10,
  full_name: String(full_name),
  description: String(description),
  language: String(language),
  enabled: 1,
  created_at: now - 90 * day,
  webhookConfigured: true,
  first_received_at: now - 90 * day,
  last_received_at: now - (i + 1) * 120,
  last_star_at: now - (i + 1) * 180,
  current_total: Number(stars),
  total_reported_at: now - (i + 1) * 180,
  current_forks: Number(forks),
  forks_reported_at: now - (i + 1) * 180,
  current_open_items: Number(open),
  open_items_reported_at: now - (i + 1) * 180,
  event_count: Number(events),
  receivedEvents: ['ping', 'star', 'fork', 'issues', 'pull_request', 'release'],
}));
const releaseTags = ['v1.8.2', 'v1.8.1', 'v1.8.0', 'v1.7.4', 'v1.7.3', 'v1.7.2', 'v1.9.0-rc.1'];
export const demoReleases: ReleaseRecord[] = releaseTags.map((tag, i) => ({
  project_id: 'rssh',
  github_id: 401 + i,
  full_name: 'shihuili1218/rssh',
  tag_name: tag,
  name: ['终端分屏与连接稳定性优化', '修复连接与窗口状态', '工作台交互更新'][i % 3],
  author_login: 'shihuili1218',
  prerelease: i === 6 ? 1 : 0,
  draft: 0,
  created_at: now - (i + 1) * day * 4,
  published_at: now - (i + 1) * day * 4,
  previous_published_at: now - (i + 2) * day * 4,
  published_received_at: now - (i + 1) * day * 4,
  deleted_at: null,
  first_seen_at: now - (i + 1) * day * 4,
  assets_count: 4,
  assets_seen_at: now - 1200,
  assets_source: 'github',
}));
const metrics = {
  forks: 38,
  issuesOpened: 22,
  issuesClosed: 18,
  prsOpened: 16,
  prsMerged: 12,
  prsClosed: 2,
  releasesPublished: 4,
  openIssues: 9,
  unansweredIssues: 3,
  openPRs: 5,
  awaitingReview: 2,
  contributors: 8,
  avgReplySeconds: 6480,
  avgMergeSeconds: 32 * 3600,
  latestRelease: demoReleases[0],
};
export function demoDashboard(repo = '', days = 30): Dashboard {
  const selected = demoRepositories.filter((r) => !repo || r.id === repo);
  const stars = selected.reduce((sum, r) => sum + r.current_total!, 0);
  const forks = selected.reduce((sum, r) => sum + r.current_forks!, 0);
  const timeline = [
    ['pull_request', 'merged', '完善分屏焦点与键盘导航', 338, 'shihuili1218'],
    ['star', 'created', '关注了 shihuili1218/rssh', null, 'sarah-chen'],
    ['issue', 'opened', '窗口恢复后保留终端布局', 342, 'tom-west'],
    ['release', 'published', 'v1.8.2 · 终端分屏与连接稳定性优化', null, 'shihuili1218'],
    ['fork', 'created', 'mika-dev/repotrace', null, 'mika-dev'],
  ].map(([category, action, title, number, actor_login], i) => ({
    id: `e-${i}`,
    project_id: selected[0]?.id ?? 'rssh',
    full_name: selected[0]?.full_name ?? 'shihuili1218/rssh',
    category,
    action,
    title,
    number,
    actor_login,
    actor_id: i + 100,
    received_at: now - i * 3600 - 180,
    url: 'https://github.com/shihuili1218/rssh',
  })) as Dashboard['timeline'];
  return {
    repositories: demoRepositories,
    range: {
      mode: 'days',
      since: now - days * day,
      until: now,
      bucketDays: 1,
      days,
      label: `近 ${days} 天`,
      fromRelease: null,
      toRelease: null,
      coverageStart: now - 90 * day,
      partial: false,
      startDay: '2026-10-16',
      endDay: '2026-11-14',
    },
    releaseChoices: demoReleases.map((r) => ({
      github_id: r.github_id,
      tag_name: r.tag_name,
      published_at: r.published_at!,
      prerelease: r.prerelease,
    })),
    releaseCatalog: { updatedAt: now - 1200, error: null },
    starNet: { added: 286, removed: 12 },
    history: Array.from({ length: days }, (_, i) => ({
      day: new Date((now - (days - 1 - i) * day) * 1000).toISOString().slice(0, 10),
      total: Math.max(0, stars - (days - 1 - i) * 9 - Math.round(Math.sin(i / 3) * 16)),
      added: 6 + ((i * 7) % 17),
      removed: i % 4 === 0 ? 2 : 0,
      repos: selected.length,
      fork_total: Math.max(0, forks - days + i + 1),
      fork_repos: selected.length,
      fork_new: i % 3,
      issue_opened: i % 4,
      issue_closed: i % 3,
      pr_opened: i % 3,
      pr_merged: i % 2,
      pr_closed: i % 7 === 0 ? 1 : 0,
    })),
    summaries: [],
    changes: [],
    changeTotal: 0,
    page: 1,
    eventCounts: { added: 312, removed: 24 },
    eventTotal: 486,
    timeline,
    recentEvents: timeline,
    timelineTotal: timeline.length,
    metrics,
    releaseMarkers: demoReleases,
  };
}
export const demoDownloads: DownloadSummary = {
  total: '48762',
  latest: '12846',
  source: 'github',
  cache: { updatedAt: now - 1200, error: null },
  releases: demoReleases.map((r, i) => ({
    id: r.github_id,
    tag: r.tag_name,
    name: r.name,
    publishedAt: r.published_at!,
    prerelease: !!r.prerelease,
    downloads: ['12846', '9234', '14682', '5600', '3400', '2100', '900'][i],
  })),
  history: Array.from({ length: 30 }, (_, i) => ({
    observedAt: now - 1200 - (29 - i) * day,
    total: String(31668 + i * 580 + (i % 3) * 137),
  })),
};
export async function installDesignFixture(page: Page) {
  await page.route('https://avatars.githubusercontent.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#e7ecea"/><circle cx="32" cy="24" r="11" fill="#839990"/><path d="M12 60v-7a20 20 0 0 1 40 0v7" fill="#839990"/></svg>',
    }),
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const repo = url.searchParams.get('repo') || '';
    if (url.pathname === '/api/auth/status')
      return route.fulfill({
        json: { initialized: true, authenticated: true, setupProtected: false },
      });
    if (url.pathname === '/api/dashboard')
      return route.fulfill({
        json: demoDashboard(repo, Number(url.searchParams.get('days') || 30)),
      });
    if (url.pathname.endsWith('/releases/downloads')) return route.fulfill({ json: demoDownloads });
    if (url.pathname.endsWith('/assets'))
      return route.fulfill({
        json: {
          releaseId: 401,
          tag: 'v1.8.2',
          observedAt: now - 1200,
          source: 'github',
          deleted: false,
          cache: { updatedAt: now - 1200, error: null, retryAt: null, refreshRequested: false },
          assets: [
            'rssh-macos-arm64.dmg',
            'rssh-macos-x64.dmg',
            'rssh-windows-x64.msi',
            'rssh-linux-amd64.deb',
          ].map((name, i) => ({
            project_id: 'rssh',
            release_id: 401,
            github_id: 601 + i,
            name,
            size: 45846200 + i * 1250,
            content_type: 'application/octet-stream',
            state: 'uploaded',
            download_count: [6840, 2830, 2456, 720][i],
            download_url: `https://github.com/shihuili1218/rssh/releases/download/v1.8.2/${name}`,
            observed_at: now - 1200,
          })),
        },
      });
    if (url.pathname === '/api/monitoring') {
      const type = url.searchParams.get('type') as MonitorData['type'];
      const result: MonitorData = {
        type,
        stars: [
          {
            user_id: 100,
            login: 'sarah-chen',
            kind: 'added',
            starred_at: null,
            full_name: 'shihuili1218/rssh',
            observed_at: now - 3600,
            id: 's1',
          },
          {
            user_id: 101,
            login: 'tom-west',
            kind: 'added',
            starred_at: null,
            full_name: 'shihuili1218/rssh',
            observed_at: now - 7200,
            id: 's2',
          },
        ],
        forks: [],
        items: [],
        releases: demoReleases,
        total: type === 'releases' ? demoReleases.length : 2,
        page: 1,
        labels: ['bug', 'enhancement'],
        contributors: [{ login: 'sarah-chen', id: 100, prs: 5, merged: 4 }],
      };
      if (type === 'issues' || type === 'pull_requests')
        result.items = [0, 1, 2].map((i) => ({
          project_id: 'rssh',
          github_id: 500 + i,
          kind: type === 'issues' ? 'issue' : 'pull_request',
          full_name: 'shihuili1218/rssh',
          number: 340 + i,
          title: ['终端分屏焦点与键盘导航', '保留工作区窗口布局', '优化连接异常提示'][i],
          author_id: 100 + i,
          author_login: ['sarah-chen', 'tom-west', 'mika-dev'][i],
          state: i === 2 ? 'closed' : 'open',
          draft: 0,
          labels: [i === 0 ? 'bug' : 'enhancement'],
          created_at: now - (i + 1) * day,
          updated_at: now - 3600,
          closed_at: i === 2 ? now - 3600 : null,
          merged_at: null,
          first_seen_at: now - (i + 1) * day,
          first_reply_at: i === 0 ? null : now - i * day,
          review_state: i === 0 ? null : 'approved',
          reviewed_at: i === 0 ? null : now - 3600,
        }));
      if (type === 'issues' || type === 'pull_requests') result.total = result.items.length;
      return route.fulfill({ json: result });
    }
    return route.fulfill({ json: {} });
  });
}
