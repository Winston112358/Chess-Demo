/**
 * Browser-only adapter for the sandboxed Electron bridge (`window.chessEngine`).
 *
 * It forwards a validated request to the main-process engine service, maps an
 * AbortSignal to `cancel(requestId)`, and makes sure a late IPC result can
 * never resolve an aborted search. A cancel barrier makes the next search wait
 * for the cancel acknowledgement. It never touches Electron/Node directly and
 * never exposes raw UCI to the page.
 */

const abortError = () => Object.assign(new Error('搜索已取消'), { name: 'AbortError' });

export function createDesktopAdapter(api) {
  if (!api || api.protocolVersion !== 1) {
    throw new Error('桌面引擎接口版本不匹配（需要 protocolVersion=1）');
  }
  if (typeof api.search !== 'function' || typeof api.cancel !== 'function' || typeof api.dispose !== 'function') {
    throw new TypeError('桌面引擎接口缺少 search/cancel/dispose');
  }

  let disposed = false;
  let disposePromise = null;
  let cancelBarrier = Promise.resolve();
  let cancelFailure = null;
  let active = null;

  async function search(request, options = {}) {
    const { signal } = options;
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('signal 必须是 AbortSignal');
    }
    if (disposed) throw abortError();
    if (active) throw new Error('已有搜索正在执行');
    if (!request || typeof request !== 'object' || typeof request.requestId !== 'string' || request.requestId === '') {
      throw new TypeError('引擎请求缺少 requestId');
    }
    if (signal?.aborted) throw abortError();
    // Reserve the slot before any await, including while cancellation is pending.
    const operation = { requestId: request.requestId, cancel: null };
    active = operation;
    return new Promise((resolve, reject) => {
      let settled = false;
      let ack = null;
      let sent = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        if (active === operation) active = null;
        if (error) reject(error);
        else resolve(result);
      };
      function onAbort() {
        if (!settled) {
          if (sent) {
            ack = Promise.resolve()
              .then(() => api.cancel(operation.requestId))
              .catch((error) => {
                cancelFailure = error instanceof Error ? error : new Error(String(error));
              })
              .finally(() => {
                if (cancelBarrier === ack) cancelBarrier = Promise.resolve();
              });
            cancelBarrier = ack;
          }
          finish(abortError());
        }
        return ack;
      }
      operation.cancel = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
      // Install the abort listener before waiting, so queued searches cancel
      // immediately. Check again at dispatch; a cancelled request never enters IPC.
      (async () => {
        await cancelBarrier;
        await Promise.resolve();
        if (settled) return;
        if (disposed || signal?.aborted) throw abortError();
        if (cancelFailure) throw new Error(`引擎取消失败，无法开始新搜索：${cancelFailure.message}`);
        sent = true;
        return await api.search(request);
      })().then(
          (result) => finish(null, result),
          (error) => finish(error instanceof Error ? error : new Error(String(error))),
        );
    });
  }

  function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;
    const ack = active?.cancel ? active.cancel() : Promise.resolve();
    disposePromise = (async () => {
      await ack;
      await cancelBarrier;
      await api.dispose();
      if (cancelFailure) throw cancelFailure;
    })();
    return disposePromise;
  }

  return { search, dispose };
}
