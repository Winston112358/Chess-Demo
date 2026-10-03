import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopAdapter } from '../../src/engine/desktop-adapter.js';

const REQUEST = (id) => ({
  requestId: id, revision: 0, initialFen: 'start', moves: [], moveTimeMs: 100, skillLevel: 0,
});

function createBridge() {
  const state = { searches: [], cancels: [], disposals: 0 };
  const pending = new Map();
  return {
    state,
    pending,
    api: {
      protocolVersion: 1,
      search(request) {
        state.searches.push(request);
        return new Promise((resolve, reject) => pending.set(request.requestId, { resolve, reject }));
      },
      cancel(requestId) {
        state.cancels.push(requestId);
        return Promise.resolve(true);
      },
      dispose() {
        state.disposals += 1;
        return Promise.resolve();
      },
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待超时');
    await delay(5);
  }
}

test('desktop adapter validates the bridge protocol and functions', () => {
  assert.throws(() => createDesktopAdapter(null));
  assert.throws(() => createDesktopAdapter({ protocolVersion: 2, search() {}, cancel() {}, dispose() {} }), /版本/);
  assert.throws(() => createDesktopAdapter({ protocolVersion: 1, search() {} }), TypeError);
  assert.equal(typeof createDesktopAdapter(createBridge().api).search, 'function');
});

test('aborted search rejects immediately and a late IPC result never revives it', async () => {
  const { api, pending, state } = createBridge();
  const adapter = createDesktopAdapter(api);
  const controller = new AbortController();
  const aborted = adapter.search(REQUEST('a'), { signal: controller.signal });
  aborted.catch(() => {});
  await waitFor(() => state.searches.length === 1);

  controller.abort();
  await assert.rejects(aborted, (error) => error.name === 'AbortError');
  pending.get('a').resolve({ requestId: 'a', revision: 0, bestMove: 'e2e4' }); // late arrival

  const next = adapter.search(REQUEST('b'));
  await waitFor(() => state.searches.length === 2);
  assert.deepEqual(state.cancels, ['a']);
  pending.get('b').resolve({ requestId: 'b', revision: 0, bestMove: 'e7e5' });
  assert.equal((await next).bestMove, 'e7e5');
  await adapter.dispose();
});

test('the next search waits for the cancel acknowledgement', async () => {
  const gate = deferred();
  const { api, pending, state } = createBridge();
  api.cancel = (requestId) => {
    state.cancels.push(requestId);
    return gate.promise;
  };
  const adapter = createDesktopAdapter(api);
  const controller = new AbortController();
  const first = adapter.search(REQUEST('a'), { signal: controller.signal });
  first.catch(() => {});
  await waitFor(() => state.searches.length === 1);
  controller.abort();
  await assert.rejects(first, (error) => error.name === 'AbortError');

  const second = adapter.search(REQUEST('b'));
  await delay(30);
  assert.equal(state.searches.length, 1, '取消确认前不得发送新请求');
  gate.resolve(true);
  await waitFor(() => state.searches.length === 2);
  pending.get('b').resolve({ requestId: 'b', revision: 0, bestMove: 'g1f3' });
  await second;
  await adapter.dispose();
});

test('an abort while waiting for the cancel barrier never sends the request', async () => {
  const gate = deferred();
  const { api, state } = createBridge();
  api.cancel = () => gate.promise;
  const adapter = createDesktopAdapter(api);
  const firstController = new AbortController();
  const first = adapter.search(REQUEST('a'), { signal: firstController.signal });
  first.catch(() => {});
  await waitFor(() => state.searches.length === 1);
  firstController.abort();
  await assert.rejects(first, (error) => error.name === 'AbortError');

  const secondController = new AbortController();
  const second = adapter.search(REQUEST('b'), { signal: secondController.signal });
  secondController.abort();
  await assert.rejects(second, (error) => error.name === 'AbortError');
  gate.resolve(true);
  await delay(20);
  assert.equal(state.searches.length, 1);
  await adapter.dispose();
});

test('dispose cancels the active search, waits for the release and is idempotent', async () => {
  const { api, state } = createBridge();
  const disposeGate = deferred();
  api.dispose = async () => {
    state.disposals += 1;
    await disposeGate.promise;
  };
  const adapter = createDesktopAdapter(api);
  const controller = new AbortController();
  const active = adapter.search(REQUEST('a'), { signal: controller.signal });
  active.catch(() => {});
  await waitFor(() => state.searches.length === 1);

  const first = adapter.dispose();
  const second = adapter.dispose();
  assert.equal(first, second);
  await assert.rejects(active, (error) => error.name === 'AbortError');
  assert.deepEqual(state.cancels, ['a']);
  await assert.rejects(adapter.search(REQUEST('b')), (error) => error.name === 'AbortError');

  disposeGate.resolve();
  await first;
  assert.equal(state.disposals, 1);
});

test('IPC failures reject the search and later searches still work', async () => {
  const { api, pending, state } = createBridge();
  const adapter = createDesktopAdapter(api);
  const failing = adapter.search(REQUEST('a'));
  failing.catch(() => {});
  await waitFor(() => state.searches.length === 1);
  pending.get('a').reject(new Error('bridge failure'));
  await assert.rejects(failing, /bridge failure/);

  const next = adapter.search(REQUEST('b'));
  await waitFor(() => state.searches.length === 2);
  pending.get('b').resolve({ requestId: 'b', revision: 0, bestMove: 'e7e5' });
  assert.equal((await next).bestMove, 'e7e5');
  await adapter.dispose();
});

test('release failure rejects dispose and blocks further searches', async () => {
  const { api } = createBridge();
  api.dispose = async () => {
    throw new Error('release failed');
  };
  const adapter = createDesktopAdapter(api);
  await assert.rejects(adapter.dispose(), /release failed/);
  await assert.rejects(adapter.search(REQUEST('x')), (error) => error.name === 'AbortError');
});

test('an abort queued before IPC dispatch never sends a search', async () => {
  const { api, state } = createBridge();
  const adapter = createDesktopAdapter(api);
  const controller = new AbortController();
  const pending = adapter.search(REQUEST('a'), { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  queueMicrotask(() => controller.abort());
  await rejected;
  await adapter.dispose();
  assert.equal(state.searches.length, 0);
  assert.equal(state.cancels.length, 0);
});

test('two calls waiting on the same barrier cannot both dispatch a search', async () => {
  const { api, state, pending } = createBridge();
  const adapter = createDesktopAdapter(api);
  const first = adapter.search(REQUEST('a'));
  const second = adapter.search(REQUEST('b'));
  const rejected = assert.rejects(second, /已有搜索/);
  await waitFor(() => state.searches.length >= 1);
  pending.get('a').resolve({ requestId: 'a', revision: 0, bestMove: 'e2e4' });
  pending.get('b')?.resolve({ requestId: 'b', revision: 0, bestMove: 'e2e4' });
  await first;
  await rejected;
  await adapter.dispose();
  assert.equal(state.searches.length, 1);
});

test('a failed cancel blocks new searches but still permits backend disposal', async () => {
  const { api, state } = createBridge();
  api.cancel = async () => { throw new Error('cancel bridge failed'); };
  const adapter = createDesktopAdapter(api);
  const controller = new AbortController();
  const first = adapter.search(REQUEST('a'), { signal: controller.signal });
  first.catch(() => {});
  await waitFor(() => state.searches.length === 1);
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  await assert.rejects(adapter.search(REQUEST('b')), /取消失败/);
  assert.equal(state.searches.length, 1);
  await assert.rejects(adapter.dispose(), /cancel bridge failed/);
  assert.equal(state.disposals, 1);
});
