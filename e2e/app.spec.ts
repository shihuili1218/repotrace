import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

const password = 'browser-test-password-2026';
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
      description: 'Webhook browser test',
      language: 'TypeScript',
    },
    ...(event === 'star'
      ? {
          action: 'created',
          sender: { id: 1, login: 'octocat' },
          starred_at: new Date().toISOString(),
        }
      : {}),
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

test('sets up admin, connects a signed webhook, records users, rotates secret and re-logs in', async ({
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
  await expect(page.getByRole('heading', { name: '项目总览' })).toBeVisible();
  await page.getByRole('button', { name: '添加第一个项目' }).click();
  await page.getByLabel('GitHub 仓库', { exact: true }).fill('https://evil.example/project');
  await page.getByRole('button', { name: '生成 Webhook 配置' }).click();
  await expect(page.getByRole('alert')).toContainText('仓库格式');
  await page.getByLabel('GitHub 仓库', { exact: true }).fill('owner/repo');
  await page.getByRole('button', { name: '生成 Webhook 配置' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '连接 GitHub Webhook' })).toBeVisible();
  await expect(dialog).toContainText('只勾选 Stars');
  const url = await page.getByLabel('Payload URL', { exact: true }).inputValue();
  const secret = await page.getByLabel('Secret（签名密钥）', { exact: true }).inputValue();
  expect(secret).toMatch(/^[a-f0-9]{64}$/);
  expect((await deliver(request, url, 'wrong')).status()).toBe(401);
  expect((await deliver(request, url, secret)).status()).toBe(200);
  await dialog.getByRole('button', { name: '检查连接' }).click();
  await expect(dialog.getByRole('status')).toContainText('已收到签名事件');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  const id = crypto.randomUUID();
  expect((await deliver(request, url, secret, 'star', {}, id)).status()).toBe(200);
  expect((await deliver(request, url, secret, 'star', {}, id)).status()).toBe(200);
  expect(
    (
      await deliver(request, url, secret, 'star', {
        action: 'deleted',
        sender: { id: 2, login: 'departed-user' },
        starred_at: null,
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: '刷新页面数据' }).click();
  await expect(page.locator('.repo-metrics')).toContainText('519');
  await expect(page.locator('.repo-metrics')).toContainText('2');
  await expect(page.getByRole('link', { name: 'octocat', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'departed-user', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: '配置 Webhook', exact: true }).click();
  await expect(page.locator('#hook-secret')).toHaveCount(0);
  await dialog.getByRole('button', { name: '重新生成 Secret' }).click();
  await dialog.getByRole('button', { name: '确认生成新密钥' }).click();
  const replacement = await page.getByLabel('Secret（签名密钥）', { exact: true }).inputValue();
  expect(replacement).not.toBe(secret);
  expect((await deliver(request, url, secret)).status()).toBe(401);
  expect((await deliver(request, url, replacement)).status()).toBe(200);
  await dialog.getByRole('button', { name: '检查连接' }).click();
  await expect(dialog.getByRole('status')).toContainText('已收到签名事件');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '监控项目', exact: true }).click();
  await page.getByRole('button', { name: '暂停记录', exact: true }).click();
  await expect(page.locator('.repo-card .pill')).toHaveText('已暂停');
  expect(
    (
      await deliver(request, url, replacement, 'star', { sender: { id: 3, login: 'ignored-user' } })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: '恢复记录', exact: true }).click();
  await expect(page.locator('.repo-metrics')).toContainText('2');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('每日汇总时间').selectOption('22');
  await page.getByRole('button', { name: '保存计划' }).click();
  await expect(page.locator('.toast')).toContainText('汇总计划已保存');
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('每日汇总时间')).toHaveValue('22');
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '欢迎回到你的观测站' })).toBeVisible();
  await page.getByLabel('管理员密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '进入观测站' }).click();
  await expect(page.getByRole('alert')).toContainText('密码不正确');
  await page.getByLabel('管理员密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入观测站' }).click();
  await expect(page.getByRole('heading', { name: '项目总览' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '配置 Webhook', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('button', { name: 'Star 动态', exact: true }).click();
  await expect(page.getByRole('heading', { name: '每一份关注，都有记录' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  event_count: 360,
};
async function fixture(page: import('@playwright/test').Page, data: unknown) {
  await page.route('**/api/auth/status', (r) =>
    r.fulfill({ json: { initialized: true, authenticated: true } }),
  );
  await page.route('**/api/settings', (r) =>
    r.fulfill({ json: { dailyHour: 23, timezone: 'Asia/Shanghai', lastScheduledAt: now } }),
  );
  await page.route('**/api/dashboard?*', (r) => r.fulfill({ json: data }));
}

test('renders populated charts, user changes and summaries on desktop and mobile', async ({
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
    })),
    summaries: [
      {
        id: 'daily',
        project_id: 'visual',
        full_name: visualRepo.full_name,
        kind: 'daily',
        source: 'webhook',
        day: day(0),
        period_start: now - 86400,
        period_end: now,
        computed_at: now,
        total: 1248,
        added: 28,
        removed: 3,
        event_count: 35,
      },
    ],
    changes: [
      {
        id: 'event1',
        user_id: 1,
        login: 'octocat',
        kind: 'added',
        starred_at: new Date().toISOString(),
        full_name: visualRepo.full_name,
        observed_at: now,
      },
      {
        id: 'event2',
        user_id: 2,
        login: 'departed-user',
        kind: 'removed',
        starred_at: null,
        full_name: visualRepo.full_name,
        observed_at: now,
      },
    ],
    changeTotal: 2,
    page: 1,
    eventCounts: { added: 28, removed: 3 },
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
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('button', { name: 'Star 动态', exact: true }).click();
  await expect(page.getByRole('heading', { name: '每日汇总与历史' })).toBeVisible();
});

test('guides a migrated project to generate its first webhook secret', async ({ page }) => {
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
      },
    ],
    history: [],
    summaries: [],
    changes: [],
    changeTotal: 0,
    page: 1,
    eventCounts: { added: 0, removed: 0 },
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
  await expect(page.getByRole('link', { name: '仓库 Settings → Webhooks' })).toHaveAttribute(
    'href',
    'https://github.com/rssh-org/rssh/settings/hooks',
  );
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '配置 Webhook', exact: true }).click();
  await expect(page.locator('#hook-secret')).toHaveCount(0);
});
