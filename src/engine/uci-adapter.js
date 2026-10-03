import { Chess } from 'chess.js';

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const abortError = () => Object.assign(new Error('搜索已取消'), { name: 'AbortError' });

function parseRequest(input) {
  if (!input || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.requestId)
    || !Number.isSafeInteger(input.revision) || input.revision < 0
    || typeof input.initialFen !== 'string' || input.initialFen.length > 120 || /[\r\n]/.test(input.initialFen)
    || !Array.isArray(input.moves) || input.moves.length > 4096
    || input.moves.some((move) => typeof move !== 'string' || !UCI_MOVE.test(move))
    || !Number.isInteger(input.moveTimeMs) || input.moveTimeMs < 100 || input.moveTimeMs > 5000
    || !Number.isInteger(input.skillLevel) || input.skillLevel < 0 || input.skillLevel > 20) {
    throw new TypeError('引擎请求格式或搜索预算无效');
  }
  const request = Object.freeze({
    requestId: input.requestId, revision: input.revision, initialFen: input.initialFen.trim(),
    moves: Object.freeze([...input.moves]), moveTimeMs: input.moveTimeMs, skillLevel: input.skillLevel,
  });
  const position = new Chess(request.initialFen);
  for (const move of request.moves) {
    position.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  }
  return { request, position };
}

/** One persistent engine; cancellation retires its transport before the next search. */
export function createUciAdapter({ createTransport, handshakeTimeoutMs = 15000, searchGraceMs = 5000 }) {
  if (typeof createTransport !== 'function') throw new TypeError('createTransport 必须是函数');
  if (![handshakeTimeoutMs, searchGraceMs].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError('引擎超时必须是正数');
  }
  let connection = null;
  let active = null;
  let disposed = false;
  let disposal = null;
  let cleanup = Promise.resolve();
  let cleanupError = null;

  function retire(ctx, error) {
    if (!ctx || ctx.closed) return;
    ctx.closed = true;
    ctx.error ??= error;
    ctx.pending?.finish(ctx.error);
    if (connection === ctx) connection = null;
    cleanup = cleanup.then(() => ctx.transport?.dispose()).catch((failure) => { cleanupError ??= failure; });
  }

  function connect() {
    const ctx = { transport: null, pending: null, ready: false, closed: false, error: null, name: '' };
    connection = ctx;
    try {
      ctx.transport = createTransport({
        onLine(line) {
          if (connection !== ctx || ctx.closed) return;
          if (line.startsWith('id name ')) ctx.name = line.slice(8);
          if (ctx.pending?.matches(line)) ctx.pending.finish(null, line);
        },
        onError(error) {
          if (ctx.closed) return;
          ctx.error = error instanceof Error ? error : new Error(String(error));
          ctx.pending?.finish(ctx.error);
          if (ctx.transport) retire(ctx, ctx.error);
        },
      });
      if (ctx.error) throw ctx.error;
      return ctx;
    } catch (error) {
      retire(ctx, error);
      throw error;
    }
  }

  function exchange(ctx, command, matches, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (ctx.error || ctx.closed) { reject(ctx.error ?? abortError()); return; }
      const pending = {
        matches,
        finish(error, line) {
          if (ctx.pending !== pending) return;
          clearTimeout(timer);
          ctx.pending = null;
          if (error) reject(error); else resolve(line);
        },
      };
      const timer = setTimeout(() => pending.finish(new Error(`引擎响应超时：${command.split(' ')[0]}`)), timeoutMs);
      ctx.pending = pending; // register before send, including synchronous test transports
      try { ctx.transport.send(command); } catch (error) { pending.finish(error); }
    });
  }

  async function search(input, { signal } = {}) {
    const { request, position } = parseRequest(input);
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('signal 必须是 AbortSignal');
    }
    if (disposed) throw new Error('引擎已释放');
    if (active) throw new Error('已有搜索正在执行');
    const operation = { ctx: null, error: signal?.aborted ? abortError() : null };
    active = operation;
    const cancel = () => {
      operation.error ??= abortError();
      retire(operation.ctx, operation.error);
    };
    const check = () => {
      if (disposed || operation.error) throw operation.error ?? abortError();
      if (operation.ctx?.error) throw operation.ctx.error;
      if (cleanupError) throw cleanupError;
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      check();
      await cleanup;
      check();
      const ctx = connection ?? connect();
      operation.ctx = ctx;
      if (!ctx.ready) {
        await exchange(ctx, 'uci', (line) => line === 'uciok', handshakeTimeoutMs);
        check();
        if (!/\bStockfish\b/i.test(ctx.name)) throw new Error('引擎未确认为 Stockfish');
        ctx.transport.send('setoption name Threads value 1');
        ctx.transport.send('setoption name Hash value 16');
        ctx.transport.send('ucinewgame');
        ctx.ready = true;
      }
      ctx.transport.send(`setoption name Skill Level value ${request.skillLevel}`);
      await exchange(ctx, 'isready', (line) => line === 'readyok', handshakeTimeoutMs);
      check();
      ctx.transport.send(`position fen ${request.initialFen}${request.moves.length ? ` moves ${request.moves.join(' ')}` : ''}`);
      const line = await exchange(ctx, `go movetime ${request.moveTimeMs}`, (value) => /^bestmove\s/.test(value), request.moveTimeMs + searchGraceMs);
      check();
      const move = line.trim().split(/\s+/)[1];
      let bestMove = null;
      if (move === '(none)' || move === '0000') {
        if (position.moves().length) throw new Error('非终局收到空着法');
      } else {
        if (!UCI_MOVE.test(move ?? '')) throw new Error('引擎返回的着法格式无效');
        position.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
        bestMove = move;
      }
      return Object.freeze({ requestId: request.requestId, revision: request.revision, bestMove });
    } catch (error) {
      retire(operation.ctx, error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (active === operation) active = null;
    }
  }

  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    if (active) active.error ??= abortError();
    retire(connection, active?.error ?? new Error('引擎已释放'));
    disposal = cleanup.then(() => { if (cleanupError) throw cleanupError; });
    return disposal;
  }
  return { search, dispose };
}
