import { test, expect, chromium } from '@playwright/test';
import { expectInvalidFenPreservesGame, expectPieceImages } from './piece-assets.js';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

test('web ZIP runs from an isolated HTTP subdirectory with matching engine sources', async () => {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const temporaryRoot = resolve(tmpdir());
  const isolated = await mkdtemp(join(temporaryRoot, 'Chess Web smoke '));
  const site = join(isolated, 'site');
  let browser;
  let server;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${literal(join(projectRoot, 'release', `Chess-Web-${version}.zip`))} -DestinationPath ${literal(site)}`,
    ], { windowsHide: true, timeout: 30000 });
    const manifest = JSON.parse(await readFile(join(site, 'third-party/stockfish/manifest.json'), 'utf8'));
    for (const file of manifest.files) {
      let deployed;
      if (file.role === 'web-js' || file.role === 'web-wasm') deployed = join(site, 'engines/stockfish', basename(file.path));
      else if (file.role === 'web-license') deployed = join(site, 'third-party/stockfish/web', basename(file.path));
      else if (file.role === 'source-archive') deployed = join(site, 'third-party/stockfish/source', basename(file.path));
      else continue;
      const bytes = await readFile(deployed);
      expect(bytes.length).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    const requests = [];
    const prefix = '/chess-demo/';
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.wasm': 'application/wasm' };
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
        const target = resolve(site, pathname.slice(prefix.length) || 'index.html');
        if (!target.startsWith(`${site}${sep}`)) { response.writeHead(403).end(); return; }
        const content = await readFile(target);
        requests.push(pathname);
        response.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream' });
        response.end(content);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    const readme = await readFile(join(site, 'README.txt'), 'utf8');
    expect(readme).not.toContain('素材尚未接入');
    expect(readme).toContain('翻转棋盘');
    browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage();
    const errors = [];
    const externals = [];
    const origin = `http://127.0.0.1:${server.address().port}`;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (!request.url().startsWith(origin)) externals.push(request.url());
    });
    await page.goto(`${origin}${prefix}`);
    await expect(page.locator('#board .piece')).toHaveCount(32);
    await expectPieceImages(page);
    await page.getByRole('button', { name: '翻转棋盘' }).click();
    await expect(page.locator('[data-square="e1"] .piece')).toHaveAttribute('data-view', 'front');
    await expect(page.locator('[data-square="e8"] .piece')).toHaveAttribute('data-view', 'rear');
    await expectPieceImages(page, { flipped: true });
    await page.getByRole('button', { name: '翻转棋盘' }).click();
    await expectPieceImages(page);
    await expectInvalidFenPreservesGame(page);
    expect(await page.evaluate(() => typeof window.chessEngine)).toBe('undefined');
    await page.selectOption('#difficulty', 'easy');
    await page.selectOption('#game-mode', 'computer');
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.locator('#move-list .move-san:not(.move-san--empty)')).toHaveCount(2, { timeout: 30000 });
    await expect(page.locator('#turn')).toHaveText('白方走棋');
    await expect(page.locator('#engine-status')).toHaveText('');
    expect(requests).toContain(`${prefix}engines/stockfish/stockfish-19-lite-single.wasm`);
    expect(requests.some((pathname) => pathname.startsWith(`${prefix}pieces/staunton-v3/`) && pathname.endsWith('.png'))).toBe(true);
    expect(requests.some((pathname) => pathname.startsWith(`${prefix}pieces/staunton-v3/`) && pathname.includes('wn-rear'))).toBe(true);
    expect(externals).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/web-release.png', fullPage: true });
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
    const target = resolve(isolated);
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith('Chess Web smoke ')) {
      throw new Error('拒绝清理网页发行测试目录之外的路径');
    }
    await rm(target, { recursive: true, force: true });
  }
});
