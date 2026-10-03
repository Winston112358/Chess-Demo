import { test, expect, _electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import electronExecutable from 'electron';

test('desktop loads the bundled board with browser Node access disabled', async () => {
  const desktop = await _electron.launch({
    executablePath: electronExecutable,
    args: [resolve(fileURLToPath(new URL('../../', import.meta.url)))],
  });
  try {
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '国际象棋', exact: true })).toBeVisible();
    await expect(page.locator('#board [data-square]')).toHaveCount(64);
    await expect(page.locator('#board .piece')).toHaveCount(32);
    await expect(page.locator('#turn')).toHaveText('白方走棋');

    await page.getByRole('button', { name: '重置棋局' }).click();
    await expect(page.locator('#board .piece')).toHaveCount(32);

    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.locator('#turn')).toHaveText('黑方走棋');

    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/desktop-board.png' });
  } finally {
    await desktop.close();
  }
});
