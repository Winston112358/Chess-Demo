import { Chess, DEFAULT_POSITION } from 'chess.js';

const PROMOTIONS = ['q', 'r', 'b', 'n'];
const isSquare = (value) => typeof value === 'string' && /^[a-h][1-8]$/.test(value);
const positionKey = (chess) => chess.fen().split(' ').slice(0, 4).join(' ');

function describeMove(move) {
  return {
    color: move.color, from: move.from, to: move.to, piece: move.piece,
    san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ''}`,
    ...(move.captured ? { captured: move.captured } : {}),
    ...(move.promotion ? { promotion: move.promotion } : {}),
  };
}

/** The only owner of chess rules and position history. UI receives detached snapshots. */
export function createGameSession({ fen = DEFAULT_POSITION } = {}) {
  let chess = new Chess(fen);
  let initialFen = chess.fen();
  let revision = 0;
  let positionKeys = [positionKey(chess)];
  let claimedDraw = null;

  function repetitionCount() {
    const current = positionKeys.at(-1);
    return positionKeys.filter((key) => key === current).length;
  }

  function outcome() {
    // Checkmate takes precedence over the 75-move automatic draw.
    if (chess.isCheckmate()) {
      return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
    }
    if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
    if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient-material' };
    if (repetitionCount() >= 5) return { result: '1/2-1/2', reason: 'fivefold-repetition' };
    if (Number(chess.fen().split(' ')[4]) >= 150) return { result: '1/2-1/2', reason: 'seventy-five-moves' };
    return claimedDraw ? { result: '1/2-1/2', reason: claimedDraw } : null;
  }

  function drawClaims() {
    if (outcome()) return [];
    return [
      ...(repetitionCount() >= 3 ? ['threefold-repetition'] : []),
      ...(chess.isDrawByFiftyMoves() ? ['fifty-moves'] : []),
    ];
  }

  function getSnapshot() {
    const history = chess.history({ verbose: true }).map(describeMove);
    return {
      revision, initialFen, fen: chess.fen(), turn: chess.turn(),
      board: chess.board().map((rank) => rank.map((piece) => piece ? { ...piece } : null)),
      history, lastMove: history.at(-1) ?? null,
      inCheck: chess.isCheck(), outcome: outcome(), drawClaims: drawClaims(),
      canUndo: history.length > 0,
    };
  }

  const failure = (code, extra = {}) => ({ ok: false, code, ...extra, snapshot: getSnapshot() });

  function legalMovesFrom(square) {
    if (!isSquare(square) || outcome()) return [];
    return chess.moves({ square, verbose: true }).map(describeMove);
  }

  function tryMove(move) {
    if (outcome()) return failure('game-over');
    if (!move || !isSquare(move.from) || !isSquare(move.to)) return failure('illegal-move');
    const candidates = legalMovesFrom(move.from).filter((candidate) => candidate.to === move.to);
    if (candidates.some((candidate) => candidate.promotion) && !move.promotion) {
      return failure('promotion-required', { choices: [...PROMOTIONS] });
    }
    if (!candidates.some((candidate) => candidate.promotion === move.promotion)) return failure('illegal-move');
    chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    positionKeys.push(positionKey(chess));
    revision += 1;
    return { ok: true, snapshot: getSnapshot() };
  }

  function undo() {
    if (!chess.undo()) return failure('no-history');
    positionKeys.pop();
    claimedDraw = null;
    revision += 1;
    return { ok: true, snapshot: getSnapshot() };
  }

  function reset({ fen: nextFen = DEFAULT_POSITION } = {}) {
    // Construct first so invalid input cannot destroy the current game.
    const nextChess = new Chess(nextFen);
    chess = nextChess;
    initialFen = chess.fen();
    positionKeys = [positionKey(chess)];
    claimedDraw = null;
    revision += 1;
    return getSnapshot();
  }

  function claimDraw(reason) {
    if (!drawClaims().includes(reason)) return failure('draw-unavailable');
    claimedDraw = reason;
    revision += 1;
    return { ok: true, snapshot: getSnapshot() };
  }

  return Object.freeze({ getSnapshot, legalMovesFrom, tryMove, undo, reset, claimDraw });
}
