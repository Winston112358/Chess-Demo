import { createUciAdapter } from '../engine/uci-adapter.js';
import { createWorkerTransport } from '../engine/worker-transport.js';
import { createDesktopAdapter } from '../engine/desktop-adapter.js';

/**
 * Creates the engine used by the page. When the sandboxed desktop bridge is
 * present it must be used; a broken bridge is an error and never silently
 * falls back to the browser WASM engine. Plain browsers always use the pinned
 * lite single-threaded Worker with its original file name.
 */
export function createAppEngine() {
  const bridge = typeof window === 'undefined' ? undefined : window.chessEngine;
  if (bridge !== undefined) {
    if (!bridge || bridge.protocolVersion !== 1) {
      throw new Error('桌面引擎接口版本不匹配（需要 protocolVersion=1）');
    }
    return createDesktopAdapter(bridge);
  }
  return createUciAdapter({
    createTransport: ({ onLine, onError }) => createWorkerTransport({
      workerUrl: new URL('./engines/stockfish/stockfish-19-lite-single.js', document.baseURI),
      onLine,
      onError,
    }),
  });
}
