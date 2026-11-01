import { expect, test } from '@playwright/test';

const status = { initialized: true, authenticated: false, setupProtected: false };

test('recovers from transient failures while opening the station', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/auth/status', async (route) => {
    attempts++;
    if (attempts < 3) await route.abort('failed');
    else await route.fulfill({ json: status });
  });
  await page.goto('/');
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible();
  expect(attempts).toBe(3);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('设置管理员密码')).toHaveCount(0);
});

test('shows a useful connection error and reconnects when the network recovers', async ({
  page,
}) => {
  let available = false;
  let attempts = 0;
  await page.route('**/api/auth/status', async (route) => {
    attempts++;
    if (available) await route.fulfill({ json: status });
    else await route.abort('failed');
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('无法连接观测站');
  expect(attempts).toBe(3);
  available = true;
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible();
  expect(attempts).toBe(4);
});

test('bounds requests that stall after response headers and recovers', async ({ page }) => {
  await page.clock.install();
  let attempts = 0;
  // Simulate a response whose body never completes, rather than a quick network rejection.
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (input === '/api/auth/status' && !sessionStorage.getItem('stalled')) {
        sessionStorage.setItem('stalled', 'yes');
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener('abort', () =>
                controller.error(new DOMException('Aborted', 'AbortError')),
              );
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return originalFetch(input, init);
    };
  });
  await page.route('**/api/auth/status', async (route) => {
    attempts++;
    await route.fulfill({ json: status });
  });
  await page.goto('/');
  await expect(page.getByText('正在打开你的观测站…')).toBeVisible();
  await page.clock.runFor(10500);
  await expect(page.getByLabel('管理员密码', { exact: true })).toBeVisible();
  expect(attempts).toBe(1);
});

test('does not replay a login when its response is lost', async ({ page }) => {
  let attempts = 0;
  await page.clock.install();
  await page.route('**/api/auth/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/auth/login', async (route) => {
    attempts++;
    await route.abort('failed');
  });
  await page.goto('/');
  await page.getByLabel('管理员密码', { exact: true }).fill('example-password-2026');
  await page.getByRole('button', { name: '进入观测站' }).click();
  await expect(page.getByRole('alert')).toContainText('无法确认操作结果');
  await page.clock.runFor(2000);
  expect(attempts).toBe(1);
});

for (const [name, body, message] of [
  ['HTML', '<html>Upstream unavailable</html>', '无效响应'],
  ['incomplete JSON', '{}', '无法确认观测站登录状态'],
] as const) {
  test(`does not treat a ${name} response as an uninitialized station`, async ({ page }) => {
    await page.route('**/api/auth/status', (route) =>
      route.fulfill({ contentType: 'application/json', body }),
    );
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByLabel('设置管理员密码')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重新连接' })).toBeVisible();
  });
}
