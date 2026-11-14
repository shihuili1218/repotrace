import { expect, test, type Locator, type Page } from '@playwright/test';
import { demoDownloads, installDesignFixture } from './design-fixture';

async function expectAlignedCharts(grid: Locator, sideBySide: boolean) {
  await expect(grid.locator('.metric-chart-slot')).toHaveCount(2);
  await expect(grid.locator('.metric-chart-plot svg[role="img"]')).toHaveCount(2);
  const charts = await grid.locator('.metric-chart-slot').evaluateAll((slots) =>
    slots.map((slot) => {
      const rect = (selector: string) => slot.querySelector(selector)!.getBoundingClientRect();
      const svg = rect('.metric-chart-plot svg[role="img"]');
      return {
        figure: slot.getBoundingClientRect().toJSON(),
        heading: rect('.metric-chart-heading').toJSON(),
        svg: svg.toJSON(),
        footer: rect('.metric-chart-footer').toJSON(),
      };
    }),
  );
  const [left, right] = charts;
  expect(Math.abs(left.svg.width - right.svg.width)).toBeLessThan(1);
  expect(Math.abs(left.svg.height - right.svg.height)).toBeLessThan(1);
  // Both SVGs fill their equal-width plots at the shared 480 × 250 ratio.
  expect(left.svg.height / left.svg.width).toBeCloseTo(250 / 480, 2);
  if (sideBySide) {
    expect(Math.abs(left.figure.height - right.figure.height)).toBeLessThan(1);
    expect(Math.abs(left.heading.top - right.heading.top)).toBeLessThan(1);
    expect(Math.abs(left.svg.top - right.svg.top)).toBeLessThan(1);
    expect(Math.abs(left.footer.top - right.footer.top)).toBeLessThan(1);
  } else {
    expect(right.heading.top).toBeGreaterThan(left.footer.bottom);
  }
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('aligns Release, Fork, Issue and PR plots on desktop and mobile', async ({ page }) => {
  await installDesignFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: '项目数据', exact: true }).click();

  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['Release', 'Fork', 'Issue', 'Pull Request']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expectAlignedCharts(page.locator('.metric-chart-grid'), width > 1250);
      await expectNoPageOverflow(page);
    }
  }
});

test('keeps Release plots aligned when a precise large-count axis adds a wrapped explanation', async ({
  page,
}) => {
  await installDesignFixture(page);
  const total = 9007199254740992n;
  await page.route('**/api/repositories/*/releases/downloads?*', (route) =>
    route.fulfill({
      json: {
        ...demoDownloads,
        history: demoDownloads.history.slice(0, 3).map((point, i) => ({
          ...point,
          total: String(total + BigInt(i)),
        })),
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await page.getByRole('tab', { name: 'Release', exact: true }).click();
  const grid = page.locator('.download-growth-grid');
  await expect(grid).toContainText('纵轴显示相对 9,007,199,254,740,992 次的增量');
  await expectAlignedCharts(grid, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAlignedCharts(grid, false);
  await expectNoPageOverflow(page);
});

test('fills the Star changes chart with plotted data instead of a narrow centered SVG', async ({
  page,
}) => {
  await installDesignFixture(page);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await page
    .getByRole('group', { name: '趋势图表方式' })
    .getByRole('button', { name: 'Star 变化', exact: true })
    .click();
  const chart = page.getByRole('img', { name: '区间 Star 新增与取消柱状图', exact: true });
  await expect(chart).toBeVisible();
  for (const width of [1920, 1440, 390]) {
    await page.setViewportSize({ width, height: 1200 });
    const geometry = await chart.evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      const bars = [...svg.querySelectorAll('rect')].map((bar) => bar.getBoundingClientRect());
      return {
        width: box.width,
        coverage:
          (Math.max(...bars.map((bar) => bar.right)) - Math.min(...bars.map((bar) => bar.left))) /
          box.width,
      };
    });
    if (width === 1920) expect(geometry.width).toBeGreaterThan(900);
    expect(geometry.coverage).toBeGreaterThan(0.72);
    await expectNoPageOverflow(page);
  }
});
