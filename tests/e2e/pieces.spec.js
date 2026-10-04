import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, 'assets', 'pieces-manifest.json'), 'utf8'));
const pieceById = new Map(manifest.pieces.map((piece) => [piece.id, piece]));
const SCREENSHOT_DIR = join(PROJECT_ROOT, 'test-results', 'ui');

const square = (page, name) => page.locator(`[data-square="${name}"]`);
const basenameFor = (pieceId, view) => pieceById.get(pieceId).views[view].path.split('/').pop();
const viewFor = (color, flipped) => (color === (flipped ? 'b' : 'w') ? 'rear' : 'front');

async function readBoardPieces(page) {
  return page.evaluate(() => [...document.querySelectorAll('#board [data-square]')]
    .map((squareEl) => {
      const piece = squareEl.querySelector('.piece');
      const image = squareEl.querySelector('.piece img');
      if (!piece) return null;
      return {
        square: squareEl.dataset.square,
        color: piece.dataset.color,
        type: piece.dataset.piece,
        view: piece.dataset.view,
        src: image?.getAttribute('src') ?? null,
        complete: Boolean(image?.complete),
        naturalWidth: image?.naturalWidth ?? 0,
        imageMissing: piece.dataset.imageMissing ?? null,
      };
    })
    .filter(Boolean));
}

async function waitForImagesLoaded(page, selector = '#board .piece img') {
  await expect.poll(
    () => page.evaluate((query) => [...document.querySelectorAll(query)]
      .filter((image) => !(image.complete && image.naturalWidth > 0)).length, selector),
    { timeout: 15000 },
  ).toBe(0);
}

function assertBoardAssets(entries, { flipped }) {
  expect(entries.length).toBe(32);
  for (const entry of entries) {
    expect(entry.imageMissing, `${entry.square} 缺少映射`).toBeNull();
    const expectedView = viewFor(entry.color, flipped);
    expect(entry.view, `${entry.square} 视角`).toBe(expectedView);
    expect(entry.src?.endsWith(basenameFor(entry.color + entry.type, expectedView)), `${entry.square} 素材`).toBe(true);
    expect(entry.complete, `${entry.square} 未加载完成`).toBe(true);
    expect(entry.naturalWidth, `${entry.square} 破图`).toBeGreaterThan(0);
  }
}

async function measureBoard(page) {
  return page.evaluate(() => [...document.querySelectorAll('#board [data-square]')]
    .map((squareEl) => {
      const piece = squareEl.querySelector('.piece');
      const image = squareEl.querySelector('.piece img');
      if (!piece || !image) return null;
      const squareBox = squareEl.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      return {
        square: squareEl.dataset.square,
        color: piece.dataset.color,
        type: piece.dataset.piece,
        view: piece.dataset.view,
        squareBox: { x: squareBox.x, y: squareBox.y, width: squareBox.width, height: squareBox.height },
        imageBox: { x: imageBox.x, y: imageBox.y, width: imageBox.width, height: imageBox.height },
      };
    })
    .filter(Boolean));
}

async function loadFen(page, fen) {
  await page.locator('#position-tools summary').click();
  await page.locator('#fen-input').fill(fen);
  await page.getByRole('button', { name: '载入 FEN' }).click();
}

