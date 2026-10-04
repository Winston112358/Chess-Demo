import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK_SCRIPT = join(PROJECT_ROOT, 'scripts', 'check-piece-assets.js');
const REAL_MANIFEST = join(PROJECT_ROOT, 'assets', 'pieces-manifest.json');

function runCheck({ manifest, args = [] } = {}) {
  const cliArgs = [CHECK_SCRIPT];
  if (manifest) cliArgs.push('--manifest', manifest);
  cliArgs.push(...args);
  return spawnSync(process.execPath, cliArgs, {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 180000, windowsHide: true,
  });
}

function withMangledManifest(mutate, fn) {
  const directory = mkdtempSync(join(tmpdir(), 'chess-pieces-fixture-'));
  try {
    const manifest = JSON.parse(readFileSync(REAL_MANIFEST, 'utf8'));
    mutate(manifest);
    const fixturePath = join(directory, 'pieces-manifest.json');
    writeFileSync(fixturePath, JSON.stringify(manifest, null, 2));
    return fn(fixturePath, manifest);
  } finally {
    const resolved = resolve(directory);
    if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('chess-pieces-fixture-')) {
      throw new Error(`拒绝清理非 fixture 目录：${resolved}`);
    }
    rmSync(resolved, { recursive: true, force: true });
  }
}

test('strict mode fails and lists every missing slot in a partial fixture', () => {
  withMangledManifest((manifest) => {
    manifest.pieces.find((piece) => piece.id === 'wn').views.front = null;
  }, (fixture, manifest) => {
    const expected = manifest.pieces.flatMap((piece) => Object.entries(piece.views)
      .filter(([, data]) => data === null).map(([view]) => `${piece.id}/${view}`));
    const result = runCheck({ manifest: fixture });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('严格模式失败');
    expect(output).toContain(`缺少 ${expected.length}/24`);
    for (const slot of expected) expect(output).toContain(slot);
  });
});

test('--allow-partial passes for a draft manifest with valid provided images', () => {
  const result = runCheck({ args: ['--allow-partial'] });
  const manifest = JSON.parse(readFileSync(REAL_MANIFEST, 'utf8'));
  const count = manifest.pieces.reduce((sum, piece) => sum + Object.values(piece.views).filter(Boolean).length, 0);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`素材校验通过：有效 ${count}/24 个视图`);
});

test('a corrupted SHA-256 is rejected even with --allow-partial', () => {
  withMangledManifest((manifest) => {
    const piece = manifest.pieces.find((entry) => entry.id === 'wn');
    piece.views.rear.sha256 = '0'.repeat(64);
  }, (fixture) => {
    const result = runCheck({ manifest: fixture, args: ['--allow-partial'] });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('SHA-256 不符');
  });
});

test('paths outside assets/ are rejected', () => {
  for (const badPath of ['assets/../package.json', 'C:/Windows/win.ini', '/absolute/png.png']) {
    withMangledManifest((manifest) => {
      const piece = manifest.pieces.find((entry) => entry.id === 'wn');
      piece.views.rear.path = badPath;
    }, (fixture) => {
      const result = runCheck({ manifest: fixture, args: ['--allow-partial'] });
      expect(result.status, `应拒绝路径 ${badPath}`).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/path 无效|拒绝|越出/);
    });
  }
});

test('a piece without the front/rear keys is not treated as a normal null slot', () => {
  withMangledManifest((manifest) => {
    delete manifest.pieces.find((entry) => entry.id === 'wk').views.rear;
  }, (fixture) => {
    const result = runCheck({ manifest: fixture, args: ['--allow-partial'] });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('缺少视图键');
  });
});

test('the required alpha>16 check cannot be changed through manifest metadata', () => {
  withMangledManifest((manifest) => {
    manifest.pieces.find((entry) => entry.id === 'wn').views.rear.boundsAlphaThreshold = 255;
  }, (fixture) => {
    const result = runCheck({ manifest: fixture, args: ['--allow-partial'] });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('boundsAlphaThreshold 必须为 16');
  });
});
