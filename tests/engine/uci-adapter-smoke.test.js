import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { createNativeTransport } from '../../src/engine/native-transport.js';
import { createUciAdapter } from '../../src/engine/uci-adapter.js';

test('shared adapter searches successive positions through the real native Stockfish', { timeout: 30000 }, async () => {
  const manifest = JSON.parse(readFileSync(new URL('../../vendor/stockfish/manifest.json', import.meta.url), 'utf8'));
  const executablePath = fileURLToPath(new URL(`../../${manifest.native.exe}`, import.meta.url));
  assert.ok(existsSync(executablePath), '请先运行 npm run setup:stockfish');
  let instances = 0;
  const adapter = createUciAdapter({ createTransport: (callbacks) => {
    instances += 1;
    return createNativeTransport({ executablePath, ...callbacks });
  } });
  const chess = new Chess();
  const initialFen = chess.fen();
  const moves = ['e2e4'];
  chess.move('e4');
  try {
    for (let revision = 1; revision <= 2; revision += 1) {
      const result = await adapter.search({ requestId: `native-${revision}`, revision, initialFen, moves, skillLevel: 8, moveTimeMs: 100 });
      assert.equal(result.revision, revision);
      const move = result.bestMove;
      chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
      moves.push(move);
    }
    assert.equal(instances, 1);
  } finally { await adapter.dispose(); }
});
