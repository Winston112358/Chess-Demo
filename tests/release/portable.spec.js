import { test, expect, chromium } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

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

test('portable EXE starts outside the repository and plays offline', async () => {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const temporaryRoot = resolve(tmpdir());
  const isolatedDirectory = await mkdtemp(join(temporaryRoot, 'Chess Demo smoke '));
  const executable = join(isolatedDirectory, 'Chess Demo.exe');
  await copyFile(join(projectRoot, 'release', `Chess-Demo-${version}-x64.exe`), executable);
  const port = await freePort();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    cwd: isolatedDirectory, windowsHide: true, stdio: 'ignore',
  });
  let browser;
  let launchError;
  child.once('error', (error) => { launchError = error; });
  try {
    const deadline = Date.now() + 40000;
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
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('#board .piece')).toHaveCount(32);
    expect(page.url()).toMatch(/^file:/);
    expect(page.url()).not.toContain(projectRoot.replaceAll('\\', '/'));
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#board .piece')).toHaveCount(32);
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.locator('#turn')).toHaveText('黑方走棋');
    await page.getByRole('button', { name: '悔棋' }).click();
    await expect(page.locator('#turn')).toHaveText('白方走棋');
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/portable-board.png' });
    await page.close();
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
