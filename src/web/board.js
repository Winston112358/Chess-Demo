import { createPieceElement, describePiece } from './pieces.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8];

const isLightSquare = (square) => ((square.charCodeAt(0) - 97) + Number(square[1])) % 2 === 0;

function pieceAt(snapshot, square) {
  const row = 8 - Number(square[1]);
  const column = square.charCodeAt(0) - 97;
  return snapshot.board[row][column];
}

function coordinateLabel(text) {
  const span = document.createElement('span');
  span.className = 'coord';
  span.textContent = text;
  return span;
}

/**
 * Renders snapshots into a persistent 8x8 grid. Every cell keeps its real
 * `data-square`; flipping only changes the display order.
 */
export function createBoardView({ boardEl, ranksEl, filesEl, onSquareClick }) {
  const squares = new Map();

  for (const rank of RANKS) {
    for (const file of FILES) {
      const square = `${file}${rank}`;
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'square';
      element.dataset.square = square;
      element.addEventListener('click', () => onSquareClick(square));
      squares.set(square, element);
    }
  }

  function displayOrder(flipped) {
    const ranks = flipped ? [...RANKS] : [...RANKS].reverse();
    const files = flipped ? [...FILES].reverse() : [...FILES];
    const order = [];
    for (const rank of ranks) {
      for (const file of files) order.push(`${file}${rank}`);
    }
    return { order, ranks, files };
  }

  function render(snapshot, { flipped = false, selected = null, targets = new Map(), checkSquare = null } = {}) {
    const { order, ranks, files } = displayOrder(flipped);
    boardEl.append(...order.map((square) => squares.get(square)));
    ranksEl.replaceChildren(...ranks.map((rank) => coordinateLabel(String(rank))));
    filesEl.replaceChildren(...files.map((file) => coordinateLabel(file)));

    const lastMove = snapshot.lastMove;
    for (const [square, element] of squares) {
      const piece = pieceAt(snapshot, square);
      const isTarget = targets.has(square);
      element.className = `square ${isLightSquare(square) ? 'square--light' : 'square--dark'}`;
      if (square === selected) element.classList.add('square--selected');
      if (isTarget) element.classList.add(targets.get(square) ? 'square--capture' : 'square--target');
      if (square === checkSquare) element.classList.add('square--check');
      if (lastMove && (square === lastMove.from || square === lastMove.to)) element.classList.add('square--last');

      element.replaceChildren(...(piece ? [createPieceElement(piece)] : []));
      if (piece) {
        element.dataset.piece = piece.type;
        element.dataset.color = piece.color;
      } else {
        delete element.dataset.piece;
        delete element.dataset.color;
      }
      const base = piece ? `${square} ${describePiece(piece)}` : `${square} 空格`;
      element.setAttribute('aria-label', isTarget ? `${base}，可移动到此处` : base);
    }
  }

  return { render };
}
