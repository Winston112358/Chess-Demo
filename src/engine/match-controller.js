export const COMPUTER_LEVELS = Object.freeze({
  easy: Object.freeze({ label: '入门', skillLevel: 0, moveTimeMs: 300 }),
  normal: Object.freeze({ label: '普通', skillLevel: 8, moveTimeMs: 700 }),
  hard: Object.freeze({ label: '困难', skillLevel: 16, moveTimeMs: 1500 }),
  expert: Object.freeze({ label: '专家', skillLevel: 20, moveTimeMs: 2500 }),
});

let requestSequence = 0;

/** Owns computer turns; all board changes still go through the supplied GameSession. */
export function createMatchController({ session, createEngine, onChange = () => {} }) {
  if (!session || typeof createEngine !== 'function' || typeof onChange !== 'function') {
    throw new TypeError('对局控制器缺少棋局、引擎工厂或通知函数');
  }
  let settings = { mode: 'local', humanColor: 'w', level: 'normal' };
  let epoch = 0;
  let engine = null;
  let active = null;
  let error = null;
  let paused = false;
  let started = false;
  let disposed = false;
  let disposal = null;
  let queued = false;
  let settling = Promise.resolve();

  const getState = () => Object.freeze({ ...settings, started, thinking: Boolean(active), paused, error });
  const notify = () => { if (!disposed) onChange({ snapshot: session.getSnapshot(), state: getState() }); };
  const computerTurn = () => settings.mode === 'computer' && session.getSnapshot().turn !== settings.humanColor;
  const isCurrent = (operation) => !disposed && active === operation && epoch === operation.epoch
    && session.getSnapshot().revision === operation.request.revision;

  function invalidate() {
    epoch += 1;
    active?.abort.abort();
    active = null;
    error = null;
    paused = false;
  }

  function schedule() {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(async () => {
      queued = false;
      const expectedEpoch = epoch;
      await settling; // a cancelled search must settle before reusing its adapter
      if (disposed || !started || expectedEpoch !== epoch || active || error || paused
        || !computerTurn() || session.getSnapshot().outcome) return;
      startSearch();
    });
  }

  function startSearch() {
    const snapshot = session.getSnapshot();
    const level = COMPUTER_LEVELS[settings.level];
    const operation = {
      epoch, abort: new AbortController(),
      request: {
        requestId: `search-${++requestSequence}`, revision: snapshot.revision,
        initialFen: snapshot.initialFen, moves: snapshot.history.map((move) => move.uci),
        skillLevel: level.skillLevel, moveTimeMs: level.moveTimeMs,
      },
    };
    active = operation;
    notify();
    settling = Promise.resolve().then(() => {
      if (!isCurrent(operation)) return null;
      engine ??= createEngine();
      return engine.search(operation.request, { signal: operation.abort.signal });
    }).then((result) => {
      if (!isCurrent(operation)) return;
      if (!result || result.requestId !== operation.request.requestId || result.revision !== operation.request.revision) {
        throw new Error('引擎结果与当前搜索不匹配');
      }
      const move = result.bestMove;
      if (typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
        throw new Error('引擎未返回可用着法');
      }
      const applied = session.tryMove({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
      if (!applied.ok) throw new Error('引擎返回非法着法');
      active = null;
      notify();
    }).catch((failure) => {
      if (!isCurrent(operation)) return;
      active = null;
      error = failure instanceof Error ? failure.message : String(failure);
      notify();
    }).finally(() => {
      if (active === operation) {
        active = null;
        notify();
        schedule();
      }
    });
  }

  function tryMove(move) {
    if (settings.mode === 'computer' && !started) {
      return { ok: false, code: 'match-not-started', snapshot: session.getSnapshot() };
    }
    if (disposed || computerTurn()) return { ok: false, code: 'computer-turn', snapshot: session.getSnapshot() };
    invalidate();
    const result = session.tryMove(move);
    notify();
    schedule();
    return result;
  }

  function undo() {
    if (disposed) throw new Error('对局已释放');
    invalidate();
    let result = session.undo();
    // Return to the previous human decision, including undo during computer thinking.
    if (started && result.ok && computerTurn() && result.snapshot.canUndo) result = session.undo();
    paused = started && computerTurn();
    notify();
    return result;
  }

  function reset(options) {
    if (disposed) throw new Error('对局已释放');
    // Validate before cancelling: a rejected FEN must preserve the running match.
    const result = session.reset(options);
    invalidate();
    started = false;
    notify();
    return result;
  }

  function claimDraw(reason) {
    if (settings.mode === 'computer' && !started) {
      return { ok: false, code: 'match-not-started', snapshot: session.getSnapshot() };
    }
    if (disposed || computerTurn()) return { ok: false, code: 'computer-turn', snapshot: session.getSnapshot() };
    invalidate();
    const result = session.claimDraw(reason);
    notify();
    schedule();
    return result;
  }

  function configure(update) {
    if (disposed) throw new Error('对局已释放');
    const next = { ...settings, ...update };
    if (!['local', 'computer'].includes(next.mode) || !['w', 'b'].includes(next.humanColor)
      || !Object.hasOwn(COMPUTER_LEVELS, next.level)) throw new TypeError('对局设置无效');
    if (next.mode === settings.mode && next.humanColor === settings.humanColor && next.level === settings.level) {
      return getState();
    }
    invalidate();
    settings = { mode: next.mode, humanColor: next.humanColor, level: next.level };
    started = false;
    notify();
    return getState();
  }

  function start() {
    if (disposed) throw new Error('对局已释放');
    if (settings.mode !== 'computer' || started || session.getSnapshot().outcome) return getState();
    invalidate();
    started = true;
    notify();
    schedule();
    return getState();
  }

  function retry() {
    if (disposed) throw new Error('对局已释放');
    if (!started) return;
    invalidate();
    notify();
    schedule();
  }

  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    invalidate();
    const release = engine?.dispose();
    disposal = Promise.all([settling, release]).then(() => undefined);
    return disposal;
  }

  return {
    getSnapshot: () => session.getSnapshot(), legalMovesFrom: (square) => session.legalMovesFrom(square),
    getState, tryMove, undo, reset, claimDraw, configure, start, retry, dispose,
  };
}
