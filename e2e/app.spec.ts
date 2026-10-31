import { expect, test } from '@playwright/test';

const password = 'browser-test-password-2026';

test('first-run setup, project token entry, settings and re-login', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const denied = await request.get('/api/dashboard');
  expect(denied.status()).toBe(401);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '开启你的项目观测站' })).toBeVisible();
  await page.getByLabel('设置管理员密码').fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建我的观测站' }).click();
  await expect(page.getByRole('heading', { name: '项目总览' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '从第一个项目开始' })).toBeVisible();
  await page.getByRole('button', { name: '添加第一个项目' }).click();
  await expect(page.getByLabel('GitHub Token', { exact: true })).toHaveAttribute(
    'type',
    'password',
  );
  await expect(page.getByRole('link', { name: '创建 GitHub Token' })).toHaveAttribute(
    'href',
    'https://github.com/settings/personal-access-tokens/new',
  );
  await page.getByLabel('GitHub 仓库', { exact: true }).fill('https://not-github.example/project');
  await page.getByLabel('GitHub Token', { exact: true }).fill('test-project-token');
  await page.getByRole('button', { name: '开始监控' }).click();
  await expect(page.getByRole('alert')).toContainText('仓库格式');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '观测站设置' })).toBeVisible();
  await page.getByLabel('每日开始时间').selectOption('22');
  await page.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByRole('status')).toContainText('采集时间已更新');
  await page.reload();
  await expect(page.getByRole('heading', { name: '项目总览' })).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '欢迎回到你的观测站' })).toBeVisible();
  await page.getByLabel('管理员密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '进入观测站' }).click();
  await expect(page.getByRole('alert')).toContainText('密码不正确');
  await page.getByLabel('管理员密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入观测站' }).click();
  await expect(page.getByRole('heading', { name: '项目总览' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('button', { name: 'Star 动态', exact: true }).click();
  await expect(page.getByRole('heading', { name: '每一份关注，都有记录' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('renders populated charts and change lists on desktop and mobile', async ({ page }) => {
  // Presentation fixture only. Collector/API behavior is tested against D1 in tests/worker.test.ts.
  const now = Math.floor(Date.now() / 1000);
  const day = (offset: number) =>
    new Date((now + 8 * 3600 - offset * 86400) * 1000).toISOString().slice(0, 10);
  const repo = {
    id: 'visual-repo',
    github_id: 1,
    full_name: 'shihuili1218/repotrace',
    description: '看见项目的成长，也看见背后的人。个人 GitHub 项目观测站。',
    language: 'TypeScript',
    created_at: now - 86400 * 30,
    enabled: 1,
    tokenConfigured: true,
    active: null,
    lastError: null,
  };
  const latest = {
    id: 'visual-snapshot',
    repo_id: repo.id,
    kind: 'daily',
    day: day(0),
    status: 'complete',
    page: 13,
    total: 1248,
    expected_total: 1248,
    added: 28,
    removed: 3,
    comparison_id: 'previous',
    started_at: now - 300,
    completed_at: now,
    error: null,
    retry_at: 0,
    failures: 0,
    lease_token: null,
    lease_until: 0,
  };
  await page.route('**/api/auth/status', (route) =>
    route.fulfill({ json: { initialized: true, authenticated: true } }),
  );
  await page.route('**/api/settings', (route) =>
    route.fulfill({
      json: { dailyHour: 23, timezone: 'Asia/Shanghai', lastScheduledAt: now },
    }),
  );
  await page.route('**/api/dashboard?*', (route) =>
    route.fulfill({
      json: {
        repositories: [{ ...repo, latest }],
        history: Array.from({ length: 30 }, (_, i) => ({
          day: day(29 - i),
          total: 714 + i * 18 + Math.round(Math.sin(i / 4) * 35),
          added: 15 + (i % 13),
          removed: i % 4,
          repos: 1,
        })),
        snapshots: [{ ...latest, full_name: repo.full_name, comparison_day: day(1) }],
        changes: [
          {
            user_id: 1,
            login: 'octocat',
            kind: 'added',
            starred_at: new Date().toISOString(),
            full_name: repo.full_name,
            snapshot_id: latest.id,
            observed_at: now,
          },
          {
            user_id: 2,
            login: 'example-developer',
            kind: 'removed',
            starred_at: null,
            full_name: repo.full_name,
            snapshot_id: latest.id,
            observed_at: now,
          },
        ],
        changeTotal: 2,
        page: 1,
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('img', { name: '每日 Star 总数趋势图' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'octocat GitHub 开发者', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('img', { name: '每日 Star 总数趋势图' })).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
});

test('sets a token for an existing project and automatically continues its 519-star snapshot', async ({
  page,
}) => {
  // Presentation/controller fixture. API, encryption, and paging run against D1 in worker.test.ts.
  const now = Math.floor(Date.now() / 1000);
  let configured = false;
  let total = 0;
  let continuations = 0;
  const snapshot = {
    id: 'stalled-job',
    repo_id: 'stalled-repo',
    kind: 'baseline',
    day: '2026-11-01',
    status: 'collecting',
    page: 1,
    total: 0,
    expected_total: 519,
    added: 0,
    removed: 0,
    comparison_id: null,
    started_at: now - 1800,
    completed_at: null,
    error: null,
    retry_at: 0,
    failures: 0,
    lease_token: null,
    lease_until: 0,
  };
  const dashboard = () => {
    const current = { ...snapshot, page: Math.floor(total / 100) + 1, total };
    const done = total === 519;
    return {
      repositories: [
        {
          id: 'stalled-repo',
          github_id: 1207661371,
          full_name: 'rssh-org/rssh',
          description: '',
          language: 'TypeScript',
          created_at: now - 1800,
          enabled: 1,
          tokenConfigured: configured,
          lastError: null,
          latest: done ? { ...current, status: 'complete', completed_at: now } : null,
          active: done ? null : current,
        },
      ],
      snapshots: [
        {
          ...current,
          status: done ? 'complete' : 'collecting',
          full_name: 'rssh-org/rssh',
          comparison_day: null,
        },
      ],
      history: [],
      changes: [],
      changeTotal: 0,
      page: 1,
    };
  };
  await page.route('**/api/auth/status', (route) =>
    route.fulfill({ json: { initialized: true, authenticated: true } }),
  );
  await page.route('**/api/settings', (route) =>
    route.fulfill({ json: { dailyHour: 23, timezone: 'Asia/Shanghai', lastScheduledAt: null } }),
  );
  await page.route('**/api/dashboard?*', (route) => route.fulfill({ json: dashboard() }));
  await page.route('**/api/repositories/stalled-repo/token', async (route) => {
    expect(route.request().method()).toBe('PUT');
    expect(route.request().postDataJSON()).toEqual({ token: 'replacement-test-token' });
    configured = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/snapshots/stalled-job/continue', async (route) => {
    if (total === 519)
      return route.fulfill({ status: 409, json: { error: '此快照已结束，请刷新查看结果。' } });
    continuations++;
    total = Math.min(519, total + 100);
    await route.fulfill({
      json: {
        status: total === 519 ? 'complete' : 'collecting',
        total,
        page: continuations + 1,
        error: null,
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('需要设置 GitHub Token');
  await page.getByRole('button', { name: '设置项目 Token', exact: true }).click();
  await expect(page.getByLabel('GitHub Token', { exact: true })).toHaveValue('');
  await page.getByLabel('GitHub Token', { exact: true }).fill('replacement-test-token');
  await page.getByRole('button', { name: '验证并保存' }).click();
  await expect(page.locator('.repo-metrics')).toContainText('519', { timeout: 15000 });
  await expect(page.locator('.repo-card-heading .pill')).toHaveText('监控中');
  expect(continuations).toBe(6);
  await page.getByRole('button', { name: '更新项目 Token', exact: true }).click();
  await expect(page.getByLabel('GitHub Token', { exact: true })).toHaveValue('');
});
