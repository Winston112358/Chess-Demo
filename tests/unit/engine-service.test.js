import test from 'node:test';
import assert from 'node:assert/strict';
import { registerEngineService } from '../../src/desktop/engine-service.js';

const INDEX_URL = 'file:///D:/Chess/dist/web/index.html';
const REQUEST = (id) => ({
  requestId: id, revision: 0, initialFen: 'start', moves: [], moveTimeMs: 100, skillLevel: 0,
});

function createIpcMainMock() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error(`重复注册 ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    async invoke(channel, event, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`没有注册 ${channel}`);
      return handler(event, ...args);
    },
  };
}

function createWebContentsMock() {
  return { mainFrame: { url: INDEX_URL } };
}

function trustedEvent(webContents) {
  return { sender: webContents, senderFrame: webContents.mainFrame };
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

async function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createFakeEngineFactory({ failDispose = false, disposeGate = null } = {}) {
  const calls = { created: 0, disposed: 0, searches: [] };
  function createEngine() {
    calls.created += 1;
    return {
      search(request, { signal } = {}) {
        const record = { request, signal, resolve: null, reject: null };
        calls.searches.push(record);
        return new Promise((resolve, reject) => {
          record.resolve = resolve;
          record.reject = reject;
          const onAbort = () => reject(Object.assign(new Error('搜索已取消'), { name: 'AbortError' }));
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
      async dispose() {
        calls.disposed += 1;
        if (disposeGate) await disposeGate.promise;
        if (failDispose) throw new Error('dispose failed');
      },
    };
  }
  return { createEngine, calls };
}

function register(ipcMain, webContents, factory) {
  return registerEngineService({
    ipcMain, webContents, indexUrl: INDEX_URL, createEngine: factory.createEngine,
  });
}

test('engine service rejects untrusted senders, frames and URLs but strips the hash', async () => {
  const ipcMain = createIpcMainMock();
  const webContents = createWebContentsMock();
  const factory = createFakeEngineFactory();
  const service = register(ipcMain, webContents, factory);
  try {
    await assert.rejects(
      ipcMain.invoke('chess:search', { sender: {}, senderFrame: webContents.mainFrame }, REQUEST('a')),
      /未授权/,
    );
    await assert.rejects(
      ipcMain.invoke('chess:search', { sender: webContents, senderFrame: { url: INDEX_URL } }, REQUEST('a')),
      /未授权/,
    );
    const originalUrl = webContents.mainFrame.url;
    webContents.mainFrame.url = 'https://example.com/';
    await assert.rejects(ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('a')), /未授权/);
    webContents.mainFrame.url = `${originalUrl}#hash`;
    const accepted = ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('a'));
    await waitFor(() => factory.calls.searches.length === 1);
    factory.calls.searches[0].resolve({ requestId: 'a', revision: 0, bestMove: 'e2e4' });
    await accepted;
    webContents.mainFrame.url = originalUrl;

    await assert.rejects(ipcMain.invoke('chess:cancel', { sender: {} }, 'a'), /未授权/);
    await assert.rejects(ipcMain.invoke('chess:dispose', { sender: {} }), /未授权/);
  } finally {
    await service.dispose();
  }
});

test('engine service allows one search and isolates cancel IDs', async () => {
  const ipcMain = createIpcMainMock();
  const webContents = createWebContentsMock();
  const factory = createFakeEngineFactory();
  const service = register(ipcMain, webContents, factory);
  try {
    const first = ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('a'));
    first.catch(() => {});
    await waitFor(() => factory.calls.searches.length === 1);

    await assert.rejects(
      ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('b')),
      /已有搜索/,
    );
    assert.equal(await ipcMain.invoke('chess:cancel', trustedEvent(webContents), 'other'), false);
    assert.equal(factory.calls.searches[0].signal.aborted, false);

    assert.equal(await ipcMain.invoke('chess:cancel', trustedEvent(webContents), 'a'), true);
    await assert.rejects(first, (error) => error.name === 'AbortError');

    const second = ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('b'));
    await waitFor(() => factory.calls.searches.length === 2);
    factory.calls.searches[1].resolve({ requestId: 'b', revision: 0, bestMove: 'e7e5' });
    assert.deepEqual(await second, { requestId: 'b', revision: 0, bestMove: 'e7e5' });
  } finally {
    await service.dispose();
  }
});

