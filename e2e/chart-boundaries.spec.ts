import { expect, test } from '@playwright/test';
import { demoDashboard, demoReleases, installDesignFixture } from './design-fixture';
import type { ReleaseBoundary } from '../shared/types';

test('shows recorded Star changes when repository totals are unknown', async ({ page }) => {
  await installDesignFixture(page);
  let added = 2;
  await page.route('**/api/dashboard?*', (route) => {
    const data = demoDashboard('rssh', 7);
    data.repositories = data.repositories.slice(0, 1).map((repo) => ({
      ...repo,
      current_total: null,
      total_reported_at: null,
    }));
    data.history = data.history.map((point, i) => ({
      ...point,
      repos: 0,
      total: 0,
      added: i === data.history.length - 1 ? added : 0,
      removed: i === data.history.length - 1 && added ? 1 : 0,
    }));
    data.eventCounts = { added, removed: added ? 1 : 0 };
    data.starNet = { added, removed: added ? 1 : 0 };
    return route.fulfill({ json: data });
  });
  await page.goto('/');
  await expect(
    page.getByRole('article', { name: 'Stars', exact: true }).locator('.stat-value'),
  ).toHaveText('—');
  await page
    .getByRole('group', { name: '趋势图表方式' })
    .getByRole('button', { name: 'Star 变化', exact: true })
    .click();
  const changes = page.getByRole('img', { name: '区间 Star 新增与取消柱状图', exact: true });
  await expect(changes).toBeVisible();
  await expect(changes.locator('rect title').filter({ hasText: '新增 2' })).toHaveCount(1);
  await expect(changes.locator('rect title').filter({ hasText: '取消 1' })).toHaveCount(1);
  await expect(page.getByText('尚无 Star 变化记录', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await expect(changes).toBeVisible();
  await expect(changes.locator('rect title').filter({ hasText: '新增 2' })).toHaveCount(1);

  added = 0;
  await page.reload();
  await page
    .getByRole('group', { name: '趋势图表方式' })
    .getByRole('button', { name: 'Star 变化', exact: true })
    .click();
  await expect(changes).toBeVisible();
  await expect(changes).toContainText('所选时间内暂无分组净变化');
});

test('places Release markers within multi-day buckets and labels grouped charts correctly', async ({
  page,
}) => {
  await installDesignFixture(page);
  const seconds = (iso: string) => Date.parse(iso) / 1000;
  const since = seconds('2026-08-01T12:00:00+08:00');
  const until = seconds('2026-11-01T00:00:00+08:00');
  const from: ReleaseBoundary = {
    github_id: 700,
    tag_name: 'v-start',
    published_at: since,
    prerelease: 0,
  };
  const to: ReleaseBoundary = {
    github_id: 799,
    tag_name: 'v-end',
    published_at: until,
    prerelease: 0,
  };
  await page.route('**/api/dashboard?*', (route) => {
    const data = demoDashboard('rssh', 30);
    data.releaseChoices = [to, from];
    if (new URL(route.request().url()).searchParams.get('range') === 'releases') {
      data.range = {
        ...data.range,
        mode: 'releases',
        since,
        until,
        bucketDays: 2,
        days: 92,
        label: 'v-start → v-end',
        fromRelease: from,
        toRelease: to,
        startDay: '2026-08-01',
        endDay: '2026-10-31',
      };
      const base = seconds('2026-08-01T00:00:00+08:00');
      data.history = Array.from({ length: 46 }, (_, i) => ({
        ...data.history[0],
        day: new Date((base + i * 2 * 86400 + 8 * 3600) * 1000).toISOString().slice(0, 10),
        total: 100 + i,
      }));
      data.releaseMarkers = [
        ['v-start', since],
        ['v-inside-first', seconds('2026-08-02T12:00:00+08:00')],
        ['v-on-next-boundary', seconds('2026-08-03T00:00:00+08:00')],
        ['v-inside-last', seconds('2026-10-31T12:00:00+08:00')],
      ].map(([tag, published], i) => ({
        ...demoReleases[0],
        github_id: 700 + i,
        tag_name: String(tag),
        published_at: Number(published),
      }));
    }
    return route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目 Star 总量', exact: true })).toBeVisible();
  await page.getByLabel('项目统计时间').selectOption('releases');
  const total = page.getByRole('img', { name: '每 2 天 Star 总数趋势图', exact: true });
  await expect(total).toBeVisible();
  const markers = total.locator('g').filter({ has: page.locator('path > title') });
  await expect(markers).toHaveCount(3);
  const first = markers.filter({ hasText: 'v-inside-first' });
  const boundary = markers.filter({ hasText: 'v-on-next-boundary' });
  const last = markers.filter({ hasText: 'v-inside-last' });
  await expect(first).toContainText('v-start');
  await expect(first).not.toContainText('v-on-next-boundary');
  expect(await first.locator('line').getAttribute('x1')).toBe(
    await total.locator('circle').first().getAttribute('cx'),
  );
  expect(await boundary.locator('line').getAttribute('x1')).toBe(
    await total.locator('circle').nth(1).getAttribute('cx'),
  );
  expect(await last.locator('line').getAttribute('x1')).toBe(
    await total.locator('circle').last().getAttribute('cx'),
  );
  await expect(total.locator('circle title').first()).toContainText('每 2 天一组');
  await expect(
    page.getByRole('img', { name: '区间 Star 新增与取消柱状图（每 2 天分组）', exact: true }),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Fork', exact: true }).click();
  await expect(
    page.getByRole('img', { name: '每 2 天新增 Fork 趋势图', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Issue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Issue 每 2 天变化', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Issue 每 2 天变化图', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Pull Request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PR 每 2 天变化', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'PR 每 2 天变化图', exact: true })).toBeVisible();
});

test('uses distinct integer count ticks for zero, one and large Fork counts', async ({ page }) => {
  await installDesignFixture(page);
  let maximum = 0;
  await page.route('**/api/dashboard?*', (route) => {
    const data = demoDashboard('rssh', 7);
    data.history = data.history.map((point, i) => ({ ...point, fork_new: i === 6 ? maximum : 0 }));
    return route.fulfill({ json: data });
  });
  for (const value of [0, 1, 1000001]) {
    maximum = value;
    await page.goto('/');
    await page.getByRole('button', { name: '项目数据', exact: true }).click();
    await page.getByRole('tab', { name: 'Fork', exact: true }).click();
    const chart = page.getByRole('img', { name: '每日新增 Fork 趋势图', exact: true });
    await expect(chart).toBeVisible();
    const ticks = await chart.locator('g > text').allTextContents();
    expect(new Set(ticks).size).toBe(5);
    if (value <= 1) expect(ticks).toEqual(['0', '1', '2', '3', '4']);
    if (value === 1) {
      const bar = chart
        .locator('rect')
        .filter({ has: page.locator('title', { hasText: '新增 1 Fork' }) });
      const oneTick = chart.locator('g').filter({ has: page.locator('text', { hasText: /^1$/ }) });
      expect(await bar.getAttribute('y')).toBe(await oneTick.locator('line').getAttribute('y1'));
    }
  }
});