test('all 32 initial piece images load and repeated flips only swap the view', async ({ page }) => {
  const errors = [];
  const requests = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    requests.push(request.url());
    if (!request.url().startsWith('http://127.0.0.1:5173')) externalRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#board .piece img')).toHaveCount(32);
  await waitForImagesLoaded(page);
  assertBoardAssets(await readBoardPieces(page), { flipped: false });
  expect(requests.some((url) => url.includes('/pieces/staunton-v3/'))).toBe(true);
  const fenBefore = await page.locator('#fen-input').inputValue();
  const revisionBefore = await page.locator('body').getAttribute('data-revision');

  await page.getByRole('button', { name: '翻转棋盘' }).click();
  await expect(page.locator('#board')).toHaveAttribute('data-flipped', 'true');
  await waitForImagesLoaded(page);
  assertBoardAssets(await readBoardPieces(page), { flipped: true });

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: '翻转棋盘' }).click();
  }
  await expect(page.locator('#board')).toHaveAttribute('data-flipped', 'false');
  await waitForImagesLoaded(page);
  assertBoardAssets(await readBoardPieces(page), { flipped: false });
  const transforms = await page.evaluate(() => [...document.querySelectorAll('#board .piece, #board .piece img')]
    .filter((element) => {
      const transform = getComputedStyle(element).transform;
      return transform && transform !== 'none';
    }).length);
  expect(transforms).toBe(0);
  expect(await page.locator('#board [data-square]').count()).toBe(64);
  expect(await page.locator('#fen-input').inputValue()).toBe(fenBefore);
  expect(await page.locator('body').getAttribute('data-revision')).toBe(revisionBefore);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('view follows the camp in enemy half and survives turn and settings changes', async ({ page }) => {
  await page.goto('/');
  await loadFen(page, '4k3/8/5N2/8/8/2n5/8/4K3 b - - 0 1');
  await waitForImagesLoaded(page);
  let entries = await readBoardPieces(page);
  expect(entries.find((entry) => entry.square === 'f6')).toMatchObject({ color: 'w', type: 'n', view: 'rear' });
  expect(entries.find((entry) => entry.square === 'c3')).toMatchObject({ color: 'b', type: 'n', view: 'front' });
  expect(entries.find((entry) => entry.square === 'f6').src.endsWith(basenameFor('wn', 'rear'))).toBe(true);

  await page.getByRole('button', { name: '翻转棋盘' }).click();
  await waitForImagesLoaded(page);
  entries = await readBoardPieces(page);
  expect(entries.find((entry) => entry.square === 'f6').view).toBe('front');
  expect(entries.find((entry) => entry.square === 'c3').view).toBe('rear');
  expect(entries.find((entry) => entry.square === 'c3').src.endsWith(basenameFor('bn', 'rear'))).toBe(true);

  // A real turn change (black king steps out of check) must not re-orient.
  await square(page, 'e8').click();
  await square(page, 'd8').click();
  await expect(page.locator('#turn')).toHaveText('白方走棋');

  // Switching human color and game mode must not silently change the manual flip.
  await page.selectOption('#human-color', 'b');
  await page.selectOption('#human-color', 'w');
  await page.selectOption('#game-mode', 'computer');
  await expect(page.locator('#board')).toHaveAttribute('data-flipped', 'true');
  await expect(page.locator('#engine-status')).toHaveText('');
  await waitForImagesLoaded(page);
  entries = await readBoardPieces(page);
  expect(entries.find((entry) => entry.square === 'f6').view).toBe('front');
  expect(entries.find((entry) => entry.square === 'c3').view).toBe('rear');
});

test('white promotion previews use the pawn color and update while the modal is open', async ({ page }) => {
  await page.goto('/');
  await loadFen(page, '7k/P7/8/8/8/8/8/7K w - - 0 1');
  await square(page, 'a7').click();
  await square(page, 'a8').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await waitForImagesLoaded(page, '#promotion-dialog .promotion-piece img');

  const candidateViews = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('#promotion-dialog [data-promotion]')].map((button) => {
      const piece = button.querySelector('.promotion-piece .piece');
      const image = button.querySelector('.promotion-piece img');
      return [button.dataset.promotion, {
        color: piece?.dataset.color,
        view: piece?.dataset.view,
        src: image?.getAttribute('src') ?? null,
        loaded: Boolean(image?.complete && image?.naturalWidth > 0),
      }];
    }),
  ));
  let candidates = await candidateViews();
  for (const type of ['q', 'r', 'b', 'n']) {
    expect(candidates[type], `白方 ${type}`).toMatchObject({ color: 'w', view: 'rear', loaded: true });
    expect(candidates[type].src.endsWith(basenameFor(`w${type}`, 'rear')), `白方 ${type} 素材`).toBe(true);
  }
  await expect(page.locator('[data-promotion="q"] .promotion-name')).toHaveText('后');

  // The modal stays open; a programmatic flip event must update the previews.
  await page.evaluate(() => document.getElementById('flip').click());
  await expect(page.locator('#board')).toHaveAttribute('data-flipped', 'true');
  expect(await page.evaluate(() => document.getElementById('promotion-dialog').open)).toBe(true);
  await waitForImagesLoaded(page, '#promotion-dialog .promotion-piece img');
  candidates = await candidateViews();
  for (const type of ['q', 'r', 'b', 'n']) {
    expect(candidates[type], `翻转后白方 ${type}`).toMatchObject({ color: 'w', view: 'front', loaded: true });
    expect(candidates[type].src.endsWith(basenameFor(`w${type}`, 'front')), `翻转后白方 ${type} 素材`).toBe(true);
  }

  await page.getByRole('button', { name: '升变为马' }).click();
  await expect(dialog).toBeHidden();
  await expect(square(page, 'a8')).toHaveAttribute('data-piece', 'n');
  await expect(square(page, 'a8')).toHaveAttribute('data-color', 'w');
});

