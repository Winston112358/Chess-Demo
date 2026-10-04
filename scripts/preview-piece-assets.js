#!/usr/bin/env node
/**
 * Builds a static comparison gallery from assets/pieces-manifest.json:
 * .cache/piece-preview/index.html plus byte-identical copies of the original
 * PNGs under .cache/piece-preview/images/. Provided images are validated first
 * (same checks as check-piece-assets.js, draft null slots allowed); nothing is
 * generated, recolored, mirrored or otherwise altered. Missing slots are shown
 * as "尚未提供".
 *
 * Usage: node scripts/preview-piece-assets.js
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPieceAssets } from './check-piece-assets.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_ROOT = resolve(PROJECT_ROOT, '.cache');
const PREVIEW_DIR = resolve(CACHE_ROOT, 'piece-preview');
const SCALE_SIZES = [48, 64, 96];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cleanOwnPreviewDir() {
  const resolved = resolve(PREVIEW_DIR);
  if (dirname(resolved) !== CACHE_ROOT || resolved !== resolve(CACHE_ROOT, 'piece-preview')) {
    throw new Error(`拒绝清理非本任务目录：${resolved}`);
  }
  mkdirSync(CACHE_ROOT, { recursive: true });
  if (lstatSync(CACHE_ROOT).isSymbolicLink()
    || !realpathSync(CACHE_ROOT).startsWith(realpathSync(PROJECT_ROOT) + sep)
    || (existsSync(resolved) && lstatSync(resolved).isSymbolicLink())) {
    throw new Error('拒绝通过指向任务目录之外的链接清理图库');
  }
  if (existsSync(resolved)) rmSync(resolved, { recursive: true, force: true });
  mkdirSync(join(resolved, 'images'), { recursive: true });
}

function viewLabel(view) {
  return view === 'front' ? 'front · 前俯视' : 'rear · 后俯视';
}

function formatInteger(value) {
  return value.toLocaleString('zh-CN');
}

function renderProvidedView(piece, view, imageName, stats, meta) {
  const slot = `${piece.id}/${view}`;
  const alt = `${piece.name}${view === 'front' ? '前俯视' : '后俯视'}`;
  const scales = SCALE_SIZES.map((size) => `
        <div class="scale" data-size="${size}">
          <div class="tile tile--light" data-bg="light"><span class="frame"><img src="images/${imageName}" alt="${escapeHtml(alt)} ${size}px 浅色格"></span></div>
          <div class="tile tile--dark" data-bg="dark"><span class="frame"><img src="images/${imageName}" alt="${escapeHtml(alt)} ${size}px 深色格"></span></div>
        </div>`).join('');
  const details = [
    `${meta.width}×${meta.height}`,
    `${formatInteger(meta.bytes)} 字节`,
    `SHA-256 ${meta.sha256.slice(0, 12)}…`,
    stats ? `透明 ${(stats.transparentRatio * 100).toFixed(2)}%` : null,
    stats?.bounds ? `包围盒 x${stats.bounds.left}–${stats.bounds.right}，y${stats.bounds.top}–${stats.bounds.bottom}` : null,
    meta.path,
  ].filter(Boolean).join(' · ');
  return `
      <div class="view view--provided" data-slot="${slot}" data-view="${view}" data-state="provided">
        <h4>${viewLabel(view)}</h4>
        <div class="scales">${scales}
        </div>
        <p class="details">${escapeHtml(details)}</p>
      </div>`;
}

function renderMissingView(piece, view) {
  const slot = `${piece.id}/${view}`;
  return `
      <div class="view view--missing" data-slot="${slot}" data-view="${view}" data-state="missing">
        <h4>${viewLabel(view)}</h4>
        <p class="missing">尚未提供（${slot}）</p>
      </div>`;
}

function renderPiece(piece, report, imageNames) {
  const views = ['front', 'rear'].map((view) => {
    const data = piece.views[view];
    if (!data) return renderMissingView(piece, view);
    const slot = `${piece.id}/${view}`;
    return renderProvidedView(piece, view, imageNames.get(slot), report.decoded.get(slot), data);
  }).join('');
  return `
    <article class="piece" data-piece="${piece.id}">
      <h3>${escapeHtml(piece.name)} <span class="id">${piece.id}</span></h3>
      <div class="views">${views}
      </div>
    </article>`;
}

function facingImage(piece, view, imageNames, alt) {
  const slot = `${piece.id}/${view}`;
  if (!imageNames.has(slot)) {
    return `<p class="missing">尚未提供（${slot}）</p>`;
  }
  return `<img class="facing-img" src="images/${imageNames.get(slot)}" alt="${escapeHtml(alt)}">`;
}

function buildHtml(report, imageNames) {
  const { provided, manifest } = report;
  const pieceMap = new Map(manifest.pieces.map((piece) => [piece.id, piece]));
  const bn = pieceMap.get('bn');
  const wn = pieceMap.get('wn');
  const reverseMissing = ['wn/front', 'bn/rear'].filter((slot) => !imageNames.has(slot));
  const reverseNote = reverseMissing.length
    ? `反向观察尚未提供：${reverseMissing.join(' / ')}；如实显示缺件，不合成。`
    : '反向观察视图已提供：白马 front / 黑马 rear。';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>棋子素材对照图库</title>
<style>
:root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; --ink: #24302c; --muted: #64736d; --line: #dde5df; --light: #f7f8f4; --dark: #dfe5de; --missing: #a03d3d; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: #f4f7f4; color: var(--ink); }
header { max-width: 1100px; margin: 0 auto 20px; }
h1 { margin: 0 0 6px; font-size: 26px; }
.count { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #2e634c; }
.meta { margin: 0; color: var(--muted); font-size: 13px; }
.facing { max-width: 1100px; margin: 0 auto 24px; padding: 16px 18px; background: #fff; border: 1px solid var(--line); border-radius: 16px; }
.facing h2 { margin: 0 0 10px; font-size: 17px; }
.facing-board { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.facing-slot { display: flex; flex-direction: column; align-items: center; min-height: 96px; justify-content: center; }
.facing-slot .facing-label { margin: 0 0 6px; font-size: 13px; color: var(--muted); }
.facing-img { max-width: 150px; max-height: 150px; object-fit: contain; }
.facing-mid { padding: 6px 14px; border-top: 2px dashed #b9c4be; border-bottom: 2px dashed #b9c4be; color: var(--muted); font-size: 13px; }
.facing-note { margin: 10px 0 0; color: var(--missing); font-size: 13px; }
main.grid { max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.piece { padding: 14px 16px; background: #fff; border: 1px solid var(--line); border-radius: 16px; }
.piece h3 { margin: 0 0 10px; font-size: 16px; }
.piece .id { color: var(--muted); font-size: 12px; font-weight: 400; margin-left: 6px; }
.views { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.view { padding: 10px; border: 1px solid var(--line); border-radius: 12px; min-width: 0; }
.view h4 { margin: 0 0 8px; font-size: 13px; }
.view--missing { background: #fbfbfa; }
.missing { margin: 0; color: var(--missing); font-size: 13px; }
.scales { display: flex; flex-direction: column; gap: 8px; }
.scale { display: flex; gap: 8px; }
.tile { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 8px; }
.tile--light { background: var(--light); }
.tile--dark { background: var(--dark); }
.frame { display: flex; align-items: center; justify-content: center; width: 90%; height: 90%; }
.frame img { width: 100%; height: 100%; object-fit: contain; }
.details { margin: 8px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
[data-size="48"] .tile { width: 48px; height: 48px; }
[data-size="64"] .tile { width: 64px; height: 64px; }
[data-size="96"] .tile { width: 96px; height: 96px; }
@media (max-width: 420px) {
  body { padding: 12px; }
  .views { grid-template-columns: 1fr; }
  main.grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<header>
  <h1>棋子素材对照图库</h1>
  <p class="count">样张 ${provided.length}/${report.counts.total} 视图，未接入正式游戏</p>
  <p class="meta">清单状态：${escapeHtml(manifest.status)} · 风格：${escapeHtml(manifest.style ?? '未标注')} · 相机俯角目标：${escapeHtml(String(manifest.camera?.elevationDegreesTarget ?? '未标注'))}°</p>
</header>

<section class="facing">
  <h2>面对面示意（仅使用已有原图，未做旋转或镜像）</h2>
  <div class="facing-board">
    <div class="facing-slot" data-facing="bn/front">
      <p class="facing-label">上方：黑马 front（前俯视，朝近端/画面下方）</p>
      ${facingImage(bn, 'front', imageNames, '黑马 front 前俯视')}
    </div>
    <div class="facing-mid">棋盘中线 · 双方隔着棋盘面对面</div>
    <div class="facing-slot" data-facing="wn/rear">
      <p class="facing-label">下方：白马 rear（后俯视，朝远端/画面上方）</p>
      ${facingImage(wn, 'rear', imageNames, '白马 rear 后俯视')}
    </div>
  </div>
  <p class="facing-note">${reverseNote}</p>
</section>

<main class="grid">
${manifest.pieces.map((piece) => renderPiece(piece, report, imageNames)).join('\n')}
</main>
</body>
</html>
`;
}

async function main() {
  const report = await inspectPieceAssets({ allowPartial: true });
  if (!report.ok) {
    for (const error of report.errors) console.error(`[pieces] 错误：${error}`);
    throw new Error('已提供素材校验失败，未生成图库');
  }
  cleanOwnPreviewDir();
  const imageNames = new Map();
  for (const entry of report.provided) {
    const fileName = `${entry.pieceId}-${entry.view}.png`;
    copyFileSync(entry.absolute, join(PREVIEW_DIR, 'images', fileName)); // byte-identical copy
    imageNames.set(entry.slot, fileName);
  }
  const html = buildHtml(report, imageNames);
  writeFileSync(join(PREVIEW_DIR, 'index.html'), html, 'utf8');
  console.log(`[pieces] 图库已生成：${join('.cache', 'piece-preview', 'index.html')}`);
  console.log(`[pieces] 样张 ${report.counts.provided}/${report.counts.total} 视图，缺失 ${report.missing.length} 槽；图片为清单原文件副本，未修改`);
}

main().catch((error) => {
  console.error(`[pieces] 错误：${error.message}`);
  process.exitCode = 1;
});
