import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeTransport } from '../../src/engine/native-transport.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-engine.cjs', import.meta.url));

function createHarness({ mode = null, executablePath = process.execPath, args } = {}) {
  const spawnArgs = args ?? [FIXTURE, ...(mode ? [mode] : [])];
  const lines = [];
  const errors = [];
  const transport = createNativeTransport({
    executablePath,
    args: spawnArgs,
    onLine: (line) => lines.push(line),
    onError: (error) => errors.push(error),
  });
  function waitUntil(predicate, timeoutMs = 8000, description = '条件') {
    return new Promise((resolveWait, rejectWait) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolveWait();
        } else if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          rejectWait(new Error(`等待超时：${description}`));
        }
      }, 10);
    });
  }
  return { transport, lines, errors, waitUntil };
}

test('factory rejects non-absolute paths and invalid callbacks', () => {
  const callbacks = { onLine: () => {}, onError: () => {} };
  assert.throws(() => createNativeTransport({ executablePath: 'stockfish.exe', ...callbacks }), TypeError);
  assert.throws(() => createNativeTransport({ executablePath: '', ...callbacks }), TypeError);
  assert.throws(() => createNativeTransport({ executablePath: FIXTURE, args: [1], ...callbacks }), TypeError);
  assert.throws(() => createNativeTransport({ executablePath: FIXTURE, onLine: 'nope', onError: () => {} }), TypeError);
  assert.throws(() => createNativeTransport({ executablePath: FIXTURE, onLine: () => {}, onError: null }), TypeError);
});

test('stdout delivers CRLF, batched multi-line and split partial lines', { timeout: 20000 }, async () => {
  const { transport, lines, waitUntil } = createHarness();
  try {
    transport.send('uci');
    await waitUntil(() => lines.includes('uciok'), 8000, 'uciok');
    await waitUntil(() => lines.includes('id name Fake Engine'), 2000, 'id name');
    await waitUntil(() => lines.includes('id author transport-tests'), 2000, 'id author');
    assert.equal(lines.some((line) => line.includes('\r')), false, 'CR 必须被去掉');

    transport.send('split');
    await waitUntil(() => lines.includes('part1-part2'), 8000, '半行拼接');
    await waitUntil(() => lines.includes('full-line'), 2000, '一次多行');
  } finally {
    await transport.dispose();
  }
});

test('final non-empty tail without a newline is delivered on close', { timeout: 20000 }, async () => {
  const { transport, lines, errors, waitUntil } = createHarness();
  transport.send('tail-exit');
  await waitUntil(() => lines.includes('tail-no-newline'), 8000, '尾行');
  await waitUntil(() => errors.length === 1, 8000, '意外退出错误');
  assert.match(errors[0].message, /意外退出/);
  await transport.dispose();
  assert.equal(errors.length, 1);
});

test('stderr is diagnostics-only and is attached to terminal errors', { timeout: 20000 }, async () => {
  const first = createHarness();
  try {
    first.transport.send('stderr');
    await first.waitUntil(() => first.lines.includes('after-stderr'), 8000, 'stderr 之后的协议行');
    assert.equal(first.lines.some((line) => line.includes('diagnostic-noise')), false);
    assert.equal(first.errors.length, 0);
  } finally {
    await first.transport.dispose();
  }

  const second = createHarness({ mode: 'stderr-exit' });
  await second.waitUntil(() => second.errors.length === 1, 8000, '带 stderr 的退出');
  await second.transport.dispose();
  assert.equal(second.errors.length, 1);
  assert.match(second.errors[0].stderr ?? '', /boom-diagnostic-line/);
});

test('send only accepts a non-empty single-line string', { timeout: 20000 }, async () => {
  const { transport } = createHarness({ mode: 'ignore-quit' });
  try {
    assert.throws(() => transport.send(''), TypeError);
    assert.throws(() => transport.send('a\nb'), TypeError);
    assert.throws(() => transport.send('a\rb'), TypeError);
    assert.throws(() => transport.send(null), TypeError);
    assert.throws(() => transport.send(42), TypeError);
  } finally {
    await transport.dispose();
  }
});

test('writes racing process exit do not crash the parent and report at most once', { timeout: 20000 }, async () => {
  const { transport, errors, waitUntil } = createHarness({ mode: 'exit-now' });
  // The fixture exits immediately, so some of these writes may land after the
  // pipe is gone (EPIPE). That must never crash the parent process.
  for (let index = 0; index < 50; index += 1) {
    try {
      transport.send(`echo ${index}`);
    } catch {
      break; // transport already reported the terminal failure
    }
  }
  await waitUntil(() => errors.length >= 1, 8000, '退出错误');
  await transport.dispose();
  assert.equal(errors.length, 1);
});

test('spawn failure reports once, blocks sends and still disposes', { timeout: 20000 }, async () => {
  const missing = join(tmpdir(), `chess-missing-engine-${Date.now()}.exe`);
  const { transport, errors, waitUntil } = createHarness({ executablePath: missing, args: [] });
  await waitUntil(() => errors.length >= 1, 8000, '启动错误');
  assert.throws(() => transport.send('uci'), /故障停止/);
  await transport.dispose();
  assert.equal(errors.length, 1);
});

test('unexpected exit reports once and blocks later sends', { timeout: 20000 }, async () => {
  const { transport, errors, waitUntil } = createHarness({ mode: 'exit-now' });
  await waitUntil(() => errors.length === 1, 8000, '意外退出');
  assert.match(errors[0].message, /意外退出/);
  assert.throws(() => transport.send('uci'), /故障停止/);
  await transport.dispose();
  assert.equal(errors.length, 1);
});

test('dispose is idempotent and stops callbacks', { timeout: 20000 }, async () => {
  const { transport, lines, errors, waitUntil } = createHarness({ mode: 'late' });
  try {
    await waitUntil(() => lines.includes('tick:1'), 8000, 'late 输出');
    const first = transport.dispose();
    const second = transport.dispose();
    assert.equal(first, second, '多次 dispose 必须返回同一完成结果');
    await first;
    const deliveredBefore = lines.length;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lines.length, deliveredBefore, 'dispose 后不得再发送回调');
    assert.equal(errors.length, 0);
    assert.throws(() => transport.send('uci'), /已释放/);
    await second;
  } finally { await transport.dispose(); }
});

test('dispose kills a process that ignores quit', { timeout: 20000 }, async () => {
  const { transport, lines, waitUntil } = createHarness({ mode: 'ignore-quit' });
  try {
    await waitUntil(() => lines.some((line) => line.startsWith('pid:')), 8000, 'pid 行');
    const pid = Number(lines.find((line) => line.startsWith('pid:')).slice(4));
    assert.ok(Number.isInteger(pid) && pid > 0, '必须拿到子进程 pid');
    await transport.dispose();
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, `不响应 quit 的子进程 ${pid} 必须被强制结束`);
  } finally { await transport.dispose(); }
});
