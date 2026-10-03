/**
 * Native Stockfish line transport (Node-only).
 *
 * This is the lowest-level communication layer only: send one UCI line, receive
 * one UCI line, report terminal errors once, and release the process. It never
 * sends uci/isready/go by itself, never interprets bestmove and is not imported
 * by any browser entry point. Electron main/preload wiring comes later; this raw
 * interface must not be exposed to the renderer.
 *
 * @typedef {import('./contract.js').EngineLineTransport} EngineLineTransport
 */
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

const MAX_STDERR_BYTES = 8 * 1024;
const QUIT_TIMEOUT_MS = 1000;
const KILL_TIMEOUT_MS = 1000;

/**
 * @param {{ executablePath: string, args?: string[], onLine: (line: string) => void, onError: (error: Error) => void }} options
 * @returns {EngineLineTransport}
 */
export function createNativeTransport({ executablePath, args = [], onLine, onError } = {}) {
  if (typeof executablePath !== 'string' || executablePath.trim() === '' || !isAbsolute(executablePath)) {
    throw new TypeError('executablePath 必须是绝对路径字符串');
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('args 必须是字符串数组');
  }
  if (typeof onLine !== 'function') throw new TypeError('onLine 必须是函数');
  if (typeof onError !== 'function') throw new TypeError('onError 必须是函数');

  const child = spawn(executablePath, args, {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let phase = 'running'; // running | failed | disposed
  let disposePromise = null;
  let closed = false;
  let stdoutBuffer = '';
  const stderrChunks = [];
  let stderrBytes = 0;
  const closeWaiters = [];

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk) => {
    if (phase !== 'running') return;
    stdoutBuffer += chunk;
    let index;
    while ((index = stdoutBuffer.indexOf('\n')) >= 0) {
      const raw = stdoutBuffer.slice(0, index);
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      deliver(raw.replace(/\r$/, ''));
    }
  });

  child.stderr.on('data', (chunk) => {
    // Diagnostics only, never protocol output. Keep the most recent 8 KiB.
    const buffer = Buffer.from(chunk, 'utf8');
    stderrChunks.push(buffer);
    stderrBytes += buffer.length;
    while (stderrBytes > MAX_STDERR_BYTES && stderrChunks.length > 0) {
      const first = stderrChunks[0];
      const excess = stderrBytes - MAX_STDERR_BYTES;
      if (first.length <= excess) {
        stderrBytes -= first.length;
        stderrChunks.shift();
      } else {
        stderrChunks[0] = first.subarray(excess);
        stderrBytes -= excess;
      }
    }
  });

  child.stdin.on('error', (error) => {
    // EPIPE and similar async stream errors must never crash the parent.
    fail(new Error(`stdin 写入失败：${error.message}`));
  });
  child.stdout.on('error', (error) => fail(new Error(`stdout 读取失败：${error.message}`)));
  child.stderr.on('error', (error) => fail(new Error(`stderr 读取失败：${error.message}`)));
  child.on('error', (error) => {
    fail(new Error(`无法启动或运行引擎进程：${error.message}`));
  });
  child.on('close', (code, signal) => {
    closed = true;
    const tail = stdoutBuffer.replace(/\r$/, '');
    stdoutBuffer = '';
    if (phase === 'running') {
      deliver(tail); // final line that arrived without a trailing newline
      fail(new Error(`引擎进程意外退出（code=${code ?? 'null'}, signal=${signal ?? '无'}）`));
    }
    for (const waiter of closeWaiters.splice(0)) waiter();
    cleanupListeners();
  });

  function stderrText() {
    return Buffer.concat(stderrChunks).toString('utf8');
  }

  function deliver(line) {
    if (phase !== 'running') return;
    if (line.trim() === '') return;
    onLine(line);
  }

  function fail(error) {
    if (phase !== 'running') return; // terminal failures are reported at most once
    phase = 'failed';
    const diagnostics = stderrText();
    if (diagnostics) error.stderr = diagnostics;
    onError(error);
  }

  function cleanupListeners() {
    child.stdout.removeAllListeners('data');
    child.stderr.removeAllListeners('data');
    child.removeAllListeners('close');
    child.removeAllListeners('error');
    // The guarded stdin error listener stays attached: a late EPIPE must not
    // become an unhandled 'error' event on the stream.
  }

  function waitForClose(timeoutMs) {
    if (closed) return Promise.resolve(true);
    return new Promise((resolveWait) => {
      let timer = null;
      const waiter = () => {
        if (timer) clearTimeout(timer);
        resolveWait(true);
      };
      closeWaiters.push(waiter);
      timer = setTimeout(() => {
        const index = closeWaiters.indexOf(waiter);
        if (index >= 0) closeWaiters.splice(index, 1);
        resolveWait(false);
      }, timeoutMs);
    });
  }

  function send(line) {
    if (typeof line !== 'string') throw new TypeError('send 只接受字符串');
    if (line === '') throw new TypeError('send 不接受空字符串');
    if (/[\r\n]/.test(line)) throw new TypeError('send 不接受含 CR/LF 的行');
    if (phase !== 'running') {
      throw new Error(phase === 'disposed' ? 'transport 已释放，不能继续发送' : 'transport 已因故障停止，不能继续发送');
    }
    child.stdin.write(`${line}\n`);
  }

  function dispose() {
    if (disposePromise) return disposePromise; // idempotent: same completion result
    phase = 'disposed'; // stop callbacks from this call onward
    disposePromise = (async () => {
      if (closed) return;
      try {
        child.stdin.write('quit\n');
      } catch {
        // A failed spawn may already have destroyed stdin; wait for close instead.
      }
      if (await waitForClose(QUIT_TIMEOUT_MS)) return;
      try {
        child.kill();
      } catch {
        // fall through to the final wait
      }
      if (!(await waitForClose(KILL_TIMEOUT_MS))) {
        throw new Error('无法在超时内释放原生引擎进程');
      }
    })();
    return disposePromise;
  }

  return { send, dispose };
}
