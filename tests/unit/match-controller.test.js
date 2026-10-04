import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createGameSession } from '../../src/core/game-session.js';
import { createMatchController } from '../../src/engine/match-controller.js';

function harness(fen) {
  const session = createGameSession(fen ? { fen } : undefined);
  const requests = [];
  const engine = {
    search(request, { signal }) {
      return new Promise((resolve, reject) => requests.push({
        request, signal, reject,
        resolve: (bestMove, override = {}) => resolve({ requestId: request.requestId, revision: request.revision, bestMove, ...override }),
      })); // deliberately ignores cancellation: coordinator must reject stale results itself
    },
    async dispose() { for (const pending of requests) pending.reject(new Error('disposed')); },
  };
  const match = createMatchController({ session, createEngine: () => engine });
  return { match, requests };
}

test('computer turns pass the full history, block human input and undo back to the human turn', async () => {
  const { match, requests } = harness();
  match.configure({ mode: 'computer', level: 'easy' });
  match.start();
  match.tryMove({ from: 'e2', to: 'e4' });
  await tick();
  assert.equal(match.getState().thinking, true);
  assert.deepEqual(requests[0].request.moves, ['e2e4']);
  assert.equal(match.tryMove({ from: 'e7', to: 'e5' }).ok, false);
  assert.equal(requests[0].signal.aborted, false);
  requests[0].resolve('e7e5');
  await tick();
  assert.equal(match.getSnapshot().history.length, 2);
  assert.equal(match.getState().thinking, false);
  match.undo();
  assert.equal(match.getSnapshot().history.length, 0);
  assert.equal(match.getSnapshot().turn, 'w');
  await match.dispose();
});

for (const action of ['reset', 'undo', 'local']) {
  test(`${action} discards results from a cancelled computer search`, async () => {
    const { match, requests } = harness();
    match.configure({ mode: 'computer' });
    match.start();
    match.tryMove({ from: 'e2', to: 'e4' });
    await tick();
    if (action === 'local') match.configure({ mode: 'local' }); else match[action]();
    const before = match.getSnapshot().fen;
    assert.equal(requests[0].signal.aborted, true);
    requests[0].resolve('e7e5');
    await tick();
    assert.equal(match.getSnapshot().fen, before);
    assert.equal(match.getState().thinking, false);
    await match.dispose();
  });
}

test('mismatched or illegal results show a recoverable error and do not change the board', async () => {
  for (const [move, override] of [['e7e5', { requestId: 'stale' }], ['e7e4', {}]]) {
    const { match, requests } = harness();
    match.configure({ mode: 'computer' });
    match.start();
    match.tryMove({ from: 'e2', to: 'e4' });
    await tick();
    const before = match.getSnapshot().fen;
    requests[0].resolve(move, override);
    await tick();
    assert.ok(match.getState().error);
    assert.equal(match.getSnapshot().fen, before);
    match.retry();
    await tick();
    assert.equal(requests.length, 2);
    requests[1].resolve('e7e5');
    await tick();
    assert.equal(match.getSnapshot().history.length, 2);
    assert.equal(match.getState().error, null);
    await match.dispose();
  }
});

test('computer starts as white, and undoing its first move pauses until retry', async () => {
  const { match, requests } = harness();
  match.configure({ mode: 'computer', humanColor: 'b' });
  match.start();
  await tick();
  requests[0].resolve('e2e4');
  await tick();
  match.undo();
  await tick();
  assert.equal(match.getState().paused, true);
  assert.equal(requests.length, 1);
  match.retry();
  await tick();
  requests[1].resolve('d2d4');
  await tick();
  assert.equal(match.getSnapshot().turn, 'b');
  await match.dispose();
});

test('terminal positions never start an engine, and computer underpromotion is explicit', async () => {
  const terminal = harness('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1');
  terminal.match.configure({ mode: 'computer' });
  terminal.match.start();
  await tick();
  assert.equal(terminal.requests.length, 0);
  await terminal.match.dispose();
  const promotion = harness('7k/1P6/8/8/8/8/8/K7 w - - 0 1');
  promotion.match.configure({ mode: 'computer', humanColor: 'b' });
  promotion.match.start();
  await tick();
  promotion.requests[0].resolve('b7b8n');
  await tick();
  assert.equal(promotion.match.getSnapshot().history[0].promotion, 'n');
  await promotion.match.dispose();
});

test('computer setup cannot create an engine, accept moves or bypass start with retry', async () => {
  const session = createGameSession();
  let created = 0;
  const match = createMatchController({ session, createEngine: () => { created += 1; throw new Error('unexpected engine'); } });
  match.configure({ mode: 'computer', humanColor: 'b', level: 'easy' });
  match.configure({ level: 'expert' });
  match.retry();
  await tick();
  assert.equal(created, 0);
  assert.equal(match.getState().started, false);
  assert.equal(match.tryMove({ from: 'e2', to: 'e4' }).code, 'match-not-started');
  assert.equal(match.claimDraw('threefold-repetition').code, 'match-not-started');
  assert.equal(match.getSnapshot().history.length, 0);
  await match.dispose();
});

test('start uses the final settings once, and identical configuration does not restart it', async () => {
  const { match, requests } = harness();
  match.configure({ mode: 'computer', humanColor: 'b', level: 'easy' });
  match.configure({ level: 'expert' });
  match.start();
  match.start();
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.skillLevel, 20);
  assert.equal(requests[0].request.moveTimeMs, 2500);
  match.configure({ level: 'expert' });
  assert.equal(match.getState().started, true);
  assert.equal(requests[0].signal.aborted, false);
  requests[0].resolve('e2e4');
  await tick();
  assert.equal(match.getSnapshot().history.length, 1);
  await match.dispose();
});

test('changing difficulty cancels the old search and waits for explicit start and adapter settlement', async () => {
  const { match, requests } = harness();
  match.configure({ mode: 'computer', humanColor: 'b' });
  match.start();
  await tick();
  match.configure({ level: 'hard' });
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(match.getState().started, false);
  await tick();
  assert.equal(requests.length, 1);
  match.start();
  await tick();
  assert.equal(requests.length, 1, 'a cancelled adapter must settle before reuse');
  requests[0].resolve('e2e4');
  await tick();
  assert.equal(match.getSnapshot().history.length, 0, 'old reply must not reach the board');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].request.skillLevel, 16);
  requests[1].resolve('d2d4');
  await tick();
  assert.equal(match.getSnapshot().history[0].uci, 'd2d4');
  await match.dispose();
});

test('reset and valid FEN load require another start; invalid FEN preserves an active search', async () => {
  const { match, requests } = harness();
  match.configure({ mode: 'computer', humanColor: 'b' });
  match.start();
  await tick();
  const before = match.getSnapshot();
  assert.throws(() => match.reset({ fen: 'invalid' }));
  assert.equal(match.getSnapshot().revision, before.revision);
  assert.equal(match.getState().started, true);
  assert.equal(requests[0].signal.aborted, false);
  match.reset();
  match.retry();
  requests[0].resolve('e2e4');
  await tick();
  assert.equal(match.getState().started, false);
  assert.equal(requests.length, 1);
  assert.equal(match.getSnapshot().history.length, 0);
  const fen = '7k/1P6/8/8/8/8/8/K7 w - - 0 1';
  match.reset({ fen });
  await tick();
  assert.equal(requests.length, 1);
  match.start();
  await tick();
  assert.equal(requests[1].request.initialFen, fen);
  requests[1].resolve('b7b8q');
  await tick();
  assert.equal(match.getSnapshot().history[0].promotion, 'q');
  await match.dispose();
});
