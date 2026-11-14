import { expect, test } from '@playwright/test';
import { installDesignFixture } from './design-fixture';

test('keeps mobile navigation focus inside the drawer and restores the opener', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDesignFixture(page);
  await page.goto('/');
  const opener = page.getByRole('button', {
    name: '打开导航',
    exact: true,
    includeHidden: true,
  });
  const search = page.getByRole('textbox', { name: '查找项目', exact: true });
  const drawer = page.getByRole('dialog', { name: '工作空间导航' });
  await opener.focus();
  await opener.press('Enter');
  await expect(drawer).toBeVisible();
  await expect(search).toBeFocused();
  await expect(opener).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.main-shell')).toHaveAttribute('inert');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  const close = drawer.getByRole('button', { name: '关闭导航', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button', { name: '退出登录' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.main-shell')).not.toHaveAttribute('inert');
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');

  const repositorySearch = page.getByRole('textbox', { name: '搜索仓库', exact: true });
  await repositorySearch.focus();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(repositorySearch).toBeFocused();

  await opener.click();
  await close.click();
  await expect(opener).toBeFocused();
  await opener.click();
  await drawer.getByRole('button', { name: '项目数据', exact: true }).click();
  await expect(page.getByLabel('项目数据选择项目')).toBeVisible();
  await expect(opener).toBeFocused();
  await expect(page.locator('.main-shell')).not.toHaveAttribute('inert');

  await opener.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(drawer).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await expect(page.locator('.main-shell')).not.toHaveAttribute('inert');
});

test('keeps existing notifications behind mobile navigation', async ({ page }) => {
  await installDesignFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: '监控项目', exact: true }).click();
  await page.getByRole('button', { name: '暂停记录', exact: true }).first().click();
  const toast = page.locator('.toast');
  await expect(toast).toContainText('已暂停记录');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航' }).click();
  const search = page.getByRole('textbox', { name: '查找项目', exact: true });
  await expect(search).toBeFocused();
  await expect(toast).toHaveAttribute('inert');
  await toast.locator('button').evaluate((button) => button.focus());
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toast).not.toHaveAttribute('inert');
  await page.getByRole('button', { name: '关闭通知' }).click();
  await expect(toast).toHaveCount(0);
});
