/**
 * Pure display math for the realistic PNG pieces. No DOM access, so it can be
 * unit-tested; the formula comes from docs/PIECE-ASSETS.md and the rendering
 * block of the generated mapping.
 */
import { PIECE_ASSETS } from './piece-assets.generated.js';

/**
 * Face-to-face rule: the near side (bottom of the board) shows the rear view,
 * the far side the front view. Default board has white near; flipping swaps it.
 */
export function pieceViewForColor(pieceColor, flipped) {
  const nearColor = flipped ? 'b' : 'w';
  return pieceColor === nearColor ? 'rear' : 'front';
}

/**
 * Scale factor: content height may not exceed maxHeightFraction × relativeHeight
 * of the square, content width may not exceed maxWidthFraction. The PNG is
 * scaled proportionally, centred horizontally and its bottom lands on the
 * baseline fraction.
 *
 * @returns {{ src: string, widthPercent: number, heightPercent: number, leftPercent: number, topPercent: number } | null}
 */
export function computePieceBox(pieceId, view) {
  const piece = PIECE_ASSETS.pieces[pieceId];
  const viewData = piece?.views?.[view];
  if (!piece || !viewData) return null;
  const rendering = PIECE_ASSETS.rendering;
  const bounds = viewData.contentBounds;
  const contentWidth = bounds.right - bounds.left + 1;
  const contentHeight = bounds.bottom - bounds.top + 1;
  const scale = Math.min(
    (rendering.maximumContentHeightFraction * piece.relativeHeight) / contentHeight,
    rendering.maximumContentWidthFraction / contentWidth,
  );
  return {
    src: viewData.url,
    widthPercent: 100 * viewData.width * scale,
    heightPercent: 100 * viewData.height * scale,
    leftPercent: 50 - 100 * ((bounds.left + bounds.right + 1) / 2) * scale,
    topPercent: 100 * rendering.bottomBaselineFraction - 100 * (bounds.bottom + 1) * scale,
  };
}

export function resolvePieceSource(url, baseUri) {
  return new URL(url, baseUri).href;
}
