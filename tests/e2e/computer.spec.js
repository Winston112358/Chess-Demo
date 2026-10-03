import { test, expect } from '@playwright/test';

const MATE_FEN = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';
const CUSTOM_FEN = '4k3/8/8/8/8/8/P7/4K2R w K - 0 1';

const square = (page, name) => page.locator(`[data-square="${name}"]`);
const plies = (page) => page.locator('#move-list .move-san:not(.move-san--empty)');

async function startComputer(page, { humanColor = 'w', difficulty = 'easy' } = {}) {
  await page.goto('/');
  await page.selectOption('#difficulty', difficulty);
  await page.selectOption('#game-mode', 'computer');
  if (humanColor !== 'w') await page.selectOption('#human-color', humanColor);
}

async function humanMove(page, from, to) {
  await square(page, from).click();
  await expect(square(page, to)).toHaveClass(/square--(target|capture)/);
  await square(page, to).click();
}

async function loadFen(page, fen) {
  await page.locator('#position-tools summary').click();
  await page.locator('#fen-input').fill(fen);
  await page.getByRole('button', { name: '载入 FEN' }).click();
}

test('computer answers as black after a human white move', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startComputer(page);
  await expect(page.locator('#engine-status')).toHaveText('');

  await humanMove(page, 'e2', 'e4');
  await expect(page.locator('#engine-status')).toContainText('电脑思考');
  await expect(plies(page)).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await expect(page.locator('#engine-status')).toHaveText('');
  expect(await plies(page).first().textContent()).toBe('e4');
  expect(errors).toEqual([]);
});

test('computer opens as white when the human chooses black', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startComputer(page, { humanColor: 'b' });
  await expect(plies(page)).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator('#turn')).toHaveText('黑方走棋');

  await humanMove(page, 'e7', 'e5');
  await expect(plies(page)).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  expect(errors).toEqual([]);
});

test('undo after the computer replied returns to the human decision', async ({ page }) => {
  await startComputer(page);
  await humanMove(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(2, { timeout: 30000 });

  await page.getByRole('button', { name: '悔棋' }).click();
  await expect(plies(page)).toHaveCount(0);
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await expect(page.locator('#engine-status')).toHaveText('');
});

test('undoing the computer opening move pauses and retry resumes it', async ({ page }) => {
  await startComputer(page, { humanColor: 'b' });
  await expect(plies(page)).toHaveCount(1, { timeout: 30000 });

  await page.getByRole('button', { name: '悔棋' }).click();
  await expect(plies(page)).toHaveCount(0);
  const retry = page.getByRole('button', { name: '继续电脑走棋' });
  await expect(retry).toBeVisible();
  await expect(page.locator('#engine-status')).toContainText('暂停');

  await retry.click();
  await expect(plies(page)).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  await expect(retry).toBeHidden();
});

test('undo while the computer thinks cancels the search', async ({ page }) => {
  await startComputer(page);
  await humanMove(page, 'e2', 'e4');
  await expect(page.locator('#engine-status')).toContainText('电脑思考');

  await page.getByRole('button', { name: '悔棋' }).click();
  await expect(plies(page)).toHaveCount(0);
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await page.waitForTimeout(1500);
  await expect(plies(page)).toHaveCount(0);
});

test('switching to local while the computer thinks discards the search', async ({ page }) => {
  await startComputer(page);
  await humanMove(page, 'e2', 'e4');
  await expect(page.locator('#engine-status')).toContainText('电脑思考');

  await page.selectOption('#game-mode', 'local');
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  await expect(plies(page)).toHaveCount(1);

  await humanMove(page, 'e7', 'e5');
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await expect(plies(page)).toHaveCount(2);
  await page.waitForTimeout(1500);
  await expect(plies(page)).toHaveCount(2);
  await expect(page.locator('#last-move')).toContainText('e5');
});

test('reset while the computer thinks discards the search', async ({ page }) => {
  await startComputer(page);
  await humanMove(page, 'e2', 'e4');
  await expect(page.locator('#engine-status')).toContainText('电脑思考');

  await page.getByRole('button', { name: '重置棋局' }).click();
  await expect(plies(page)).toHaveCount(0);
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await page.waitForTimeout(1500);
  await expect(plies(page)).toHaveCount(0);
});

test('computer replies from a custom FEN start', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startComputer(page);
  await loadFen(page, CUSTOM_FEN);
  await expect(page.locator('#fen-message')).toContainText('已载入');

  await humanMove(page, 'a2', 'a3');
  await expect(plies(page)).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  expect(await plies(page).first().textContent()).toBe('a3');
  expect(errors).toEqual([]);
});

test('a terminal position never starts computer thinking', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startComputer(page);
  await loadFen(page, MATE_FEN);
  await expect(page.locator('#status')).toContainText('将死');
  await expect(page.locator('#engine-status')).toHaveText('');

  const revision = await page.locator('body').getAttribute('data-revision');
  await page.waitForTimeout(1200);
  expect(await page.locator('body').getAttribute('data-revision')).toBe(revision);
  await expect(plies(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('computer mode fits 320px without horizontal overflow or page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 640 });
  await startComputer(page);
  await humanMove(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(2, { timeout: 30000 });

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true);
  const boardBox = await page.locator('#board').boundingBox();
  expect(Math.abs(boardBox.width - boardBox.height)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('a failed real Worker load preserves the position and retry plays its reply', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const workerUrl = '**/engines/stockfish/stockfish-19-lite-single.js';
  await page.route(workerUrl, (route) => route.abort());
  await startComputer(page);
  await humanMove(page, 'e2', 'e4');
  await expect(page.locator('#engine-status')).toContainText('出错', { timeout: 20000 });
  await expect(plies(page)).toHaveCount(1);
  const failedFen = await page.locator('#fen-input').inputValue();
  await expect(page.getByRole('button', { name: '重试电脑走棋' })).toBeVisible();
  await page.unroute(workerUrl);
  expect(await page.locator('#fen-input').inputValue()).toBe(failedFen);
  await page.getByRole('button', { name: '重试电脑走棋' }).click();
  await expect(plies(page)).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await expect(page.locator('#engine-retry')).toBeHidden();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/computer-review.png', fullPage: true });
});

test('changing mode closes a pending promotion without moving the pawn', async ({ page }) => {
  await page.goto('/');
  await loadFen(page, '7k/1P6/8/8/8/8/8/K7 w - - 0 1');
  await humanMove(page, 'b7', 'b8');
  await expect(page.locator('#promotion-dialog')).toBeVisible();
  await page.selectOption('#game-mode', 'computer');
  await expect(page.locator('#promotion-dialog')).toBeHidden();
  await expect(square(page, 'b7').locator('.piece')).toHaveCount(1);
  await expect(plies(page)).toHaveCount(0);
  await expect(square(page, 'b7')).not.toHaveClass(/square--selected/);
});
