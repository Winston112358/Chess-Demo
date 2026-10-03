import { test, expect } from '@playwright/test';
import { Chess } from 'chess.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const PROJECT_ROOT_PATH = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PROJECT_ROOT = PROJECT_ROOT_PATH.replace(/\\/g, '/');
const TRANSPORT_URL = `/@fs/${PROJECT_ROOT}/src/engine/worker-transport.js`;
const ADAPTER_URL = `/@fs/${PROJECT_ROOT}/src/engine/uci-adapter.js`;
const ENGINE_DIR = join(PROJECT_ROOT_PATH, 'src', 'web', 'public', 'engines', 'stockfish');

test.beforeAll(() => {
  for (const name of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
    if (!existsSync(join(ENGINE_DIR, name))) {
      throw new Error(`缺少 ${name}，请先运行 npm run setup:stockfish`);
    }
  }
});

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'">
<title>Engine transport fixture</title>
</head>
<body>
<script type="module" src="/engine-fixture.js"></script>
</body>
</html>`;

const FAKE_WORKER_JS = `
self.onmessage = (event) => {
  const command = event.data;
  if (command === 'lines') {
    self.postMessage('alpha\\nbeta\\r\\ngamma');
    self.postMessage('single-no-newline');
  } else if (command === 'late') {
    setInterval(() => self.postMessage('late-message'), 20);
  } else if (command === 'boom') {
    setTimeout(() => { throw new Error('fake-worker-explosion'); }, 0);
  } else if (command === 'echo') {
    self.postMessage('echo:' + command);
  }
};
`;

async function installFixtures(page) {
  await page.route('**/engine-fixture.html', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: FIXTURE_HTML,
  }));
  await page.route('**/engine-fixture.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: `import { createWorkerTransport } from ${JSON.stringify(TRANSPORT_URL)};\nimport { createUciAdapter } from ${JSON.stringify(ADAPTER_URL)};\nwindow.createWorkerTransport = createWorkerTransport;\nwindow.createUciAdapter = createUciAdapter;\n`,
  }));
  await page.route('**/fake-engine-worker.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: FAKE_WORKER_JS,
  }));
}

function isLegalBestMoveAfterE4(bestmove) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestmove ?? '')) return false;
  const chess = new Chess();
  chess.move('e4');
  return chess.moves({ verbose: true }).some((move) =>
    `${move.from}${move.to}${move.promotion ?? ''}` === bestmove);
}

test('real WASM worker completes the UCI handshake and returns a legal bestmove', async ({ page }) => {
  await installFixtures(page);
  const pageErrors = [];
  const failedRequests = [];
  const engineRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`));
  page.on('request', (request) => {
    if (request.url().includes('/engines/stockfish/')) engineRequests.push(request.url());
  });
  await page.goto('/engine-fixture.html');

  const result = await page.evaluate(async () => {
    const lines = [];
    const errors = [];
    const transport = window.createWorkerTransport({
      workerUrl: '/engines/stockfish/stockfish-19-lite-single.js',
      onLine: (line) => lines.push(line),
      onError: (error) => errors.push(String(error?.message ?? error)),
    });
    const waitFor = (predicate, timeoutMs = 45000) => new Promise((resolveWait, rejectWait) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (predicate()) { clearInterval(timer); resolveWait(); return; }
        if (errors.length > 0) { clearInterval(timer); rejectWait(new Error(`transport error: ${errors.join('; ')}`)); return; }
        if (Date.now() - startedAt > timeoutMs) { clearInterval(timer); rejectWait(new Error('timeout waiting for engine output')); }
      }, 20);
    });
    try {
      transport.send('uci');
      await waitFor(() => lines.includes('uciok'));
      transport.send('isready');
      await waitFor(() => lines.includes('readyok'));
      transport.send('position startpos moves e2e4');
      transport.send('go movetime 300');
      await waitFor(() => lines.some((line) => line.startsWith('bestmove')));
      const bestmoveLine = lines.find((line) => line.startsWith('bestmove'));
      let sendAfterDispose = null;
      await transport.dispose();
      try {
        transport.send('isready');
      } catch (error) {
        sendAfterDispose = String(error?.message ?? error);
      }
      return {
        lines,
        errors,
        bestmove: bestmoveLine.split(/\s+/)[1],
        idName: lines.find((line) => line.startsWith('id name ')),
        sendAfterDispose,
      };
    } catch (error) {
      try { await transport.dispose(); } catch { /* already disposed */ }
      throw error;
    }
  });

  expect(result.errors).toEqual([]);
  expect(result.idName).toMatch(/stockfish/i);
  expect(isLegalBestMoveAfterE4(result.bestmove)).toBe(true);
  expect(result.sendAfterDispose).toBeTruthy();
  expect(pageErrors).toEqual([]);
  expect(failedRequests.filter((entry) => entry.includes('/engines/stockfish/'))).toEqual([]);
  expect(engineRequests.some((url) => url.endsWith('stockfish-19-lite-single.js'))).toBe(true);
  expect(engineRequests.some((url) => url.endsWith('stockfish-19-lite-single.wasm'))).toBe(true);
});

