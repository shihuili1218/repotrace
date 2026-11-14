import { expect, test } from '@playwright/test';
import { demoDashboard, installDesignFixture } from './design-fixture';

test('shows reported Fork totals and cumulative recorded Issue and PR totals independently of open counts', async ({
  page,
}) => {
  await installDesignFixture(page);
  let empty = false;
  await page.route('**/api/dashboard?*', (route) => {
    const url = new URL(route.request().url());
    const data = demoDashboard(
      url.searchParams.get('repo') || '',
      Number(url.searchParams.get('days') || 30),
    );
    data.metrics.openIssues = 2;
    data.metrics.openPRs = 1;
    data.history = data.history.slice(-4).map((point, i) => ({
      ...point,
      fork_total: empty ? 0 : [0, 54, 54, 55][i],
      fork_repos: empty || i === 0 ? 0 : 1,
      issue_total: empty ? 0 : [12, 12, 14, 15][i],
      pr_total: empty ? 0 : [20, 21, 21, 22][i],
    }));
    return route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目 Star 总量', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Issue', exact: true }).click();
  const issueTotal = page.getByRole('img', { name: '已记录 Issue 总量趋势图', exact: true });
  await expect(issueTotal.locator('circle title').last()).toContainText('15 已记录 Issue');
  await expect(page.getByRole('region', { name: '项目数量趋势' })).toContainText(
    '并非仓库完整总数',
  );
  await expect(page.getByRole('img', { name: 'Issue 每日变化图', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Pull Request', exact: true }).click();
  const prTotal = page.getByRole('img', { name: '已记录 PR 总量趋势图', exact: true });
  await expect(prTotal.locator('circle title').last()).toContainText('22 已记录 PR');
  await expect(page.getByRole('img', { name: 'PR 每日变化图', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Fork', exact: true }).click();
  const forkTotal = page.getByRole('img', { name: 'Fork 总量趋势图', exact: true });
  await expect(forkTotal.locator('circle')).toHaveCount(3);
  await expect(forkTotal.locator('circle title').last()).toContainText('55 Forks');
  await expect(page.getByRole('img', { name: '每日新增 Fork 趋势图', exact: true })).toBeVisible();

  empty = true;
  await page.getByLabel('项目统计时间').selectOption('7');
  await expect(forkTotal).toHaveCount(0);
  await expect(page.getByRole('region', { name: '项目数量趋势' })).toContainText('尚无');
  await page.getByRole('tab', { name: 'Issue', exact: true }).click();
  await expect(issueTotal.locator('circle')).toHaveCount(4);
  await expect(issueTotal.locator('circle title').last()).toContainText('0 已记录 Issue');
  await page.getByRole('tab', { name: 'Pull Request', exact: true }).click();
  await expect(prTotal.locator('circle title').last()).toContainText('0 已记录 PR');
});
