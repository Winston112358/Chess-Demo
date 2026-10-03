/**
 * Browser Stockfish line transport (browser-only, classic Worker).
 *
 * Lowest-level communication only: send one UCI line, receive one UCI line,
 * report terminal errors once, and terminate the Worker. The caller supplies
 * the worker URL; the pinned engine keeps its original file name so the WASM
 * stays adjacent. This module must not import Node APIs and does not change
 * the production page or its CSP.
 *
 * @typedef {import('./contract.js').EngineLineTransport} EngineLineTransport
 */

/**
 * @param {{ workerUrl: string | URL, onLine: (line: string) => void, onError: (error: Error) => void }} options
 * @returns {EngineLineTransport}
 */
export function createWorkerTransport({ workerUrl, onLine, onError } = {}) {
  if (typeof workerUrl !== 'string' && !(workerUrl instanceof URL)) {
    throw new TypeError('workerUrl 必须是 string 或 URL');
  }
  const url = workerUrl instanceof URL ? workerUrl.href : workerUrl;
  if (url.trim() === '') throw new TypeError('workerUrl 不能为空');
  if (typeof onLine !== 'function') throw new TypeError('onLine 必须是函数');
  if (typeof onError !== 'function') throw new TypeError('onError 必须是函数');

  let phase = 'running'; // running | failed | disposed
  let worker = null;
  let disposePromise = null;

  try {
    worker = new Worker(url);
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
  }

  if (worker) {
    worker.onmessage = (event) => {
      if (phase !== 'running') return;
      const { data } = event;
      if (typeof data !== 'string' || data === '') return;
      for (const part of data.split('\n')) {
        if (phase !== 'running') break;
        const line = part.replace(/\r$/, '');
        if (line.trim() !== '') onLine(line); // no-newline messages are delivered whole
      }
    };
    worker.onerror = (event) => {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const detail = event && event.message ? `：${event.message}` : '';
      fail(new Error(`Worker 运行错误${detail}`));
    };
    worker.onmessageerror = () => {
      fail(new Error('Worker 消息反序列化失败（messageerror）'));
    };
  }

  function fail(error) {
    if (phase !== 'running') return; // terminal failures are reported at most once
    phase = 'failed';
    onError(error);
  }

  function send(line) {
    if (typeof line !== 'string') throw new TypeError('send 只接受字符串');
    if (line === '') throw new TypeError('send 不接受空字符串');
    if (/[\r\n]/.test(line)) throw new TypeError('send 不接受含 CR/LF 的行');
    if (phase !== 'running') {
      throw new Error(phase === 'disposed' ? 'transport 已释放，不能继续发送' : 'transport 已因故障停止，不能继续发送');
    }
    try {
      worker.postMessage(line);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  function dispose() {
    if (disposePromise) return disposePromise; // idempotent: same completion result
    phase = 'disposed'; // stop callbacks from this call onward
    try {
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
        worker = null;
      }
      disposePromise = Promise.resolve();
    } catch (error) {
      disposePromise = Promise.reject(error);
    }
    return disposePromise;
  }

  return { send, dispose };
}
