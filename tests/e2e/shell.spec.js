import { test, expect } from '@playwright/test';

test('web board loads rules locally, shows 32 pieces and resets without an error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '国际象棋', exact: true })).toBeVisible();
  await expect(page.locator('#board [data-square]')).toHaveCount(64);
  await expect(page.locator('#board .piece')).toHaveCount(32);
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await page.getByRole('button', { name: '重置棋局' }).click();
  await expect(page.locator('#board .piece')).toHaveCount(32);
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  expect(errors).toEqual([]);
});
