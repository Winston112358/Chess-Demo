import { test, expect } from '@playwright/test';

test('a black-to-move FEN preserves the move number and black notation column', async ({ page }) => {
  await page.goto('/');
  await page.locator('#position-tools summary').click();
  await page.locator('#fen-input').fill('4k3/8/8/8/8/8/8/4K2R b - - 0 23');
  await page.getByRole('button', { name: '载入 FEN' }).click();
  await page.locator('[data-square="e8"]').click();
  await page.locator('[data-square="e7"]').click();
  const row = page.locator('.move-row').first();
  await expect(row.locator('.move-index')).toHaveText('23.');
  await expect(row.locator('.move-san').nth(0)).toHaveText('…');
  await expect(row.locator('.move-san').nth(1)).toHaveText('Ke7');
});

test('narrow-screen moves keep the board in place instead of scrolling to notation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.locator('[data-square="e2"]').click();
  const before = await page.evaluate(() => window.scrollY);
  await page.locator('[data-square="e4"]').click();
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
