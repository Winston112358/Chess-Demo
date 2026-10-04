import { test, expect } from '@playwright/test';

const square = (page, name) => page.locator(`[data-square="${name}"]`);
const plies = (page) => page.locator('#move-list .move-san:not(.move-san--empty)');

test('computer setup waits for Start with either color and loads no engine prematurely', async ({ page }) => {
  const engineRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/engines/stockfish/')) engineRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#start')).toBeHidden();
  await page.selectOption('#game-mode', 'computer');
  await page.selectOption('#difficulty', 'expert');
  await expect(page.locator('#turn')).toHaveText('待开始');
  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await expect(plies(page)).toHaveCount(0);
  await expect(page.locator('.square--selected')).toHaveCount(0);
  await page.selectOption('#human-color', 'b');
  await page.selectOption('#difficulty', 'easy');
  await page.waitForTimeout(700);
  await expect(plies(page)).toHaveCount(0);
  expect(engineRequests).toEqual([]);
  await page.screenshot({ path: 'test-results/options-waiting.png', fullPage: true });
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.locator('#start')).toBeDisabled();
  await expect(plies(page)).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  expect(engineRequests.length).toBeGreaterThan(0);
});

test('difficulty changes cancel thinking and preserve the position until Start is clicked again', async ({ page }) => {
  await page.goto('/');
  await page.selectOption('#game-mode', 'computer');
  await page.selectOption('#difficulty', 'expert');
  await page.locator('#start').click();
  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await expect(page.locator('#engine-status')).toContainText('电脑思考');
  const fen = await page.locator('#fen-input').inputValue();
  await page.selectOption('#difficulty', 'easy');
  await expect(page.locator('#turn')).toHaveText('待开始');
  await expect(page.locator('#start')).toBeEnabled();
  await page.waitForTimeout(1000);
  await expect(plies(page)).toHaveCount(1);
  expect(await page.locator('#fen-input').inputValue()).toBe(fen);
  await page.locator('#start').click();
  await expect(plies(page)).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('#turn')).toHaveText('白方走棋');
});

for (const [name, fen, from, target, captured] of [
  ['normal capture', '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5', 'd5'],
  ['en passant', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', 'e5', 'd6', 'd5'],
]) {
  test(`capture hints toggle immediately without disabling ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await page.locator('#position-tools summary').click();
    await page.locator('#fen-input').fill(fen);
    await page.locator('#load-fen').click();
    await page.locator('#position-tools summary').click();
    await square(page, from).click();
    await expect(square(page, target)).toHaveClass(/square--capture/);
    const toggle = page.locator('#capture-hints');
    const revision = await page.locator('body').getAttribute('data-revision');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(square(page, target)).not.toHaveClass(/square--(capture|target)/);
    await expect(square(page, from)).toHaveClass(/square--selected/);
    await expect(page.locator('.square--target')).not.toHaveCount(0);
    expect(await page.locator('body').getAttribute('data-revision')).toBe(revision);
    await toggle.click();
    await expect(square(page, target)).toHaveClass(/square--capture/);
    await toggle.click();
    await page.getByRole('button', { name: '翻转棋盘' }).click();
    await expect(square(page, target)).not.toHaveClass(/square--capture/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (name === 'normal capture') {
      await page.screenshot({ path: 'test-results/options-320.png', fullPage: true });
    }
    await square(page, target).click();
    await expect(plies(page)).toHaveCount(1);
    await expect(square(page, target)).toHaveAttribute('data-color', 'w');
    if (captured !== target) await expect(square(page, captured).locator('.piece')).toHaveCount(0);
    await page.locator('#reset').click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
}
