import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PREVIEW_INDEX = join(PROJECT_ROOT, '.cache', 'piece-preview', 'index.html');
const SCREENSHOT_DIR = join(PROJECT_ROOT, 'test-results', 'assets');
const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, 'assets', 'pieces-manifest.json'), 'utf8'));
const provided = manifest.pieces.flatMap((piece) => Object.entries(piece.views)
  .filter(([, data]) => data !== null).map(([view]) => `${piece.id}/${view}`));
const missing = manifest.pieces.flatMap((piece) => Object.entries(piece.views)
  .filter(([, data]) => data === null).map(([view]) => `${piece.id}/${view}`));

test.beforeAll(() => {
  execFileSync(process.execPath, [join(PROJECT_ROOT, 'scripts', 'preview-piece-assets.js')], {
    cwd: PROJECT_ROOT, stdio: 'inherit',
  });
  expect(existsSync(PREVIEW_INDEX), '预览页面应已生成').toBe(true);
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test('gallery shows both provided views at three scales on two tile colors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pathToFileURL(PREVIEW_INDEX).href);

  await expect(page.getByRole('heading', { name: '棋子素材对照图库' })).toBeVisible();
  await expect(page.locator('.count')).toHaveText(`样张 ${provided.length}/24 视图，独立素材对照图库`);
  await expect(page.locator('[data-state="provided"]')).toHaveCount(provided.length);
  await expect(page.locator('[data-state="missing"]')).toHaveCount(missing.length);

  // Correct front/rear labeling per piece and honest missing slots.
  await expect(page.locator('[data-piece="wn"] [data-view="rear"] h4')).toContainText('rear · 后俯视');
  await expect(page.locator('[data-piece="bn"] [data-view="front"] h4')).toContainText('front · 前俯视');
  for (const slot of missing) await expect(page.locator(`[data-slot="${slot}"]`)).toContainText(`尚未提供（${slot}）`);
  await expect(page.locator('[data-state="missing"] img')).toHaveCount(0);
  for (const slot of provided) await expect(page.locator(`[data-slot="${slot}"] .details`)).toContainText('透明');
  await expect(page.locator('body')).not.toContainText('NaN');

  // Three scales and both tile colors on each provided view.
  for (const size of [48, 64, 96]) {
    await expect(page.locator(`[data-state="provided"] [data-size="${size}"]`)).toHaveCount(provided.length);
    for (const tile of await page.locator(`[data-state="provided"] [data-size="${size}"] .tile`).all()) {
      const box = await tile.boundingBox();
      expect(box.width).toBeCloseTo(size, 0);
      expect(box.height).toBeCloseTo(size, 0);
    }
  }
  await expect(page.locator('[data-state="provided"] .tile--light')).toHaveCount(provided.length * 3);
  await expect(page.locator('[data-state="provided"] .tile--dark')).toHaveCount(provided.length * 3);
  await expect(page.locator('[data-state="provided"] .tile--light').first()).toBeVisible();
  await expect(page.locator('[data-state="provided"] .tile--dark').first()).toBeVisible();

  // No broken images and no transforms/rotations applied to originals.
  const broken = await page.evaluate(() => [...document.images]
    .filter((image) => !image.complete || image.naturalWidth === 0)
    .map((image) => image.getAttribute('src')));
  expect(broken).toEqual([]);
  const transformed = await page.evaluate(() => [...document.images].filter((image) => {
    const transform = getComputedStyle(image).transform;
    return transform && transform !== 'none';
  }).length);
  expect(transformed).toBe(0);

  // Facing diagram uses the two existing originals and states the missing pair.
  const facing = page.locator('.facing');
  await expect(facing).toContainText('黑马 front');
  await expect(facing).toContainText('白马 rear');
  const reverseMissing = ['wn/front', 'bn/rear'].filter((slot) => missing.includes(slot));
  if (reverseMissing.length) {
    for (const slot of reverseMissing) await expect(facing.locator('.facing-note')).toContainText(slot);
    await expect(facing.locator('.facing-note')).toContainText('尚未提供');
  } else {
    await expect(facing.locator('.facing-note')).toContainText('反向观察视图已提供');
  }
  await expect(facing.locator('img')).toHaveCount(2);
  await expect(facing.locator('[data-facing="bn/front"] img')).toBeVisible();
  await expect(facing.locator('[data-facing="wn/rear"] img')).toBeVisible();

  await page.screenshot({ path: join(SCREENSHOT_DIR, 'piece-gallery-desktop.png'), fullPage: true });
  await page.locator('[data-piece="wn"]').screenshot({ path: join(SCREENSHOT_DIR, 'white-knight-gallery.png') });
  expect(errors).toEqual([]);
});

test('gallery fits a 320px viewport without horizontal overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(pathToFileURL(PREVIEW_INDEX).href);
  await expect(page.locator('.count')).toHaveText(`样张 ${provided.length}/24 视图，独立素材对照图库`);

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true);
  await expect(page.locator('[data-state="provided"]').first()).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'piece-gallery-320.png'), fullPage: true });
  expect(errors).toEqual([]);
});
