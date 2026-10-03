import { test, expect } from '@playwright/test';

const PROMOTION_FEN = '7k/P7/8/8/8/8/8/7K w - - 0 1';
const MATE_FEN = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';

const square = (page, name) => page.locator(`[data-square="${name}"]`);

async function openPage(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#board [data-square]')).toHaveCount(64);
  return errors;
}

async function move(page, from, to) {
  await square(page, from).click();
  await expect(square(page, to)).toHaveClass(/square--(target|capture)/);
  await square(page, to).click();
}

async function loadFen(page, fen) {
  await page.locator('#position-tools summary').click();
  await page.locator('#fen-input').fill(fen);
  await page.getByRole('button', { name: '载入 FEN' }).click();
}

function readRevision(page) {
  return page.locator('body').getAttribute('data-revision');
}

test('initial board shows 32 pieces and rejects the illegal e2-e5 attempt', async ({ page }) => {
  const errors = await openPage(page);
  await expect(page.locator('#board .piece')).toHaveCount(32);
  await expect(page.locator('#coord-ranks .coord')).toHaveCount(8);
  await expect(page.locator('#coord-files .coord')).toHaveCount(8);
  await expect(page.locator('#coord-ranks')).toContainText('8');
  await expect(page.locator('#coord-files')).toContainText('h');
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await expect(page.getByRole('button', { name: '悔棋' })).toBeDisabled();

  await square(page, 'e2').click();
  await expect(square(page, 'e2')).toHaveClass(/square--selected/);
  await expect(square(page, 'e4')).toHaveClass(/square--target/);
  await square(page, 'e5').click();
  await expect(page.locator('#board .piece')).toHaveCount(32);
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  expect(await readRevision(page)).toBe('0');

  await move(page, 'e2', 'e4');
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  expect(await readRevision(page)).toBe('1');
  await expect(square(page, 'e4')).toHaveAttribute('data-piece', 'p');
  await expect(square(page, 'e4')).toHaveAttribute('data-color', 'w');
  await expect(page.locator('#move-list')).toContainText('e4');
  await expect(page.locator('#last-move')).toContainText('e4');
  expect(errors).toEqual([]);
});

test('undo restores board, notation and turn after a black reply', async ({ page }) => {
  const errors = await openPage(page);
  await move(page, 'e2', 'e4');
  await move(page, 'e7', 'e5');
  await expect(page.locator('#move-list')).toContainText('e5');
  await expect(page.locator('#turn')).toHaveText('白方走棋');

  await page.getByRole('button', { name: '悔棋' }).click();
  expect(await readRevision(page)).toBe('3');
  await expect(square(page, 'e7')).toHaveAttribute('data-piece', 'p');
  await expect(square(page, 'e7')).toHaveAttribute('data-color', 'b');
  await expect(square(page, 'e5')).not.toHaveAttribute('data-piece', 'p');
  await expect(page.locator('#move-list')).toContainText('e4');
  await expect(page.locator('#move-list')).not.toContainText('e5');
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  await expect(page.locator('#last-move')).toContainText('e4');
  expect(errors).toEqual([]);
});

test('flip changes display only and play continues on real coordinates', async ({ page }) => {
  const errors = await openPage(page);
  await page.getByRole('button', { name: '翻转棋盘' }).click();
  await expect(page.locator('#board')).toHaveAttribute('data-flipped', 'true');
  await expect(page.locator('#coord-files .coord').first()).toHaveText('h');
  await expect(square(page, 'e2')).toHaveAttribute('data-piece', 'p');

  await move(page, 'e2', 'e4');
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  await expect(square(page, 'e4')).toHaveAttribute('data-color', 'w');

  await page.getByRole('button', { name: '重置棋局' }).click();
  await expect(page.locator('#board .piece')).toHaveCount(32);
  await expect(square(page, 'e2')).toHaveAttribute('data-piece', 'p');
  await expect(square(page, 'e4')).not.toHaveAttribute('data-piece');
  await expect(page.locator('#move-list')).toContainText('尚无着法');
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  expect(errors).toEqual([]);
});

