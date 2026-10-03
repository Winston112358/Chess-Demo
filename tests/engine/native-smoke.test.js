import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { createNativeTransport } from '../../src/engine/native-transport.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = join(PROJECT_ROOT, 'vendor', 'stockfish', 'manifest.json');

function waitUntil(predicate, errors, timeoutMs = 30000) {
  return new Promise((resolveWait, rejectWait) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolveWait();
      } else if (errors.length > 0) {
        clearInterval(timer);
        rejectWait(errors[0]);
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        rejectWait(new Error('等待原生引擎输出超时'));
      }
    }, 20);
  });
}

test('native Stockfish completes uci/isready and returns a legal bestmove', { timeout: 60000 }, async () => {
  assert.ok(existsSync(MANIFEST_PATH), '缺少 vendor/stockfish/manifest.json，请先运行 npm run setup:stockfish');
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const exePath = join(PROJECT_ROOT, manifest.native.exe);
  assert.ok(existsSync(exePath), `缺少原生引擎 ${manifest.native.exe}，请先运行 npm run setup:stockfish`);

  const lines = [];
  const errors = [];
  const transport = createNativeTransport({
    executablePath: exePath,
    onLine: (line) => lines.push(line),
    onError: (error) => errors.push(error),
  });
  try {
    transport.send('uci');
    await waitUntil(() => lines.includes('uciok'), errors);
    assert.ok(lines.some((line) => /^id name .*stockfish/i.test(line)), '缺少 Stockfish id name');

    transport.send('isready');
    await waitUntil(() => lines.includes('readyok'), errors);

    transport.send('position startpos moves e2e4');
    transport.send('go movetime 300');
    await waitUntil(() => lines.some((line) => line.startsWith('bestmove ')), errors);
    const bestmove = lines.find((line) => line.startsWith('bestmove ')).split(/\s+/)[1];

    const chess = new Chess();
    chess.move('e4');
    const legal = chess.moves({ verbose: true }).some((move) =>
      `${move.from}${move.to}${move.promotion ?? ''}` === bestmove);
    assert.equal(legal, true, `bestmove 不合法：${bestmove}`);
    assert.deepEqual(errors, []);
  } finally {
    await transport.dispose();
  }
});
