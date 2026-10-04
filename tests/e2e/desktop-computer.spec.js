import { test, expect, _electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import electronExecutable from 'electron';

function listEnginePids() {
  const command = "Get-Process -Name 'stockfish-windows-x86-64-universal' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id";
  return new Promise((resolvePromise) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 15000,
    }, (error, stdout) => {
      const pids = String(stdout ?? '')
        .split(/\s+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      resolvePromise(pids);
    });
  });
}

test('desktop bridge plays the native engine and releases it on exit', async () => {
  test.setTimeout(120000);
  const baseline = await listEnginePids();
  const desktop = await _electron.launch({
    executablePath: electronExecutable,
    args: [resolve(fileURLToPath(new URL('../../', import.meta.url)))],
  });
  let spawned = [];
  try {
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const bridge = await page.evaluate(() => (window.chessEngine
      ? { protocolVersion: window.chessEngine.protocolVersion, search: typeof window.chessEngine.search }
      : null));
    expect(bridge).toEqual({ protocolVersion: 1, search: 'function' });
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');

    await page.selectOption('#difficulty', 'expert');
    await page.selectOption('#game-mode', 'computer');
    await expect(page.locator('#turn')).toHaveText('待开始');
    expect((await listEnginePids()).filter((pid) => !baseline.includes(pid))).toEqual([]);
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.locator('#move-list .move-san:not(.move-san--empty)')).toHaveCount(2, { timeout: 60000 });
    await expect(page.locator('#turn')).toHaveText('白方走棋');
    await expect(page.locator('#engine-status')).toHaveText('');

    spawned = (await listEnginePids()).filter((pid) => !baseline.includes(pid));
    expect(spawned.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    // Close during another real search, exercising abort and before-quit cleanup.
    await page.locator('[data-square="g1"]').click();
    await page.locator('[data-square="f3"]').click();
    await expect(page.locator('#engine-status')).toContainText('电脑思考');
  } finally {
    await desktop.close();
  }
  await expect.poll(async () => (await listEnginePids()).filter((pid) => spawned.includes(pid)), {
    timeout: 20000,
  }).toEqual([]);
});