test('cancelling promotion keeps the pawn and the position', async ({ page }) => {
  await page.goto('/');
  await loadFen(page, '7k/P7/8/8/8/8/8/7K w - - 0 1');
  const revisionBefore = await page.locator('body').getAttribute('data-revision');
  await square(page, 'a7').click();
  await square(page, 'a8').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: '取消升变' }).click();
  await expect(dialog).toBeHidden();
  await expect(square(page, 'a7')).toHaveAttribute('data-piece', 'p');
  await expect(square(page, 'a8')).not.toHaveAttribute('data-piece');
  expect(await page.locator('body').getAttribute('data-revision')).toBe(revisionBefore);
});

test('black promotion previews use black front by default and apply the chosen type', async ({ page }) => {
  await page.goto('/');
  await loadFen(page, '7k/8/8/8/8/8/p7/6K1 b - - 0 1');
  await square(page, 'a2').click();
  await square(page, 'a1').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await waitForImagesLoaded(page, '#promotion-dialog .promotion-piece img');
  const candidates = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('#promotion-dialog [data-promotion]')].map((button) => {
      const piece = button.querySelector('.promotion-piece .piece');
      return [button.dataset.promotion, { color: piece?.dataset.color, view: piece?.dataset.view }];
    }),
  ));
  for (const type of ['q', 'r', 'b', 'n']) {
    expect(candidates[type], `黑方 ${type}`).toMatchObject({ color: 'b', view: 'front' });
  }
  await page.getByRole('button', { name: '升变为车' }).click();
  await expect(dialog).toBeHidden();
  await expect(square(page, 'a1')).toHaveAttribute('data-piece', 'r');
  await expect(square(page, 'a1')).toHaveAttribute('data-color', 'b');
});

test('piece boxes stay inside squares, share the baseline and keep king above pawn', async ({ page }) => {
  await page.goto('/');
  for (const width of [440, 900, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const measurements = await measureBoard(page);
    expect(measurements.length).toBe(32);
    const squareWidth = measurements[0].squareBox.width;
    expect(squareWidth).toBeGreaterThanOrEqual(46);
    expect(squareWidth).toBeLessThanOrEqual(96);
    for (const entry of measurements) {
      const meta = pieceById.get(entry.color + entry.type).views[entry.view];
      const contentLeft = entry.imageBox.x + entry.imageBox.width * (meta.contentBounds.left / meta.width);
      const contentRight = entry.imageBox.x + entry.imageBox.width * ((meta.contentBounds.right + 1) / meta.width);
      expect(contentLeft, `${entry.square} 左越界`).toBeGreaterThanOrEqual(entry.squareBox.x - 1);
      expect(contentRight, `${entry.square} 右越界`).toBeLessThanOrEqual(entry.squareBox.x + entry.squareBox.width + 1);
      const contentBottom = entry.imageBox.y + entry.imageBox.height * ((meta.contentBounds.bottom + 1) / meta.height);
      const expectedBottom = entry.squareBox.y + manifest.rendering.bottomBaselineFraction * entry.squareBox.height;
      expect(Math.abs(contentBottom - expectedBottom), `${entry.square} 基线`).toBeLessThanOrEqual(1.5);
    }
    const contentHeight = (entry) => {
      const meta = pieceById.get(entry.color + entry.type).views[entry.view];
      return entry.imageBox.height * ((meta.contentBounds.bottom - meta.contentBounds.top + 1) / meta.height);
    };
    const king = measurements.find((entry) => entry.color === 'w' && entry.type === 'k');
    const pawn = measurements.find((entry) => entry.color === 'w' && entry.type === 'p');
    expect(contentHeight(king), `${width}px 王应高于兵`).toBeGreaterThan(contentHeight(pawn));
  }
});

test('saves white-bottom, black-bottom and 320px screenshots while play still works', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('#board .piece img')).toHaveCount(32);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'pieces-white-bottom.png') });
  await page.getByRole('button', { name: '翻转棋盘' }).click();
  await waitForImagesLoaded(page);
  assertBoardAssets(await readBoardPieces(page), { flipped: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'pieces-black-bottom.png') });
  await page.getByRole('button', { name: '翻转棋盘' }).click();

  await page.setViewportSize({ width: 320, height: 640 });
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true);
  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await expect(page.locator('#turn')).toHaveText('黑方走棋');
  expect(await page.evaluate(() => [...document.querySelectorAll('#board .piece img')]
    .every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'pieces-320.png'), fullPage: true });
  expect(errors).toEqual([]);
});
