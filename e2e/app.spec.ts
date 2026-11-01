import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
const password = 'browser-test-password-2026';
const origin = 'http://127.0.0.1:8788';
async function deliver(
  request: APIRequestContext,
  url: string,
  secret: string,
  event = 'ping',
  patch: Record<string, unknown> = {},
  delivery = crypto.randomUUID(),
) {
  const raw = JSON.stringify({
    repository: {
      id: 100,
      full_name: 'owner/repo',
      stargazers_count: 519,
      forks_count: 3,
      description: 'Webhook browser test',
      language: 'TypeScript',
    },
    sender: { id: 1, login: 'octocat' },
    ...(event === 'star' ? { action: 'created', starred_at: new Date().toISOString() } : {}),
    ...patch,
  });
  return request.post(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': delivery,
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    },
    data: raw,
  });
}

test('sets up admin, connects a webhook, rotates secrets and removes the nightly schedule', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expect((await request.get('/api/dashboard')).status()).toBe(401);
  await page.goto('/');
  await page.getByLabel('设置管理员密码').fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建我的观测站' }).click();
  await page.getByRole('button', { name: '添加第一个项目' }).click();
  await page.getByLabel('GitHub 仓库', { exact: true }).fill('https://evil.example/project');
  await page.getByRole('button', { name: '生成 Webhook 配置' }).click();
  await expect(page.getByRole('alert')).toContainText('仓库格式');
  await page.getByLabel('GitHub 仓库', { exact: true }).fill('owner/repo');
  await page.getByRole('button', { name: '生成 Webhook 配置' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Pull request reviews');
  await expect(dialog).toContainText('Releases');
  const url = await page.getByLabel('Payload URL', { exact: true }).inputValue();
  const secret = await page.getByLabel('Secret（签名密钥）', { exact: true }).inputValue();
  expect(secret).toMatch(/^[a-f0-9]{64}$/);
  expect((await deliver(request, url, 'wrong')).status()).toBe(401);
  expect((await deliver(request, url, secret)).status()).toBe(200);
  await dialog.getByRole('button', { name: '检查连接' }).click();
  await expect(dialog.getByRole('status')).toContainText('已收到签名事件');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  const id = crypto.randomUUID();
  await deliver(request, url, secret, 'star', {}, id);
  await deliver(request, url, secret, 'star', {}, id);
  await deliver(request, url, secret, 'star', {
    action: 'deleted',
    sender: { id: 2, login: 'departed-user' },
    starred_at: null,
  });
  await page.getByRole('button', { name: '刷新页面数据' }).click();
  await expect(page.locator('.repo-metrics')).toContainText('519');
  await expect(page.locator('.repo-metrics')).toContainText('3');
  await expect(page.locator('.hook-timestamp')).toContainText('已记录 2 条事件');
  await expect(page.getByRole('link', { name: 'octocat', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '配置 Webhook', exact: true }).click();
  await expect(page.locator('#hook-secret')).toHaveCount(0);
  await dialog.getByRole('button', { name: '重新生成 Secret' }).click();
  await dialog.getByRole('button', { name: '确认生成新密钥' }).click();
  const replacement = await page.getByLabel('Secret（签名密钥）', { exact: true }).inputValue();
  expect(replacement).not.toBe(secret);
  expect((await deliver(request, url, secret)).status()).toBe(401);
  await deliver(request, url, replacement);
  await dialog.getByRole('button', { name: '检查连接' }).click();
  await expect(dialog.getByRole('status')).toContainText('已收到签名事件');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '监控项目', exact: true }).click();
  await page.getByRole('button', { name: '暂停记录', exact: true }).click();
  await expect(page.locator('.repo-card .pill')).toHaveText('已暂停');
  await deliver(request, url, replacement, 'star', { sender: { id: 3, login: 'ignored-user' } });
  await page.getByRole('button', { name: '恢复记录', exact: true }).click();
  await expect(page.locator('.hook-timestamp')).toContainText('已记录 2 条事件');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '事件驱动，实时统计' })).toBeVisible();
  await expect(page.getByLabel('每日汇总时间')).toHaveCount(0);
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('管理员密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '进入观测站' }).click();
  await expect(page.getByRole('alert')).toContainText('密码不正确');
  await page.getByLabel('管理员密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入观测站' }).click();
  await expect(page.getByRole('heading', { name: '项目总览' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '配置 Webhook', exact: true }).click();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('button', { name: '项目动态', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目的每一步，都有记录' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('shows signed fork, issue, PR and release events in modules and the unified activity feed', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { password } });
  const data = await (await page.request.get('/api/dashboard')).json();
  const id = data.repositories[0].id;
  const config = await (
    await page.request.post(`/api/repositories/${id}/webhook`, {
      headers: { Origin: origin },
      data: {},
    })
  ).json();
  const now = Math.floor(Date.now() / 1000);
  const iso = (at: number) => new Date(at * 1000).toISOString();
  const author = { id: 50, login: 'contributor' };
  const issue = {
    id: 201,
    number: 7,
    title: '安装失败',
    user: author,
    state: 'open',
    labels: [{ name: 'bug' }],
    created_at: iso(now - 7200),
    updated_at: iso(now - 10),
    closed_at: null,
  };
  const pr = {
    id: 202,
    number: 8,
    title: '修复安装问题',
    user: author,
    state: 'open',
    draft: false,
    labels: [{ name: 'fix' }],
    head: { sha: 'a'.repeat(40) },
    created_at: iso(now - 7200),
    updated_at: iso(now - 10),
    closed_at: null,
  };
  const events: [string, Record<string, unknown>][] = [
    [
      'fork',
      {
        forkee: {
          id: 301,
          full_name: 'forker/repo',
          owner: { id: 60, login: 'forker' },
          created_at: iso(now),
        },
      },
    ],
    ['issues', { action: 'opened', issue }],
    [
      'issue_comment',
      {
        action: 'created',
        issue,
        comment: { user: { id: 70, login: 'helper' }, created_at: iso(now - 3600) },
      },
    ],
    [
      'issues',
      {
        action: 'opened',
        issue: {
          ...issue,
          id: 204,
          number: 10,
          title: '支持更多终端',
          labels: [{ name: 'enhancement' }],
        },
      },
    ],
    ['pull_request', { action: 'opened', pull_request: pr }],
    [
      'pull_request_review',
      {
        action: 'submitted',
        pull_request: pr,
        review: {
          state: 'approved',
          commit_id: 'a'.repeat(40),
          user: { id: 70, login: 'helper' },
          submitted_at: iso(now - 5),
        },
      },
    ],
    [
      'pull_request',
      {
        action: 'closed',
        pull_request: {
          ...pr,
          state: 'closed',
          merged: true,
          merged_at: iso(now),
          closed_at: iso(now),
          updated_at: iso(now),
        },
      },
    ],
    [
      'pull_request',
      { action: 'opened', pull_request: { ...pr, id: 203, number: 9, title: '优化终端体验' } },
    ],
    [
      'release',
      {
        action: 'published',
        release: {
          id: 401,
          tag_name: 'v1.1.0',
          name: '第一版',
          author,
          draft: false,
          prerelease: false,
          created_at: iso(now - 86520),
          published_at: iso(now - 86460),
        },
      },
    ],
    [
      'release',
      {
        action: 'published',
        release: {
          id: 402,
          tag_name: 'v1.2.0',
          name: '安装改进',
          author,
          draft: false,
          prerelease: false,
          created_at: iso(now - 120),
          published_at: iso(now - 60),
          assets: [
            {
              id: 701,
              name: 'rssh-linux.zip',
              size: 2048,
              content_type: 'application/zip',
              state: 'uploaded',
              download_count: 100,
              browser_download_url:
                'https://github.com/owner/repo/releases/download/v1.2.0/rssh-linux.zip',
            },
            {
              id: 702,
              name: 'rssh-windows.zip',
              size: 4096,
              content_type: 'application/zip',
              state: 'uploaded',
              download_count: 200,
              browser_download_url:
                'https://github.com/owner/repo/releases/download/v1.2.0/rssh-windows.zip',
            },
          ],
        },
      },
    ],
  ];
  for (const [event, payload] of events)
    expect((await deliver(request, config.url, config.secret, event, payload)).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByText('v1.2.0', { exact: true })).toHaveCount(0);
  await expect(page.getByText('最近记录的正式版', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Star', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: '项目 Star 总量', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Fork', exact: true }).click();
  await expect(page.getByRole('img', { name: '每日新增 Fork 趋势图' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'forker/repo', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Issue', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Issue 每日变化图' })).toBeVisible();
  await expect(page.getByRole('link', { name: '#7 安装失败', exact: true })).toBeVisible();
  await expect(page.locator('.module-metrics')).toContainText('1.0 小时');
  await page.getByLabel('筛选状态').selectOption('unanswered');
  await expect(page.getByRole('link', { name: '#10 支持更多终端', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '#7 安装失败', exact: true })).toHaveCount(0);
  await page.getByLabel('筛选状态').selectOption('all');
  await page.getByLabel('筛选标签').selectOption('bug');
  await expect(page.getByRole('link', { name: '#7 安装失败', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Pull Request', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PR 每日变化图' })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('已合并');
  await expect(page.locator('tbody')).toContainText('2.0 小时');
  await expect(page.locator('.contributors-list')).toContainText('2 个 PR · 1 个已合并');
  await page.getByLabel('筛选状态').selectOption('awaiting_review');
  await expect(page.getByRole('link', { name: '#9 优化终端体验', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  await expect(page.getByRole('link', { name: 'v1.2.0', exact: true })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('正式版');
  await expect(page.locator('tbody')).toContainText('1.0 天');
  await page.route(`**/api/repositories/${id}/releases/402/assets`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      json: {
        releaseId: 402,
        tag: 'v1.2.0',
        source: 'github',
        observedAt: now,
        deleted: false,
        assets: [
          {
            project_id: id,
            release_id: 402,
            github_id: 701,
            name: 'rssh-linux.zip',
            size: 2048,
            content_type: 'application/zip',
            state: 'uploaded',
            download_count: 150,
            download_url: 'https://github.com/owner/repo/releases/download/v1.2.0/rssh-linux.zip',
            observed_at: now,
          },
          {
            project_id: id,
            release_id: 402,
            github_id: 702,
            name: 'rssh-windows.zip',
            size: 4096,
            content_type: 'application/zip',
            state: 'uploaded',
            download_count: 250,
            download_url: 'https://github.com/owner/repo/releases/download/v1.2.0/rssh-windows.zip',
            observed_at: now,
          },
        ],
      },
    });
  });
  await page.getByRole('button', { name: 'v1.2.0 产物下载量', exact: true }).click();
  const panel = page.getByRole('region', { name: '产物下载量' });
  await expect(panel.locator('tbody tr')).toHaveCount(2);
  await expect(panel.locator('tbody')).toContainText('150');
  await expect(panel.locator('tbody')).toContainText('250');
  await expect(panel).toContainText('400');
  await expect(panel.getByRole('img', { name: /趋势图|柱状图|历史|变化图/ })).toHaveCount(0);

  await page.screenshot({ path: 'test-results/releases-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole('link', { name: 'rssh-linux.zip', exact: true }).scrollIntoViewIfNeeded();
  await expect(panel.getByText('150', { exact: true })).toBeInViewport();
  await expect(panel.getByRole('link', { name: 'rssh-linux.zip', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/releases-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('button', { name: '项目动态', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目动态', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'PR', exact: true }).click();
  await expect(page.locator('.feed-title').first()).toContainText('优化终端体验');
  expect(errors).toEqual([]);
});

const now = Math.floor(Date.now() / 1000);
const visualRepo = {
  id: 'visual',
  github_id: 100,
  full_name: 'rssh-org/rssh',
  description: '看见项目的成长，也看见背后的人。',
  language: 'TypeScript',
  created_at: now - 86400 * 30,
  enabled: 1,
  webhookConfigured: true,
  first_received_at: now - 86400 * 30,
  last_received_at: now,
  last_star_at: now,
  current_total: 1248,
  total_reported_at: now,
  current_forks: 86,
  forks_reported_at: now,
  event_count: 360,
  receivedEvents: ['star', 'fork', 'issues', 'pull_request', 'release'],
};
const metricFixture = {
  forks: 8,
  issuesOpened: 6,
  issuesClosed: 4,
  prsOpened: 5,
  prsMerged: 3,
  prsClosed: 1,
  releasesPublished: 2,
  openIssues: 5,
  unansweredIssues: 2,
  openPRs: 3,
  awaitingReview: 1,
  contributors: 4,
  avgReplySeconds: 3600,
  avgMergeSeconds: 7200,
  latestRelease: {
    project_id: 'visual',
    github_id: 99,
    full_name: visualRepo.full_name,
    tag_name: 'v1.2.0',
    name: '安装改进',
    author_login: 'octocat',
    prerelease: 0,
    draft: 0,
    created_at: now - 120,
    published_at: now - 60,
    published_received_at: now - 60,
    deleted_at: null,
    first_seen_at: now - 60,
  },
};
async function fixture(page: import('@playwright/test').Page, data: unknown) {
  await page.route('**/api/auth/status', (r) =>
    r.fulfill({ json: { initialized: true, authenticated: true, setupProtected: false } }),
  );
  await page.route('**/api/dashboard?*', (r) => r.fulfill({ json: data }));
}

test('renders aggregate overview charts without release details on desktop and mobile', async ({
  page,
}) => {
  const day = (offset: number) =>
    new Date((now + 8 * 3600 - offset * 86400) * 1000).toISOString().slice(0, 10);
  await fixture(page, {
    repositories: [visualRepo],
    history: Array.from({ length: 30 }, (_, i) => ({
      day: day(29 - i),
      total: 714 + i * 18 + Math.round(Math.sin(i / 4) * 35),
      added: 15 + (i % 13),
      removed: i % 4,
      repos: 1,
      fork_total: 50 + i,
      fork_repos: 1,
      fork_new: i % 3,
      issue_opened: i % 4,
      issue_closed: i % 3,
      pr_opened: i % 2,
      pr_merged: i % 3,
      pr_closed: i % 4 === 0 ? 1 : 0,
    })),
    summaries: [],
    changes: [
      {
        id: 'one',
        user_id: 1,
        login: 'octocat',
        kind: 'added',
        starred_at: new Date().toISOString(),
        full_name: visualRepo.full_name,
        observed_at: now,
      },
    ],
    changeTotal: 1,
    page: 1,
    eventCounts: { added: 28, removed: 3 },
    metrics: metricFixture,
    releaseMarkers: [metricFixture.latestRelease],
    timeline: [],
    timelineTotal: 0,
  });
  await page.goto('/');
  await expect(page.getByRole('img', { name: '每日 Star 总数趋势图' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'octocat', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
});

test('guides a migrated project through first-time signing setup and lists the new event choices', async ({
  page,
}) => {
  let configured = false;
  const data = () => ({
    repositories: [
      {
        ...visualRepo,
        webhookConfigured: configured,
        last_received_at: null,
        first_received_at: null,
        current_total: null,
        total_reported_at: null,
        last_star_at: null,
        event_count: 0,
        receivedEvents: [],
      },
    ],
    history: [],
    summaries: [],
    changes: [],
    changeTotal: 0,
    page: 1,
    eventCounts: { added: 0, removed: 0 },
    metrics: { ...metricFixture, latestRelease: null },
    releaseMarkers: [],
    timeline: [],
    timelineTotal: 0,
  });
  await fixture(page, data());
  await page.route('**/api/dashboard?*', (r) => r.fulfill({ json: data() }));
  await page.route('**/api/repositories/visual/webhook', (r) => {
    if (r.request().method() === 'POST') configured = true;
    return r.fulfill({
      json: {
        id: 'visual',
        full_name: visualRepo.full_name,
        url: 'https://example.workers.dev/hooks/github/visual',
        settingsUrl: 'https://github.com/rssh-org/rssh/settings/hooks',
        ...(r.request().method() === 'POST' ? { secret: 'a'.repeat(64) } : {}),
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('等待连接 Webhook');
  await page.getByRole('button', { name: '配置 Webhook', exact: true }).click();
  await page.getByRole('button', { name: '生成签名密钥', exact: true }).click();
  await page.getByRole('button', { name: '确认生成新密钥' }).click();
  await expect(page.getByLabel('Secret（签名密钥）', { exact: true })).toHaveValue('a'.repeat(64));
  await expect(page.getByLabel('支持的 Webhook 事件').locator(':scope > div')).toHaveCount(7);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '配置 Webhook', exact: true }).click();
  await expect(page.locator('#hook-secret')).toHaveCount(0);
});

test('keeps overview aggregated and shows project Star statistics between two Release publication times', async ({
  page,
  request,
}) => {
  await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { password } });
  const config = await (
    await page.request.post('/api/repositories', {
      headers: { Origin: origin },
      data: { repository: 'owner/interval' },
    })
  ).json();
  const repo = (total: number) => ({
    id: 102,
    full_name: 'owner/interval',
    stargazers_count: total,
    forks_count: 0,
  });
  const now = Math.floor(Date.now() / 1000);
  const base = {
    author: { id: 1, login: 'octocat' },
    draft: false,
    prerelease: false,
    created_at: new Date((now - 1) * 1000).toISOString(),
  };
  await deliver(request, config.url, config.secret, 'release', {
    repository: repo(0),
    action: 'published',
    release: {
      ...base,
      id: 801,
      tag_name: 'vA',
      name: 'A',
      published_at: new Date((now - 1) * 1000).toISOString(),
    },
  });
  await deliver(request, config.url, config.secret, 'star', {
    repository: repo(1),
    sender: { id: 90, login: 'version-user' },
  });
  const snapshot = await (
    await page.request.get(`/api/dashboard?repo=${config.id}&scope=project`)
  ).json();
  const cutoff =
    snapshot.timeline.find((e: { category: string }) => e.category === 'star').received_at + 1;
  await expect.poll(() => Math.floor(Date.now() / 1000) >= cutoff).toBe(true);
  await deliver(request, config.url, config.secret, 'release', {
    repository: repo(1),
    action: 'published',
    release: {
      ...base,
      id: 802,
      tag_name: 'vB',
      name: 'B',
      published_at: new Date(cutoff * 1000).toISOString(),
    },
  });
  await deliver(request, config.url, config.secret, 'star', {
    repository: repo(0),
    action: 'deleted',
    sender: { id: 90, login: 'version-user' },
    starred_at: null,
  });
  await page.goto('/');
  await expect(page.getByLabel('选择项目')).toHaveValue('');
  await expect(page.getByText('vB', { exact: true })).toHaveCount(0);
  await page
    .locator('.repo-card')
    .filter({ hasText: 'owner/interval' })
    .getByRole('button', { name: '查看数据', exact: true })
    .click();
  await expect(page.getByLabel('项目数据选择项目')).toHaveValue(config.id);
  await expect(page.getByLabel('选择项目', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Star', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByLabel('项目统计时间').selectOption('releases');
  await expect(page.getByLabel('起始 Release')).toHaveValue('801');
  await expect(page.getByLabel('结束 Release')).toHaveValue('802');
  await expect(page.locator('.range-description')).toContainText('vA → vB');
  await expect(
    page.locator('.module-metric').filter({ hasText: '截至区间末 Stars' }).locator('strong'),
  ).toHaveText('1');
  await expect(
    page.locator('.module-metric').filter({ hasText: '区间净新增用户' }).locator('strong'),
  ).toHaveText('1');
  await expect(page.getByRole('link', { name: 'version-user', exact: true })).toBeVisible();
  await page.getByLabel('Star 记录方式').selectOption('events');
  await expect(page.getByRole('link', { name: 'version-user', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/project-star-interval-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/project-star-interval-mobile.png', fullPage: true });
});

test('switching projects during a public Release sync cannot replace the newly selected project data', async ({
  page,
}) => {
  await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { password } });
  const list = await (await page.request.get('/api/dashboard')).json();
  const first = list.repositories.find((r: { full_name: string }) => r.full_name === 'owner/repo');
  const second = list.repositories.find(
    (r: { full_name: string }) => r.full_name === 'owner/interval',
  );
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let entered = false;
  await page.route(`**/api/repositories/${first.id}/releases/sync`, async (route) => {
    entered = true;
    await gate;
    await route.fulfill({
      json: { nextPage: null, count: 0, updatedAt: Math.floor(Date.now() / 1000) },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await expect(page.getByLabel('项目数据选择项目')).toHaveValue(first.id);
  await page.getByRole('button', { name: '同步公开 Release', exact: true }).click();
  await expect.poll(() => entered).toBe(true);
  await page.getByLabel('项目数据选择项目').selectOption(second.id);
  await expect(page.locator('.range-description')).toContainText('owner/interval');
  await expect(page.getByRole('heading', { name: '项目 Star 总量', exact: true })).toBeVisible();
  releaseGate();
  await expect(page.getByLabel('项目数据选择项目')).toHaveValue(second.id);
  await expect(page.locator('.range-description')).toContainText('owner/interval');
});