test('fake Worker: multiline delivery, one error report and dispose cancellation', async ({ page }) => {
  await installFixtures(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/engine-fixture.html');

  const result = await page.evaluate(async () => {
    const waitFor = (predicate, timeoutMs = 5000) => new Promise((resolveWait, rejectWait) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (predicate()) { clearInterval(timer); resolveWait(); return; }
        if (Date.now() - startedAt > timeoutMs) { clearInterval(timer); rejectWait(new Error('timeout')); }
      }, 10);
    });

    // Instance A: multi-line / no-newline delivery and a single terminal error.
    const linesA = [];
    const errorsA = [];
    const transportA = window.createWorkerTransport({
      workerUrl: '/fake-engine-worker.js',
      onLine: (line) => linesA.push(line),
      onError: (error) => errorsA.push(String(error?.message ?? error)),
    });
    transportA.send('lines');
    await waitFor(() => linesA.includes('gamma') && linesA.includes('single-no-newline'));
    transportA.send('boom');
    await waitFor(() => errorsA.length > 0);
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    const errorsAfterBoom = errorsA.length;
    let sendAfterError = null;
    try {
      transportA.send('lines');
    } catch (error) {
      sendAfterError = String(error?.message ?? error);
    }
    await transportA.dispose();

    // Instance B: dispose stops callbacks and returns the same completion.
    const linesB = [];
    const errorsB = [];
    const transportB = window.createWorkerTransport({
      workerUrl: '/fake-engine-worker.js',
      onLine: (line) => linesB.push(line),
      onError: (error) => errorsB.push(String(error?.message ?? error)),
    });
    transportB.send('late');
    await waitFor(() => linesB.filter((line) => line === 'late-message').length >= 2);
    const beforeDispose = linesB.length;
    const first = transportB.dispose();
    const second = transportB.dispose();
    const samePromise = first === second;
    await first;
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    let sendAfterDispose = null;
    try {
      transportB.send('late');
    } catch (error) {
      sendAfterDispose = String(error?.message ?? error);
    }

    return {
      linesA,
      errorsA,
      errorsAfterBoom,
      sendAfterError,
      samePromise,
      beforeDispose,
      linesAfterDispose: linesB.length,
      sendAfterDispose,
      errorsB,
    };
  });

  expect(result.linesA).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma', 'single-no-newline']));
  expect(result.errorsA).toHaveLength(1);
  expect(result.errorsAfterBoom).toBe(1);
  expect(result.errorsA[0]).toMatch(/fake-worker-explosion|Worker 运行错误/);
  expect(result.sendAfterError).toBeTruthy();
  expect(result.samePromise).toBe(true);
  expect(result.linesAfterDispose).toBe(result.beforeDispose);
  expect(result.sendAfterDispose).toBeTruthy();
  expect(result.errorsB).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('disposing from the first line stops the remainder of the same Worker message', async ({ page }) => {
  await installFixtures(page);
  await page.goto('/engine-fixture.html');
  const lines = await page.evaluate(() => new Promise((resolve, reject) => {
    const delivered = [];
    const timeout = setTimeout(() => reject(new Error('未收到夹具消息')), 5000);
    const transport = window.createWorkerTransport({
      workerUrl: '/fake-engine-worker.js',
      onLine(line) {
        delivered.push(line);
        transport.dispose().then(() => {
          clearTimeout(timeout);
          resolve(delivered);
        }, reject);
      },
      onError(error) { clearTimeout(timeout); reject(error); },
    });
    transport.send('lines');
  }));
  expect(lines).toEqual(['alpha']);
});

test('shared adapter reuses a real browser Worker for successive searches', async ({ page }) => {
  await installFixtures(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/engine-fixture.html');
  const initialFen = new Chess().fen();
  const result = await page.evaluate(async (fen) => {
    let workers = 0;
    const adapter = window.createUciAdapter({ createTransport: (callbacks) => {
      workers += 1;
      return window.createWorkerTransport({ workerUrl: '/engines/stockfish/stockfish-19-lite-single.js', ...callbacks });
    } });
    try {
      const answers = [];
      for (let revision = 1; revision <= 2; revision += 1) {
        answers.push(await adapter.search({ requestId: `web-${revision}`, revision, initialFen: fen, moves: ['e2e4'], skillLevel: 8, moveTimeMs: 100 }));
      }
      return { workers, answers };
    } finally { await adapter.dispose(); }
  }, initialFen);
  expect(result.workers).toBe(1);
  expect(result.answers.map((answer) => answer.requestId)).toEqual(['web-1', 'web-2']);
  expect(result.answers.every((answer) => isLegalBestMoveAfterE4(answer.bestMove))).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('a synchronous Worker send failure reports once and blocks subsequent sends', async ({ page }) => {
  await installFixtures(page);
  await page.goto('/engine-fixture.html');
  const result = await page.evaluate(async () => {
    const RealWorker = window.Worker;
    let terminated = 0;
    window.Worker = class {
      postMessage() { throw new Error('send-failed'); }
      terminate() { terminated += 1; }
    };
    const errors = [];
    try {
      const transport = window.createWorkerTransport({ workerUrl: '/fake.js', onLine() {}, onError: (error) => errors.push(error.message) });
      let first = '';
      let second = '';
      try { transport.send('uci'); } catch (error) { first = error.message; }
      try { transport.send('uci'); } catch (error) { second = error.message; }
      await transport.dispose();
      return { first, second, errors, terminated };
    } finally { window.Worker = RealWorker; }
  });
  expect(result.first).toBe('send-failed');
  expect(result.second).toContain('故障停止');
  expect(result.errors).toEqual(['send-failed']);
  expect(result.terminated).toBe(1);
});