test('promotion waits for a choice, cancel keeps the pawn, knight promotion works', async ({ page }) => {
  const errors = await openPage(page);
  await loadFen(page, PROMOTION_FEN);
  await expect(square(page, 'a7')).toHaveAttribute('data-piece', 'p');

  const revisionAfterLoad = await readRevision(page);
  await square(page, 'a7').click();
  await square(page, 'a8').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('选择升变棋子');
  expect(await readRevision(page)).toBe(revisionAfterLoad);
  await expect(square(page, 'a7')).toHaveAttribute('data-piece', 'p');
  await expect(square(page, 'a8')).not.toHaveAttribute('data-piece');
  await expect(page.locator('#move-list')).toContainText('尚无着法');

  await page.getByRole('button', { name: '取消升变' }).click();
  await expect(dialog).toBeHidden();
  await expect(square(page, 'a7')).toHaveAttribute('data-piece', 'p');
  await expect(square(page, 'a8')).not.toHaveAttribute('data-piece');
  expect(await readRevision(page)).toBe(revisionAfterLoad);

  await square(page, 'a7').click();
  await square(page, 'a8').click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: '升变为马' }).click();
  await expect(dialog).toBeHidden();
  await expect(square(page, 'a8')).toHaveAttribute('data-piece', 'n');
  await expect(square(page, 'a8')).toHaveAttribute('data-color', 'w');
  await expect(square(page, 'a7')).not.toHaveAttribute('data-piece');
  await expect(page.locator('#move-list')).toContainText('a8=N');
  // K+N vs K is insufficient material, so the engine ends the game immediately.
  await expect(page.locator('#status')).toContainText('子力不足');
  await expect(page.locator('#turn')).toHaveText('和棋（1/2-1/2）');
  expect(errors).toEqual([]);
});

test('checkmate FEN reports mate and reset restores play', async ({ page }) => {
  const errors = await openPage(page);
  await loadFen(page, MATE_FEN);
  await expect(page.locator('#status')).toContainText('将死');
  await expect(page.locator('#status')).toContainText('白方胜');
  await expect(page.locator('#turn')).toHaveText('白方胜（1-0）');
  await expect(page.getByRole('button', { name: '悔棋' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重置棋局' })).toBeEnabled();

  await page.getByRole('button', { name: '重置棋局' }).click();
  await expect(page.locator('#board .piece')).toHaveCount(32);
  await expect(page.locator('#turn')).toHaveText('白方走棋');
  await move(page, 'e2', 'e4');
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  expect(errors).toEqual([]);
});

test('invalid FEN keeps the current position and shows the reason', async ({ page }) => {
  const errors = await openPage(page);
  await move(page, 'e2', 'e4');
  await loadFen(page, 'not-a-fen');
  await expect(page.locator('#fen-message')).toContainText('无法载入');
  await expect(square(page, 'e4')).toHaveAttribute('data-piece', 'p');
  await expect(square(page, 'e2')).not.toHaveAttribute('data-piece');
  expect(await readRevision(page)).toBe('1');
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  expect(errors).toEqual([]);
});

test('claimable draw exposes an action and claimDraw ends the game', async ({ page }) => {
  const errors = await openPage(page);
  const cycle = [
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
  ];
  for (const [from, to] of cycle) await move(page, from, to);

  const claimButton = page.getByRole('button', { name: '申请和棋（三次重复局面）' });
  await expect(claimButton).toBeVisible();
  await claimButton.click();
  await expect(page.locator('#status')).toContainText('三次重复局面');
  await expect(page.locator('#turn')).toHaveText('和棋（1/2-1/2）');
  await expect(claimButton).toBeHidden();

  await square(page, 'e2').click();
  await expect(square(page, 'e4')).not.toHaveClass(/square--target/);
  expect(errors).toEqual([]);
});

test('320px viewport has no horizontal overflow and the promotion dialog fits', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.locator('#board [data-square]')).toHaveCount(64);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true);

  const boardBox = await page.locator('#board').boundingBox();
  expect(Math.abs(boardBox.width - boardBox.height)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: '重置棋局' })).toBeVisible();

  await loadFen(page, PROMOTION_FEN);
  await square(page, 'a7').click();
  await square(page, 'a8').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: '取消升变' }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
