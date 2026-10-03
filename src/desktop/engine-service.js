/**
 * Main-process engine service for the sandboxed renderer bridge.
 *
 * Exposes exactly three IPC handlers (`chess:search`, `chess:cancel`,
 * `chess:dispose`). Every call is checked against the owning webContents,
 * its main frame and the loaded index URL. The renderer cannot supply an
 * engine path, args or raw UCI; the fixed adapter comes from `createEngine`.
 * Electron is injected so the service can be unit-tested without launching it.
 */

const CHANNEL_SEARCH = 'chess:search';
const CHANNEL_CANCEL = 'chess:cancel';
const CHANNEL_DISPOSE = 'chess:dispose';

export function registerEngineService({ ipcMain, webContents, indexUrl, createEngine }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('registerEngineService 需要 ipcMain');
  }
  if (!webContents || typeof webContents !== 'object') throw new TypeError('registerEngineService 需要 webContents');
  if (typeof indexUrl !== 'string' || indexUrl === '') throw new TypeError('indexUrl 必须是非空字符串');
  if (typeof createEngine !== 'function') throw new TypeError('createEngine 必须是函数');

  let engine = null;
  let activeSearch = null;
  let cleanupBarrier = Promise.resolve();
  let adapterDisposal = null;
  let releaseFailure = null;
  let stopped = false;
  let serviceDisposal = null;

  function isTrusted(event) {
    if (!event || event.sender !== webContents) return false;
    let frame;
    try {
      frame = event.senderFrame;
    } catch {
      return false; // the frame was destroyed
    }
    if (!frame || frame !== webContents.mainFrame) return false;
    const url = typeof frame.url === 'string' ? frame.url.split('#')[0] : '';
    return url === indexUrl;
  }

  function assertTrusted(event) {
    if (!isTrusted(event)) throw new Error('拒绝未授权的引擎请求');
  }

  function assertAvailable() {
    if (stopped) throw new Error('引擎服务已停止');
    if (releaseFailure) throw new Error(`引擎释放失败，无法开始新搜索：${releaseFailure.message}`);
    if (activeSearch) throw new Error('已有搜索正在进行');
  }

  async function getEngine() {
    if (engine) return engine;
    const created = await createEngine();
    if (!created || typeof created.search !== 'function' || typeof created.dispose !== 'function') {
      throw new TypeError('createEngine 返回的引擎适配器无效');
    }
    engine = created;
    return engine;
  }

  /** Cancels the current search, releases the adapter and clears the instance. */
  function releaseAdapter() {
    if (adapterDisposal) return adapterDisposal;
    if (!engine && !activeSearch) {
      if (releaseFailure) return Promise.reject(releaseFailure);
      return Promise.resolve();
    }
    const searchSettled = activeSearch?.promise?.catch(() => {}) ?? Promise.resolve();
    activeSearch?.controller?.abort();
    const releasing = (async () => {
      try {
        await searchSettled;
        // The factory may still be pending when release is requested. Wait for
        // its cancelled search before collecting the newly created instance.
        const instance = engine;
        engine = null;
        await instance?.dispose();
      } catch (error) {
        releaseFailure = error instanceof Error ? error : new Error(String(error));
        throw releaseFailure;
      } finally {
        adapterDisposal = null;
      }
    })();
    adapterDisposal = releasing;
    cleanupBarrier = releasing.catch(() => {});
    return releasing;
  }

  async function handleSearch(event, request) {
    assertTrusted(event);
    assertAvailable();
    await cleanupBarrier;
    assertAvailable();
    const controller = new AbortController();
    const operation = { requestId: request?.requestId, controller, promise: null };
    activeSearch = operation;
    operation.promise = (async () => {
      try {
        const instance = await getEngine();
        return await instance.search(request, { signal: controller.signal });
      } finally {
        if (activeSearch === operation) activeSearch = null;
      }
    })();
    return operation.promise;
  }

  async function handleCancel(event, requestId) {
    assertTrusted(event);
    const operation = activeSearch;
    if (!operation || operation.requestId !== requestId) return false;
    operation.controller.abort();
    await operation.promise.catch(() => {}); // cancellation errors are swallowed
    return true;
  }

  async function handleDispose(event) {
    assertTrusted(event);
    await releaseAdapter();
    return true;
  }

  ipcMain.handle(CHANNEL_SEARCH, handleSearch);
  ipcMain.handle(CHANNEL_CANCEL, handleCancel);
  ipcMain.handle(CHANNEL_DISPOSE, handleDispose);

  function dispose() {
    if (serviceDisposal) return serviceDisposal;
    stopped = true;
    ipcMain.removeHandler(CHANNEL_SEARCH);
    ipcMain.removeHandler(CHANNEL_CANCEL);
    ipcMain.removeHandler(CHANNEL_DISPOSE);
    serviceDisposal = (async () => {
      await releaseAdapter();
      await cleanupBarrier;
    })();
    serviceDisposal.catch((error) => {
      console.error(`[engine-service] 释放原生引擎失败：${error.message}`);
    });
    return serviceDisposal;
  }

  return { dispose };
}
