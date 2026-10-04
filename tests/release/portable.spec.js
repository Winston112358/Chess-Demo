import { test, expect, chromium } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { expectInvalidFenPreservesGame, expectPieceImages } from './piece-assets.js';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function listEnginePids() {
  const command = "Get-Process -Name 'stockfish-windows-x86-64-universal' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id";
  return new Promise((resolvePromise) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 15000,
    }, (error, stdout) => {
      resolvePromise(String(stdout ?? '')
        .split(/\s+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0));
    });
  });
}

test('portable EXE starts outside the repository, plays offline and releases the engine', async () => {
  test.setTimeout(240000);
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const temporaryRoot = resolve(tmpdir());
  const isolatedDirectory = await mkdtemp(join(temporaryRoot, 'Chess Demo smoke '));
  const executable = join(isolatedDirectory, 'Chess Demo.exe');
  await copyFile(join(projectRoot, 'release', `Chess-Demo-${version}-x64.exe`), executable);
  const baseline = await listEnginePids();
  const port = await freePort();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    cwd: isolatedDirectory, windowsHide: true, stdio: 'ignore',
  });
  let browser;
  let launchError;
  let spawned = [];
  child.once('error', (error) => { launchError = error; });
  try {
    const deadline = Date.now() + 120000;
    while (!browser && Date.now() < deadline) {
      if (launchError) throw launchError;
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
      } catch {
        await delay(200);
      }
    }
    expect(browser, 'portable renderer should expose a live debugging endpoint').toBeTruthy();
    const context = browser.contexts()[0];
    let page = context.pages()[0];
    if (!page) page = await context.waitForEvent('page');
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('file:') && !url.startsWith('devtools:')) externalRequests.push(url);
    });
    await expect(page.locator('#board .piece')).toHaveCount(32);
    await expectPieceImages(page);
    expect(page.url()).toMatch(/^file:/);
    expect(page.url()).not.toContain(projectRoot.replaceAll('\\', '/'));
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#board .piece')).toHaveCount(32);
    await expectPieceImages(page);
    await page.getByRole('button', { name: '翻转棋盘' }).click();
    await expectPieceImages(page, { flipped: true });
    await page.getByRole('button', { name: '翻转棋盘' }).click();
    await expectPieceImages(page);
    await expectInvalidFenPreservesGame(page);
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.locator('#turn')).toHaveText('黑方走棋');
    await page.getByRole('button', { name: '悔棋' }).click();
    await expect(page.locator('#turn')).toHaveText('白方走棋');
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/portable-board.png' });

    // Offline human-vs-computer game through the packaged native engine.
    await page.selectOption('#difficulty', 'expert');
    await page.selectOption('#game-mode', 'computer');
    await expect(page.locator('#turn')).toHaveText('待开始');
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.locator('#move-list .move-san:not(.move-san--empty)')).toHaveCount(0);
    expect((await listEnginePids()).filter((pid) => !baseline.includes(pid))).toEqual([]);
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await page.getByRole('button', { name: '吃子提示：开', exact: true }).click();
    await expect(page.locator('#capture-hints')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.locator('#move-list .move-san:not(.move-san--empty)')).toHaveCount(2, { timeout: 90000 });
    await expect(page.locator('#turn')).toHaveText('白方走棋');
    await expect(page.locator('#engine-status')).toHaveText('');
    spawned = (await listEnginePids()).filter((pid) => !baseline.includes(pid));
    expect(spawned.length, '打包版本应启动原生 Stockfish').toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
    await page.screenshot({ path: 'test-results/portable-computer.png' });

    await page.locator('[data-square="g1"]').click();
    await page.locator('[data-square="f3"]').click();
    await expect(page.locator('#engine-status')).toContainText('电脑思考');

    await page.close();
    await expect.poll(() => child.exitCode, { timeout: 40000 }).not.toBeNull();
    await expect.poll(async () => (await listEnginePids()).filter((pid) => spawned.includes(pid)), {
      timeout: 30000,
    }).toEqual([]);
  } finally {
    await browser?.close();
    if (child.pid && child.exitCode === null) {
      await new Promise((resolve) => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
    }
    const cleanupDirectory = resolve(isolatedDirectory);
    if (dirname(cleanupDirectory) !== temporaryRoot || !basename(cleanupDirectory).startsWith('Chess Demo smoke ')) {
      throw new Error('Refusing cleanup outside the isolated smoke-test directory');
    }
    await rm(cleanupDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
