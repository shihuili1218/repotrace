import { expect, test, type Locator, type Page } from '@playwright/test';
import { demoDashboard, installDesignFixture } from './design-fixture';

async function openOverviewTotals(page: Page) {
  await page.goto('/');
  await page
    .getByRole('group', { name: '趋势图表方式' })
    .getByRole('button', { name: 'Star 总量', exact: true })
    .click();
  const chart = page.getByRole('img', { name: '每日 Star 总数趋势图', exact: true });
  await expect(chart).toBeVisible();
  return chart;
}

async function verticalSpread(chart: Locator) {
  return chart.locator('circle').evaluateAll((points) => {
    const positions = points.map((point) => Number(point.getAttribute('cy')));
    return Math.max(...positions) - Math.min(...positions);
  });
}

test('makes a one-Star change readable in overview and project total charts', async ({ page }) => {
  await installDesignFixture(page);
  await page.route('**/api/dashboard?*', (route) => {
    const data = demoDashboard('rssh', 7);
    data.history = data.history.map((point, i) => ({ ...point, total: i < 4 ? 519 : 520 }));
    return route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const overview = await openOverviewTotals(page);
  // A one-Star difference must occupy useful vertical space, rather than a fraction of a pixel.
  expect(await verticalSpread(overview)).toBeGreaterThan(30);
  await expect(page.getByText(/纵轴局部范围.*未从 0 开始/)).toBeVisible();
  await expect(overview.locator('circle title').first()).toContainText('519 Stars');
  await expect(overview.locator('circle title').last()).toContainText('520 Stars');

  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目 Star 总量', exact: true })).toBeVisible();
  const project = page.getByRole('img', { name: '每日 Star 总数趋势图', exact: true });
  expect(await verticalSpread(project)).toBeGreaterThan(30);
  const changes = page.getByRole('img', { name: '区间 Star 新增与取消柱状图', exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const chart of [project, changes]) {
      const coverage = await chart.evaluate((svg) => {
        const gridline = svg.querySelector('.grid-line')!.getBoundingClientRect();
        const style = getComputedStyle(svg);
        const availableWidth =
          svg.getBoundingClientRect().width -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        return gridline.width / availableWidth;
      });
      expect(coverage).toBeGreaterThan(0.75);
    }
  }
});

test('keeps zero, one, constant, single-point and large close totals precise', async ({ page }) => {
  await installDesignFixture(page);
  let values = [0, 0, 0];
  await page.route('**/api/dashboard?*', (route) => {
    const data = demoDashboard('rssh', values.length);
    data.history = data.history.map((point, i) => ({ ...point, total: values[i] }));
    return route.fulfill({ json: data });
  });
  for (const totals of [[0, 0, 0], [1, 1, 1], [519, 519, 519], [520], [1e12, 1e12 + 1, 1e12 + 2]]) {
    values = totals;
    const chart = await openOverviewTotals(page);
    await expect(chart.locator('circle')).toHaveCount(totals.length);
    const ticks = await chart.locator('g > text').allTextContents();
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks.every((tick) => !tick.includes('.'))).toBe(true);
    const positions = await chart.locator('circle').evaluateAll((points) =>
      points.map((point) => ({
        x: Number(point.getAttribute('cx')),
        y: Number(point.getAttribute('cy')),
      })),
    );
    expect(
      positions.every(
        ({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && y >= 32 && y <= 196,
      ),
    ).toBe(true);
    for (let i = 0; i < totals.length; i++) {
      await expect(chart.locator('circle title').nth(i)).toContainText(
        `${totals[i].toLocaleString('zh-CN')} Stars`,
      );
    }
    if (totals[0] === 1e12) {
      expect(await verticalSpread(chart)).toBeGreaterThan(30);
      await expect(page.getByText(/纵轴从 .* Stars 起 · \+n 表示相对该基准的数量差/)).toBeVisible();
    }
  }
});

test('keeps unknown totals as gaps at their real dates instead of zero or compressed time', async ({
  page,
}) => {
  await installDesignFixture(page);
  await page.route('**/api/dashboard?*', (route) => {
    const data = demoDashboard('rssh', 5);
    const points = [
      ['2026-11-08', null],
      ['2026-11-09', 519],
      ['2026-11-10', 520],
      ['2026-11-11', null],
      ['2026-11-14', 521],
    ] as const;
    data.history = points.map(([day, total], i) => ({
      ...data.history[i],
      day,
      total: total ?? 0,
      repos: total === null ? 0 : 1,
    }));
    return route.fulfill({ json: data });
  });
  const chart = await openOverviewTotals(page);
  await expect(chart.locator('circle')).toHaveCount(3);
  await expect(chart.locator('.count-trend-line')).toHaveCount(2);
  const timeline = await chart.evaluate((svg) => {
    const gridline = svg.querySelector('line.grid-line')!;
    const start = Number(gridline.getAttribute('x1'));
    const span = Number(gridline.getAttribute('x2')) - start;
    return [...svg.querySelectorAll('circle')].map(
      (point) => (Number(point.getAttribute('cx')) - start) / span,
    );
  });
  expect(timeline[0]).toBeCloseTo(1 / 6, 5);
  expect(timeline[1]).toBeCloseTo(2 / 6, 5);
  expect(timeline[2]).toBeCloseTo(1, 5);
  await expect(chart.locator('circle title').filter({ hasText: / · 0 Stars/ })).toHaveCount(0);
});
