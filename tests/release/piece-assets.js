import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../assets/pieces-manifest.json', import.meta.url), 'utf8'));
const byId = new Map(manifest.pieces.map((piece) => [piece.id, piece]));

export async function expectPieceImages(page, { flipped = false } = {}) {
  await expect(page.locator('#board .piece img')).toHaveCount(32);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#board .piece img')]
    .filter((img) => !img.complete || img.naturalWidth === 0).length), { timeout: 15000 }).toBe(0);
  const { baseUri, pieces } = await page.evaluate(() => ({
    baseUri: document.baseURI,
    pieces: [...document.querySelectorAll('#board .piece')].map((piece) => {
      const image = piece.querySelector('img');
      const imageBox = image.getBoundingClientRect();
      const squareBox = piece.closest('[data-square]').getBoundingClientRect();
      return { id: piece.dataset.color + piece.dataset.piece, color: piece.dataset.color, view: piece.dataset.view,
        src: image.src, width: image.naturalWidth, height: image.naturalHeight,
        imageY: imageBox.y, imageHeight: imageBox.height, squareY: squareBox.y, squareHeight: squareBox.height,
        pieceTransform: getComputedStyle(piece).transform, imageTransform: getComputedStyle(image).transform };
    }),
  }));
  expect(pieces).toHaveLength(32);
  for (const piece of pieces) {
    const view = piece.color === (flipped ? 'b' : 'w') ? 'rear' : 'front';
    const expected = byId.get(piece.id).views[view];
    expect(piece.view).toBe(view);
    expect(piece.src).toBe(new URL(`./pieces/staunton-v3/${expected.path.split('/').pop()}`, baseUri).href);
    expect(piece.width).toBe(expected.width);
    expect(piece.height).toBe(expected.height);
    expect(piece.pieceTransform).toBe('none');
    expect(piece.imageTransform).toBe('none');
    const bounds = expected.contentBounds;
    const visibleHeight = bounds.bottom - bounds.top + 1;
    const scale = Math.min(manifest.rendering.maximumContentHeightFraction * byId.get(piece.id).relativeHeight / visibleHeight,
      manifest.rendering.maximumContentWidthFraction / (bounds.right - bounds.left + 1));
    expect(Math.abs(piece.imageHeight * visibleHeight / expected.height - piece.squareHeight * scale * visibleHeight)).toBeLessThan(1.5);
    expect(Math.abs(piece.imageY + piece.imageHeight * (bounds.bottom + 1) / expected.height
      - (piece.squareY + piece.squareHeight * manifest.rendering.bottomBaselineFraction))).toBeLessThan(1.5);
  }
}

export async function expectInvalidFenPreservesGame(page) {
  const beforeFen = await page.locator('#fen-input').inputValue();
  const beforeRevision = await page.locator('body').getAttribute('data-revision');
  await page.locator('#position-tools summary').click();
  await page.locator('#fen-input').fill('7k/8/8/8/8/8/4r3/4K2R w - - 0 1');
  await page.getByRole('button', { name: '载入 FEN' }).click();
  await expect(page.locator('#fen-message')).toHaveText('无法载入该 FEN：非法 FEN：未走棋的一方处于被将军状态。');
  expect(await page.locator('#fen-input').inputValue()).toBe(beforeFen);
  expect(await page.locator('body').getAttribute('data-revision')).toBe(beforeRevision);
  await page.locator('#position-tools summary').click();
}
