#!/usr/bin/env node
/**
 * Verifies the resources installed by scripts/setup-stockfish.js:
 * - manifest and every installed file (size + SHA-256)
 * - WASM magic/version and JS/WASM adjacency
 * - cached download archives when present
 * - a real native UCI smoke test: uci→uciok, isready→readyok,
 *   position startpos moves e2e4 + go, then a legal bestmove
 * - the same smoke test for the web engine through the official Node CLI
 *   (the Emscripten build is CommonJS, so it runs in a temporary CJS sandbox)
 *
 * Small budgets, hard timeouts, windowsHide and process cleanup are used.
 * This only checks resources; no browser Worker or production CSP change.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { validateManifest, verifyFile } from './setup-stockfish.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_PREFIX = '[check]';
const SEARCH_MOVETIME_MS = 600;
const NATIVE_TIMEOUT_MS = 60_000;
const WEB_TIMEOUT_MS = 90_000;
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const WASM_VERSION = 1;

function suffix() {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function removeOwnedTempDir(dir, cacheDir) {
  const resolved = resolve(dir);
  const cacheRoot = resolve(cacheDir);
  const inside = dirname(resolved) === cacheRoot;
  const owned = basename(resolved).startsWith('tmp-web-smoke-');
  if (!inside || !owned) {
    console.warn(`${LOG_PREFIX} 跳过非本工具临时目录清理：${resolved}`);
    return;
  }
  rmSync(resolved, { recursive: true, force: true });
}

/** Minimal line-based UCI process wrapper. */
function createUciSession({ command, args = [], cwd, label, defaultTimeoutMs }) {
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { idName: null, idAuthor: null, stderr: '', exited: false, exit: null, lines: [] };
  const waiters = [];
  let buffer = '';
  let spawnError = null;

  const exitPromise = new Promise((resolveExit) => {
    child.on('close', (code, signal) => {
      state.exited = true;
      state.exit = { code, signal };
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`${label} 进程提前退出（code=${code}, signal=${signal ?? '无'}）：${describeRecentOutput()}`));
      }
      resolveExit(state.exit);
    });
  });

  function describeRecentOutput() {
    const tail = state.lines.slice(-8).join(' | ') || '无输出';
    const stderr = state.stderr.trim() ? `；stderr：${state.stderr.trim().slice(0, 300)}` : '';
    return `${tail}${stderr}`;
  }

  child.on('error', (error) => {
    spawnError = error;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${label} 无法启动：${error.message}`));
    }
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '').trim();
      buffer = buffer.slice(index + 1);
      if (line) handleLine(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });

  function handleLine(line) {
    state.lines.push(line);
    if (line.startsWith('id name ')) state.idName = line.slice(8).trim();
    if (line.startsWith('id author ')) state.idAuthor = line.slice(10).trim();
    for (let index = 0; index < waiters.length; index += 1) {
      if (waiters[index].test(line)) {
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(line);
        return;
      }
    }
  }

  function waitFor(regex, { timeoutMs = defaultTimeoutMs, description } = {}) {
    return new Promise((resolveWait, rejectWait) => {
      if (spawnError) { rejectWait(new Error(`${label} 无法启动：${spawnError.message}`)); return; }
      if (state.exited) { rejectWait(new Error(`${label} 已退出：${describeRecentOutput()}`)); return; }
      const waiter = { test: (line) => regex.test(line), resolve: resolveWait, reject: rejectWait, timer: null };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        rejectWait(new Error(`${label} 等待 ${description ?? regex} 超时（${timeoutMs}ms）：${describeRecentOutput()}`));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  function send(line) {
    child.stdin.write(`${line}\n`);
  }

  async function stop() {
    if (state.exited) return;
    try { child.stdin.write('quit\n'); } catch { /* ignore */ }
    const timeout = new Promise((resolveTimeout) => setTimeout(() => resolveTimeout('timeout'), 2000));
    const result = await Promise.race([exitPromise, timeout]);
    if (result === 'timeout' && !state.exited) {
      child.kill();
      await Promise.race([exitPromise, new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
    }
  }

  return { state, send, waitFor, stop };
}

function isLegalBestMove(bestMove, moves) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestMove ?? '')) return false;
  const chess = new Chess();
  for (const move of moves) chess.move(move);
  const from = bestMove.slice(0, 2);
  const to = bestMove.slice(2, 4);
  const promotion = bestMove[4];
  return chess.moves({ verbose: true }).some((legal) =>
    legal.from === from && legal.to === to && (legal.promotion ?? undefined) === promotion);
}

async function runUciSmoke({ command, args = [], cwd, label, timeoutMs, useThreadsOptions = false, expectVersion = null }) {
  const session = createUciSession({ command, args, cwd, label, defaultTimeoutMs: timeoutMs });
  const startedAt = Date.now();
  try {
    session.send('uci');
    await session.waitFor(/^uciok$/, { description: 'uciok' });
    if (!session.state.idName || !/stockfish/i.test(session.state.idName)) {
      throw new Error(`${label} 的 id name 未确认为 Stockfish：${session.state.idName ?? '无'}`);
    }
    if (expectVersion && !session.state.idName.includes(expectVersion)) {
      throw new Error(`${label} 版本不符：id name 为“${session.state.idName}”，期望包含 ${expectVersion}`);
    }
    if (useThreadsOptions) {
      // Small memory budget for the CLI check.
      session.send('setoption name Threads value 1');
      session.send('setoption name Hash value 16');
    }
    session.send('isready');
    await session.waitFor(/^readyok$/, { description: 'readyok' });
    session.send('position startpos moves e2e4');
    session.send(`go movetime ${SEARCH_MOVETIME_MS}`);
    const bestLine = await session.waitFor(/^bestmove\s+\S+/, { description: 'bestmove' });
    const bestMove = bestLine.split(/\s+/)[1];
    if (!isLegalBestMove(bestMove, ['e4'])) {
      throw new Error(`${label} 返回的 bestmove 不合法或格式错误：${bestMove}`);
    }
    return { idName: session.state.idName, bestMove, elapsedMs: Date.now() - startedAt };
  } finally {
    await session.stop();
  }
}

function checkWasmFile(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(8);
    readSync(fd, header, 0, 8, 0);
    if (!header.subarray(0, 4).equals(WASM_MAGIC)) {
      return { ok: false, reason: `magic 不是 00 61 73 6d（实际 ${header.subarray(0, 4).toString('hex')}）` };
    }
    if (header.readUInt32LE(4) !== WASM_VERSION) {
      return { ok: false, reason: `WASM version 不是 1（实际 ${header.readUInt32LE(4)}）` };
    }
    return { ok: true };
  } finally {
    closeSync(fd);
  }
}

function prepareWebSandbox({ publicJsPath, cacheDir }) {
  const dir = join(cacheDir, `tmp-web-smoke-${suffix()}`);
  mkdirSync(dir, { recursive: true });
  const jsName = basename(publicJsPath);
  const wasmName = jsName.replace(/\.js$/i, '.wasm');
  copyFileSync(publicJsPath, join(dir, jsName));
  copyFileSync(join(dirname(publicJsPath), wasmName), join(dir, wasmName));
  // The Emscripten engine is CommonJS; this project is ESM, so run it in a
  // tiny sandbox marked as CommonJS instead of modifying the public file.
  writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}\n', 'utf8');
  return { dir, entry: join(dir, jsName) };
}

function parseArgs(argv) {
  const options = { help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/check-stockfish-resources.js\n\n校验清单、资源文件、WASM 头，并对原生与网页引擎做 UCI 冒烟检查。');
    return;
  }

  const manifestPath = join(PROJECT_ROOT, 'vendor', 'stockfish', 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('未找到 vendor/stockfish/manifest.json，请先运行 npm run setup:stockfish');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  const cacheDir = resolve(PROJECT_ROOT, manifest.cacheDir ?? '.cache/stockfish');
  const failures = [];
  const warnings = [];
  console.log(`${LOG_PREFIX} 清单 ${manifestPath}，共 ${manifest.files?.length ?? 0} 个文件`);

  // 1. Installed files listed in the manifest.
  const byRole = new Map();
  for (const file of manifest.files ?? []) {
    const absPath = join(PROJECT_ROOT, file.path);
    const result = await verifyFile(absPath, { bytes: file.bytes, sha256: file.sha256 });
    if (result.ok) {
      byRole.set(file.role, [...(byRole.get(file.role) ?? []), { ...file, absPath }]);
      console.log(`${LOG_PREFIX} 通过 ${file.path}（${formatBytes(file.bytes)}）`);
    } else {
      failures.push(`${file.path}：${result.reason}`);
    }
  }

  // 2. WASM header and JS/WASM adjacency.
  for (const wasm of byRole.get('web-wasm') ?? []) {
    const result = checkWasmFile(wasm.absPath);
    if (result.ok) console.log(`${LOG_PREFIX} WASM 头通过 ${wasm.path}（magic + version 1）`);
    else failures.push(`${wasm.path}：${result.reason}`);
    const jsName = basename(wasm.path).replace(/\.wasm$/i, '.js');
    const js = (byRole.get('web-js') ?? []).find((entry) => basename(entry.path) === jsName);
    if (js && dirname(js.absPath) === dirname(wasm.absPath)) {
      console.log(`${LOG_PREFIX} JS/WASM 同名相邻：${dirname(js.path)}/`);
    } else {
      failures.push(`网页引擎 JS 与 WASM 不同名或不相邻：${wasm.path}`);
    }
  }

  // 3. Cached downloads: verify when present, warn when the cache is absent.
  for (const download of manifest.downloads ?? []) {
    const cachePath = join(cacheDir, download.name);
    if (!existsSync(cachePath)) {
      warnings.push(`缓存 ${download.name} 不存在（可用 npm run setup:stockfish 修复）`);
      continue;
    }
    const spec = download.sha256
      ? { bytes: download.bytes, sha256: download.sha256 }
      : { integrity: download.integrity };
    const result = await verifyFile(cachePath, spec);
    if (result.ok) console.log(`${LOG_PREFIX} 缓存通过 ${download.name}`);
    else failures.push(`缓存 ${download.name}：${result.reason}`);
  }

  // Never execute an engine or prepare its sandbox if resource verification failed.
  if (failures.length > 0) {
    throw new Error(`资源校验失败，未启动引擎：\n${failures.join('\n')}`);
  }

  // 4. Native engine UCI smoke test.
  const nativeExe = byRole.get('native-exe')?.[0];
  if (!nativeExe) {
    failures.push('清单缺少 native-exe 记录');
  } else {
    const expectedVersion = manifest.native?.buildVersion ?? null;
    const smoke = await runUciSmoke({
      command: nativeExe.absPath,
      cwd: dirname(nativeExe.absPath),
      label: '原生 Stockfish',
      timeoutMs: NATIVE_TIMEOUT_MS,
      useThreadsOptions: true,
      expectVersion: expectedVersion,
    });
    console.log(`${LOG_PREFIX} 原生 UCI：${smoke.idName}，bestmove ${smoke.bestMove}（${smoke.elapsedMs}ms）`);
    if (!/windows-x86-64-universal/i.test(nativeExe.path)) {
      failures.push(`原生 EXE 名称未确认是 Windows x86-64 universal：${nativeExe.path}`);
    }
  }

  // 5. Web engine UCI smoke test through the official Node CLI (CJS sandbox).
  const webJs = byRole.get('web-js')?.[0];
  if (!webJs) {
    failures.push('清单缺少 web-js 记录');
  } else {
    const sandbox = prepareWebSandbox({ publicJsPath: webJs.absPath, cacheDir });
    try {
      const smoke = await runUciSmoke({
        command: process.execPath,
        args: [sandbox.entry],
        cwd: sandbox.dir,
        label: '网页 Stockfish（Node CLI）',
        timeoutMs: WEB_TIMEOUT_MS,
      });
      console.log(`${LOG_PREFIX} 网页 UCI（Node CLI）：${smoke.idName}，bestmove ${smoke.bestMove}（${smoke.elapsedMs}ms）`);
    } finally {
      removeOwnedTempDir(sandbox.dir, cacheDir);
    }
  }

  for (const warning of warnings) console.warn(`${LOG_PREFIX} 警告：${warning}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`${LOG_PREFIX} 失败：${failure}`);
    throw new Error(`检查未通过，共 ${failures.length} 项失败`);
  }
  console.log(`${LOG_PREFIX} 检查通过：清单、文件哈希、WASM 头、原生与网页 UCI 冒烟均正常`);
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} 错误：${error.message}`);
  process.exitCode = 1;
});
