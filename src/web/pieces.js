import { computePieceBox, pieceViewForColor, resolvePieceSource } from './piece-view.js';

const NAMES = { k: '王', q: '后', r: '车', b: '象', n: '马', p: '兵' };
const COLOR_NAMES = { w: '白方', b: '黑方' };

/**
 * Realistic PNG piece view. The caller only supplies the logical piece and the
 * board orientation; view selection (front/rear) and geometry come from the
 * generated mapping. Missing mappings are marked, never faked with glyphs.
 */
export function createPieceElement(piece, { flipped = false, baseUri = document.baseURI } = {}) {
  const view = pieceViewForColor(piece.color, flipped);
  const element = document.createElement('span');
  element.className = `piece piece--${piece.color}`;
  element.dataset.piece = piece.type;
  element.dataset.color = piece.color;
  element.dataset.view = view;
  element.setAttribute('aria-hidden', 'true');

  const box = computePieceBox(`${piece.color}${piece.type}`, view);
  if (!box) {
    element.dataset.imageMissing = 'true';
    return element;
  }
  const image = document.createElement('img');
  image.className = 'piece-img';
  image.src = resolvePieceSource(box.src, baseUri);
  image.alt = '';
  image.draggable = false;
  image.setAttribute('aria-hidden', 'true');
  element.style.width = `${box.widthPercent}%`;
  element.style.height = `${box.heightPercent}%`;
  element.style.left = `${box.leftPercent}%`;
  element.style.top = `${box.topPercent}%`;
  element.append(image);
  return element;
}

export function describePiece(piece) {
  return `${COLOR_NAMES[piece.color] ?? ''}${NAMES[piece.type] ?? '棋子'}`;
}
