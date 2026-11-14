import { expect, test } from '@playwright/test';
import { demoDashboard, demoRepositories, installDesignFixture } from './design-fixture';

test('finds repositories by language, sorts them and opens the selected project', async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard' || url.pathname === '/api/monitoring') requests.push(url);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await installDesignFixture(page);
  await page.goto('/');
  const quickSearch = page.getByRole('textbox', { name: '查找项目', exact: true });
  await expect(quickSearch).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(quickSearch).toBeFocused();
  await quickSearch.fill('repotrace');
  await expect(page.locator('.sidebar-project')).toHaveCount(1);
  await expect(page.locator('.sidebar-project')).toContainText('repotrace');
  await quickSearch.fill('');
  await expect(page.locator('.sidebar-project')).toHaveCount(3);
  const chartSwitch = page.getByRole('group', { name: '趋势图表方式' });
  await expect(chartSwitch.getByRole('button', { name: '活动', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: '项目活动趋势', exact: true })).toBeVisible();
  const activityChart = page.getByRole('img', { name: '项目每日活动趋势图', exact: true });
  await expect(activityChart).toBeVisible();
  await expect(
    activityChart.locator('circle title').filter({ hasText: '2026-11-14 · Star 净新增用户 22' }),
  ).toHaveCount(1);
  const activityDate = page.getByRole('slider', { name: '项目活动日期' });
  await expect(activityDate).toHaveAttribute(
    'aria-valuetext',
    '2026-11-14 · Star 净新增用户 22 · 新增 Fork 2 · 新建 Issue 1 · 已合并 PR 1',
  );
  await activityDate.focus();
  await activityDate.press('Home');
  await expect(activityDate).toHaveAttribute(
    'aria-valuetext',
    '2026-10-16 · Star 净新增用户 6 · 新增 Fork 0 · 新建 Issue 0 · 已合并 PR 0',
  );
  await activityDate.press('End');
  await expect(activityDate).toHaveValue('29');

  await chartSwitch.getByRole('button', { name: 'Star 变化', exact: true }).click();
  await expect(
    page.getByRole('img', { name: '区间 Star 新增与取消柱状图', exact: true }),
  ).toBeVisible();
  await chartSwitch.getByRole('button', { name: 'Star 总量', exact: true }).click();
  await expect(page.getByRole('img', { name: '每日 Star 总数趋势图', exact: true })).toBeVisible();
  const repositories = page.getByRole('region', { name: '仓库一览' });
  const rows = repositories.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('shihuili1218/rssh');
  await page.getByLabel('仓库排序').selectOption('name');
  await expect(rows.first()).toContainText('shihuili1218/open-cli');
  await page.getByLabel('仓库排序').selectOption('events');
  await expect(rows.first()).toContainText('已记录 1,284 条事件');
  await page.getByLabel('搜索仓库').fill('typescript');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('shihuili1218/repotrace');
  await page.getByLabel('搜索仓库').fill('does-not-exist');
  await expect(rows).toHaveCount(0);
  await expect(repositories).toContainText('没有匹配的仓库');
  await page.getByLabel('搜索仓库').fill('repotrace');
  await rows.first().getByRole('button', { name: '查看数据', exact: true }).click();
  await expect(page.getByLabel('项目数据选择项目')).toHaveValue('repotrace');
  await expect(page.getByRole('tab', { name: 'Star', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: '项目 Star 总量', exact: true })).toBeVisible();
  await page.getByLabel('项目统计时间').selectOption('releases');
  await expect(page.getByLabel('起始 Release')).not.toHaveValue('');
  await expect(page.getByLabel('结束 Release')).not.toHaveValue('');
  const beforeSwitch = requests.length;
  await page.locator('.sidebar').getByTitle('shihuili1218/rssh', { exact: true }).click();
  await expect(page.getByLabel('项目数据选择项目')).toHaveValue('rssh');
  await expect(page.getByLabel('项目统计时间')).toHaveValue('30');
  await expect(page.getByRole('heading', { name: '项目 Star 总量', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const nextRequests = requests
    .slice(beforeSwitch)
    .filter((url) => url.searchParams.get('repo') === 'rssh');
  expect(nextRequests.length).toBeGreaterThan(0);
  expect(
    nextRequests.every(
      (url) =>
        url.searchParams.get('range') === 'days' &&
        !url.searchParams.has('fromRelease') &&
        !url.searchParams.has('toRelease'),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: '项目总览', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '打开导航', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.sidebar')).toHaveClass(/open/);
  await expect(page.getByRole('button', { name: '项目数据', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '项目总览', exact: true }).click();
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('ranks every collected version with exact large counts and keeps unknown shares unknown', async ({
  page,
}) => {
  await installDesignFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  const ranking = page.getByRole('region', { name: '版本下载排行' });
  const rows = ranking.getByRole('listitem');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('v1.8.0');
  await expect(rows.first()).toContainText('14,682');
  await expect(rows.first()).toContainText('30.1%');
  await ranking.getByRole('button', { name: '查看全部 7 个版本' }).click();
  await expect(rows).toHaveCount(7);
  await expect(rows.last()).toContainText('预发布');
  await ranking.getByRole('button', { name: '收起排行' }).click();
  await expect(rows).toHaveCount(5);

  const huge = 9007199254740992n;
  let mode: 'large' | 'zero' | 'unknown' = 'large';
  await page.route('**/api/repositories/*/releases/downloads?*', (route) =>
    route.fulfill({
      json: {
        total: mode === 'large' ? String(huge * 2n + 1n) : mode === 'zero' ? '0' : null,
        latest: mode === 'large' ? String(huge + 1n) : mode === 'zero' ? '0' : null,
        source: 'github',
        cache: { updatedAt: 1794643200, error: null },
        history: [],
        releases: [
          {
            id: 1,
            tag: 'older',
            name: 'Older',
            publishedAt: 1794556800,
            prerelease: false,
            downloads: mode === 'large' ? String(huge) : mode === 'zero' ? '0' : '10',
          },
          {
            id: 2,
            tag: 'newer',
            name: 'Newer',
            publishedAt: 1794643200,
            prerelease: false,
            downloads: mode === 'large' ? String(huge + 1n) : mode === 'zero' ? '0' : 'unknown',
          },
        ],
      },
    }),
  );
  await page.getByLabel('项目统计时间').selectOption('7');
  await expect(page.getByRole('tab', { name: 'Release', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('newer');
  await expect(rows.first()).toContainText((huge + 1n).toLocaleString('zh-CN'));
  await expect(rows.last()).toContainText(huge.toLocaleString('zh-CN'));

  mode = 'zero';
  await page.getByLabel('项目统计时间').selectOption('90');
  await expect(page.getByRole('tab', { name: 'Release', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(rows.locator('.version-download-value > strong')).toHaveText(['0', '0']);
  await expect(rows.locator('.version-download-value > span')).toHaveText(['—', '—']);

  mode = 'unknown';
  await page.getByLabel('项目统计时间').selectOption('30');
  await expect(page.getByRole('tab', { name: 'Release', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(rows.locator('.version-download-value > strong')).toHaveText(['10', '—']);
  await expect(rows.locator('.version-download-value > span')).toHaveText(['—', '—']);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('opens every managed project from the sidebar after an overview filter', async ({ page }) => {
  await installDesignFixture(page);
  const repositories = [
    ...demoRepositories,
    ...Array.from({ length: 5 }, (_, index) => ({
      ...demoRepositories[0],
      id: `extra-${index}`,
      full_name: `shihuili1218/project-${index}`,
    })),
  ];
  await page.route('**/api/dashboard?*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: { ...demoDashboard(url.searchParams.get('repo') || ''), repositories },
    });
  });
  await page.goto('/');
  await page.getByLabel('选择项目', { exact: true }).selectOption('repotrace');
  await expect(page.locator('.repository-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '管理全部项目', exact: true }).click();
  await expect(page.getByLabel('选择项目', { exact: true })).toHaveValue('');
  await expect(page.locator('.repo-management .repo-card')).toHaveCount(8);
});

test('keeps the selected monitor when changing days or Release boundaries', async ({ page }) => {
  const errors: string[] = [];
  const monitoringRequests: URL[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/monitoring') monitoringRequests.push(url);
  });
  await installDesignFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  for (const [tab, type, days, heading] of [
    ['Issue', 'issues', '7', 'Issue 跟踪'],
    ['Pull Request', 'pull_requests', '90', 'PR 跟踪'],
    ['Release', 'releases', '30', '版本下载排行'],
  ]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    await page.getByLabel('项目统计时间').selectOption(days);
    await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('.range-description')).toContainText(`近 ${days} 天`);
    await expect
      .poll(() => {
        const parameters = monitoringRequests.at(-1)?.searchParams;
        return `${parameters?.get('type')}/${parameters?.get('days')}`;
      })
      .toBe(`${type}/${days}`);
  }
  await page.getByLabel('项目统计时间').selectOption('releases');
  await expect(page.getByRole('tab', { name: 'Release', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: '版本下载排行', exact: true })).toBeVisible();
  await expect.poll(() => monitoringRequests.at(-1)?.searchParams.get('range')).toBe('releases');
  await page.getByLabel('起始 Release').selectOption('403');
  await expect(page.getByRole('tab', { name: 'Release', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect.poll(() => monitoringRequests.at(-1)?.searchParams.get('fromRelease')).toBe('403');
  const end = await page.getByLabel('结束 Release').inputValue();
  await page.getByLabel('起始 Release').selectOption(end);
  await expect(page.getByText('请选择两个发布时间不同的 Release。', { exact: true })).toBeVisible();
  await page.getByLabel('起始 Release').selectOption('403');
  await expect(page.getByRole('tab', { name: 'Release', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: '版本下载排行', exact: true })).toBeVisible();
  await page.locator('.sidebar').getByTitle('shihuili1218/repotrace', { exact: true }).click();
  await expect(page.getByLabel('项目数据选择项目')).toHaveValue('repotrace');
  await expect(page.getByLabel('项目统计时间')).toHaveValue('30');
  await expect(page.getByRole('tab', { name: 'Star', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(errors).toEqual([]);
});