test('chess:dispose blocks new searches until release and then creates a new instance', async () => {
  const ipcMain = createIpcMainMock();
  const webContents = createWebContentsMock();
  const disposeGate = deferred();
  const factory = createFakeEngineFactory({ disposeGate });
  const service = register(ipcMain, webContents, factory);
  try {
    const first = ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('a'));
    await waitFor(() => factory.calls.searches.length === 1);
    factory.calls.searches[0].resolve({ requestId: 'a', revision: 0, bestMove: 'e2e4' });
    await first;
    assert.equal(factory.calls.created, 1);

    const disposing = ipcMain.invoke('chess:dispose', trustedEvent(webContents));
    await waitFor(() => factory.calls.disposed === 1);

    const second = ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('b'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(factory.calls.searches.length, 1, '释放完成前不得创建新实例');

    disposeGate.resolve();
    await disposing;
    await waitFor(() => factory.calls.searches.length === 2);
    assert.equal(factory.calls.created, 2);
    factory.calls.searches[1].resolve({ requestId: 'b', revision: 0, bestMove: 'e7e5' });
    await second;
  } finally {
    await service.dispose().catch(() => {});
  }
});

test('an adapter release failure rejects later searches with a clear error', async () => {
  const ipcMain = createIpcMainMock();
  const webContents = createWebContentsMock();
  const factory = createFakeEngineFactory({ failDispose: true });
  const service = register(ipcMain, webContents, factory);
  const first = ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('a'));
  await waitFor(() => factory.calls.searches.length === 1);
  factory.calls.searches[0].resolve({ requestId: 'a', revision: 0, bestMove: 'e2e4' });
  await first;

  await assert.rejects(ipcMain.invoke('chess:dispose', trustedEvent(webContents)), /dispose failed/);
  await assert.rejects(
    ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('b')),
    /释放失败/,
  );
  await assert.rejects(service.dispose(), /dispose failed/);
});

test('service dispose removes the handlers and is idempotent', async () => {
  const ipcMain = createIpcMainMock();
  const webContents = createWebContentsMock();
  const factory = createFakeEngineFactory();
  const service = register(ipcMain, webContents, factory);

  const first = service.dispose();
  const second = service.dispose();
  assert.equal(first, second);
  await first;
  assert.equal(factory.calls.disposed, 0, '没有实例时 dispose 不创建适配器');
  await assert.rejects(ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('a')), /没有注册/);
  await service.dispose();
});

test('dispose during asynchronous engine creation cancels and releases that instance', async () => {
  const ipcMain = createIpcMainMock();
  const webContents = createWebContentsMock();
  const gate = deferred();
  const factory = createFakeEngineFactory();
  let creating = false;
  const service = registerEngineService({ ipcMain, webContents, indexUrl: INDEX_URL,
    createEngine: async () => { creating = true; return gate.promise; },
  });
  const search = ipcMain.invoke('chess:search', trustedEvent(webContents), REQUEST('startup'));
  search.catch(() => {});
  await waitFor(() => creating);
  const disposal = service.dispose();
  gate.resolve(factory.createEngine());
  // Old implementations would leave this request running after service shutdown.
  await waitFor(() => factory.calls.searches.length === 1);
  factory.calls.searches[0].resolve({ requestId: 'startup', revision: 0, bestMove: 'e2e4' });
  await disposal;
  await assert.rejects(search, { name: 'AbortError' });
  assert.equal(factory.calls.disposed, 1);
});
