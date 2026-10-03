import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { Chess } from 'chess.js';
import { createUciAdapter } from '../../src/engine/uci-adapter.js';

const request = (overrides = {}) => ({
  requestId: 'test-1', revision: 1, initialFen: new Chess().fen(), moves: [],
  skillLevel: 8, moveTimeMs: 100, ...overrides,
});

function harness({ hold, bestMove = 'e2e4', firstOnly = false } = {}) {
  const instances = [];
  const adapter = createUciAdapter({
    handshakeTimeoutMs: 100, searchGraceMs: 20,
    createTransport(callbacks) {
      const instance = {
        ...callbacks, commands: [], releases: 0,
        send(command) {
          this.commands.push(command);
          const phase = command.split(' ')[0];
          if (phase === hold && (!firstOnly || instances.length === 1)) return;
          if (phase === 'uci') { this.onLine('id name Stockfish 19 Test'); this.onLine('uciok'); }
          if (phase === 'isready') this.onLine('readyok');
          if (phase === 'go') this.onLine(`bestmove ${bestMove}`);
        },
        async dispose() { this.releases += 1; },
      };
      instances.push(instance);
      return instance;
    },
  });
  return { adapter, instances };
}

test('UCI adapter preserves full history and correlates results while reusing a ready engine', async () => {
  const { adapter, instances } = harness({ bestMove: 'e7e5' });
  try {
    const input = request({ moves: ['e2e4'] });
    const resultPromise = adapter.search(input);
    input.moves.push('invalid');
    input.requestId = 'mutated';
    assert.deepEqual(await resultPromise, { requestId: 'test-1', revision: 1, bestMove: 'e7e5' });
    await adapter.search(request({ requestId: 'test-2', revision: 2, moves: ['e2e4'], skillLevel: 0 }));
    assert.equal(instances.length, 1);
    assert.equal(instances[0].commands.filter((line) => line === 'uci').length, 1);
    assert.ok(instances[0].commands.includes(`position fen ${new Chess().fen()} moves e2e4`));
    assert.ok(instances[0].commands.includes('setoption name Skill Level value 0'));
  } finally { await adapter.dispose(); }
});

test('invalid budgets, move history and command injection never start an engine', async () => {
  const { adapter, instances } = harness();
  for (const update of [
    { requestId: 123 }, { revision: -1 }, { skillLevel: 21 }, { moveTimeMs: 0 },
    { initialFen: `${new Chess().fen()}\nquit` }, { moves: ['e2e5'] }, { moves: ['e2e4\nquit'] },
  ]) await assert.rejects(adapter.search(request(update)));
  assert.equal(instances.length, 0);
  await adapter.dispose();
});

for (const hold of ['uci', 'isready', 'go']) {
  test(`cancelling during ${hold} retires old output before a fresh search`, async () => {
    const { adapter, instances } = harness({ hold, firstOnly: true });
    const abort = new AbortController();
    const pending = adapter.search(request(), { signal: abort.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await tick();
    await assert.rejects(adapter.search(request({ requestId: 'overlap' })), /已有搜索/);
    abort.abort();
    await rejected;
    const next = adapter.search(request({ requestId: 'fresh', revision: 2 }));
    instances[0].onLine('bestmove e2e5'); // late output from an uncooperative retired transport
    assert.equal((await next).bestMove, 'e2e4');
    assert.equal(instances.length, 2);
    assert.equal(instances[0].releases, 1);
    await adapter.dispose();
  });
}

test('timeout and illegal bestmove fail and release their transports', async () => {
  for (const options of [{ hold: 'go' }, { bestMove: 'e2e5' }, { bestMove: '0000' }]) {
    const { adapter, instances } = harness(options);
    await assert.rejects(adapter.search(request()));
    await adapter.dispose();
    assert.equal(instances[0].releases, 1);
  }
});

test('terminal empty moves and explicit underpromotion follow the rules', async () => {
  const terminal = harness({ bestMove: '(none)' });
  assert.equal((await terminal.adapter.search(request({ initialFen: '7k/6Q1/5K2/8/8/8/8/8 b - - 0 1' }))).bestMove, null);
  await terminal.adapter.dispose();
  const promotion = harness({ bestMove: 'b7b8n' });
  assert.equal((await promotion.adapter.search(request({ initialFen: '7k/1P6/8/8/8/8/8/K7 w - - 0 1' }))).bestMove, 'b7b8n');
  await promotion.adapter.dispose();
});

test('dispose aborts an outstanding search, is idempotent and blocks later searches', async () => {
  const { adapter, instances } = harness({ hold: 'go' });
  const pending = adapter.search(request());
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  const first = adapter.dispose();
  assert.equal(adapter.dispose(), first);
  await first;
  await rejected;
  await assert.rejects(adapter.search(request()), /已释放/);
  assert.equal(instances[0].releases, 1);
});

test('transport failure rejects the search and retires the failed engine', async () => {
  const { adapter, instances } = harness({ hold: 'go', firstOnly: true });
  const pending = adapter.search(request());
  const rejected = assert.rejects(pending, /engine-crashed/);
  await tick();
  instances[0].onError(new Error('engine-crashed'));
  await rejected;
  assert.equal((await adapter.search(request({ requestId: 'retry' }))).bestMove, 'e2e4');
  assert.equal(instances.length, 2);
  await adapter.dispose();
});

test('a cleanup failure blocks new engines instead of hiding an unreleased process', async () => {
  const { adapter, instances } = harness({ hold: 'go' });
  const abort = new AbortController();
  const pending = adapter.search(request(), { signal: abort.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  instances[0].dispose = async () => { throw new Error('release-failed'); };
  abort.abort();
  await rejected;
  await assert.rejects(adapter.search(request({ requestId: 'new' })), /release-failed/);
  assert.equal(instances.length, 1);
  await assert.rejects(adapter.dispose(), /release-failed/);
});

test('a crash arriving with the final bestmove is not accepted as a successful search', async () => {
  const { adapter, instances } = harness({ hold: 'go' });
  const pending = adapter.search(request());
  const rejected = assert.rejects(pending, /crashed-after-output/);
  await tick();
  instances[0].onLine('bestmove e2e4');
  instances[0].onError(new Error('crashed-after-output'));
  await rejected;
  await adapter.dispose();
});
