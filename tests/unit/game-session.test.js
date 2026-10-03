import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession } from '../../src/core/game-session.js';

test('snapshots cannot change the session, and illegal moves do not change revision', () => {
  const game = createGameSession();
  const first = game.getSnapshot();
  first.board[0][0].type = 'q';
  assert.equal(game.getSnapshot().board[0][0].type, 'r');
  assert.equal(game.tryMove({ from: 'e2', to: 'e5' }).code, 'illegal-move');
  assert.equal(game.getSnapshot().revision, 0);
  assert.equal(game.tryMove({ from: 'e2', to: 'e4' }).ok, true);
  assert.equal(game.getSnapshot().history[0].uci, 'e2e4');
});

test('undo and reset monotonically invalidate earlier revisions', () => {
  const game = createGameSession();
  game.tryMove({ from: 'e2', to: 'e4' });
  assert.equal(game.undo().snapshot.revision, 2);
  assert.equal(game.reset().revision, 3);
  assert.throws(() => game.reset({ fen: 'invalid' }));
  assert.equal(game.getSnapshot().revision, 3);
});

test('promotion requires an explicit choice and supports underpromotion', () => {
  const game = createGameSession({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1' });
  const result = game.tryMove({ from: 'a7', to: 'a8' });
  assert.equal(result.code, 'promotion-required');
  assert.deepEqual(result.choices, ['q', 'r', 'b', 'n']);
  assert.equal(result.snapshot.revision, 0);
  assert.equal(game.tryMove({ from: 'a7', to: 'a8', promotion: 'n' }).snapshot.history[0].uci, 'a7a8n');
});

test('castling through an attacked square is rejected', () => {
  const game = createGameSession({ fen: 'k4r2/8/8/8/8/8/8/4K2R w K - 0 1' });
  assert.equal(game.tryMove({ from: 'e1', to: 'g1' }).code, 'illegal-move');
});

test('en passant that exposes the king is rejected', () => {
  const game = createGameSession({ fen: 'k7/8/8/4KPpr/8/8/8/8 w - g6 0 1' });
  assert.equal(game.tryMove({ from: 'f5', to: 'g6' }).code, 'illegal-move');
});

test('threefold can be claimed while fivefold ends the game automatically', () => {
  const game = createGameSession();
  const cycle = [{ from: 'g1', to: 'f3' }, { from: 'g8', to: 'f6' }, { from: 'f3', to: 'g1' }, { from: 'f6', to: 'g8' }];
  for (let i = 0; i < 2; i += 1) for (const move of cycle) assert.equal(game.tryMove(move).ok, true);
  assert.equal(game.getSnapshot().outcome, null);
  assert.deepEqual(game.getSnapshot().drawClaims, ['threefold-repetition']);
  assert.equal(game.claimDraw('threefold-repetition').snapshot.outcome.reason, 'threefold-repetition');
  assert.equal(game.tryMove(cycle[0]).code, 'game-over');
  game.undo();
  assert.equal(game.getSnapshot().outcome, null);
  game.tryMove(cycle[3]);
  for (let i = 0; i < 2; i += 1) for (const move of cycle) assert.equal(game.tryMove(move).ok, true);
  assert.equal(game.getSnapshot().outcome.reason, 'fivefold-repetition');
});

test('fifty moves is claimable, seventy-five moves is automatic, and mate has priority', () => {
  const claimable = createGameSession({ fen: '7k/8/8/8/8/8/8/KR6 w - - 100 51' });
  assert.equal(claimable.getSnapshot().outcome, null);
  assert.deepEqual(claimable.getSnapshot().drawClaims, ['fifty-moves']);
  const automatic = createGameSession({ fen: '7k/8/8/8/8/8/8/KR6 w - - 150 76' });
  assert.equal(automatic.getSnapshot().outcome.reason, 'seventy-five-moves');
  const mate = createGameSession({ fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 150 76' });
  assert.deepEqual(mate.getSnapshot().outcome, { result: '1-0', reason: 'checkmate' });
});

test('checkmate and stalemate have different results', () => {
  const game = createGameSession();
  for (const move of [{ from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' }, { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' }]) game.tryMove(move);
  assert.deepEqual(game.getSnapshot().outcome, { result: '0-1', reason: 'checkmate' });
  const stalemate = createGameSession({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
  assert.equal(stalemate.getSnapshot().outcome.reason, 'stalemate');
});
