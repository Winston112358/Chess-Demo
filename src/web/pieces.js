const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const NAMES = { k: '王', q: '后', r: '车', b: '象', n: '马', p: '兵' };
const COLOR_NAMES = { w: '白方', b: '黑方' };

/**
 * Temporary Unicode piece view. Replacing this module with PNG/WebP rendering
 * must not require changes to rules or the board geometry.
 */
export function createPieceElement(piece) {
  const element = document.createElement('span');
  element.className = `piece piece--${piece.color}`;
  element.dataset.piece = piece.type;
  element.dataset.color = piece.color;
  element.dataset.glyph = GLYPHS[piece.type] ?? '?';
  element.setAttribute('aria-hidden', 'true');
  return element;
}

export function describePiece(piece) {
  return `${COLOR_NAMES[piece.color] ?? ''}${NAMES[piece.type] ?? '棋子'}`;
}
