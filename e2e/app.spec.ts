import { expect, test } from '@playwright/test';

const password = 'browser-test-password-2026';

test('first-run setup, required token guidance, settings and re-login', async ({
  page,
  request,
}) => {
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
  await expect(page.getByRole('button', { name: '添加项目', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('请先配置 GITHUB_TOKEN');
  await page.getByRole('button', { name: '配置 GitHub Token', exact: true }).click();
  await expect(page.getByRole('heading', { name: '观测站设置' })).toBeVisible();
  await expect(page.getByText('请配置 GITHUB_TOKEN（必需）', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '创建 GitHub Token' })).toHaveAttribute(
    'href',
    'https://github.com/settings/personal-access-tokens/new',
  );
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
      json: { dailyHour: 23, timezone: 'Asia/Shanghai', githubTokenConfigured: true },
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
