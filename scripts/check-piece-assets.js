#!/usr/bin/env node
/**
 * Validates assets/pieces-manifest.json (manifestVersion=2) and the PNG files
 * it references. Machine checks only:
 * - exactly 12 unique pieces with correct color/type ids and both front/rear slots
 * - every provided view: path inside assets/, byte size, SHA-256, PNG header,
 *   real dimensions, 8-bit RGBA
 * - Edge decodes each provided PNG: transparent ratio, alpha>threshold bounds,
 *   empty / fully opaque / edge-touching images are rejected
 *
 * Strict mode fails when any of the 24 slots is missing. `--allow-partial`
 * only tolerates null slots while manifest status is "draft"; provided image
 * errors are never ignored.
 *
 * Usage: node scripts/check-piece-assets.js [--manifest <file>] [--allow-partial]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = join(PROJECT_ROOT, 'assets', 'pieces-manifest.json');
const ASSETS_ROOT = join(PROJECT_ROOT, 'assets');
const VIEWS = ['front', 'rear'];
const COLORS = ['w', 'b'];
const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SLOT_TOTAL = 24;

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readPngHeader(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const headerLength = buffer.readUInt32BE(8);
  const chunkType = buffer.toString('ascii', 12, 16);
  if (headerLength !== 13 || chunkType !== 'IHDR') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28],
  };
}

function safeViewPath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') throw new Error('path 必须是非空字符串');
  if (isAbsolute(rawPath) || /^[A-Za-z]:/.test(rawPath)) throw new Error(`拒绝绝对路径：${rawPath}`);
  const normalized = rawPath.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) throw new Error(`拒绝含 .. 的路径：${rawPath}`);
  if (!normalized.startsWith('assets/')) throw new Error(`素材必须位于 assets/ 下：${rawPath}`);
  const absolute = resolve(PROJECT_ROOT, normalized);
  if (absolute !== ASSETS_ROOT && !absolute.startsWith(ASSETS_ROOT + sep)) {
    throw new Error(`路径越出 assets/：${rawPath}`);
  }
  return { normalized, absolute };
}

function assertRealPathInsideAssets(absolute) {
  const real = realpathSync(absolute);
  const assetsReal = realpathSync(ASSETS_ROOT);
  if (real !== assetsReal && !real.startsWith(assetsReal + sep)) {
    throw new Error(`符号链接或真实路径越出 assets/：${relative(PROJECT_ROOT, real)}`);
  }
  return real;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function decodeImagesWithEdge(entries, log) {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const sources = new Map();
    for (const entry of entries) {
      sources.set(`/img/${encodeURIComponent(entry.slot)}.png`, entry.absolute);
    }
    await page.route('http://piece-assets.local/**', async (route) => {
      const url = new URL(route.request().url());
      const filePath = sources.get(url.pathname);
      if (!filePath) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>piece assets</title>' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(filePath) });
    });
    await page.goto('http://piece-assets.local/blank');
    const results = new Map();
    for (const entry of entries) {
      const stats = await page.evaluate(async ({ src, threshold }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let transparentCount = 0;
        let opaqueCount = 0;
        let contentCount = 0;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -1;
        let maxY = -1;
        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3];
          if (alpha === 0) transparentCount += 1;
          if (alpha === 255) opaqueCount += 1;
          if (alpha > threshold) {
            const pixel = index / 4;
            const x = pixel % canvas.width;
            const y = (pixel - x) / canvas.width;
            contentCount += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        return {
          width: canvas.width,
          height: canvas.height,
          transparentCount,
          opaqueCount,
          contentCount,
          bounds: contentCount > 0 ? { left: minX, top: minY, right: maxX, bottom: maxY } : null,
        };
      }, { src: `http://piece-assets.local/img/${encodeURIComponent(entry.slot)}.png`, threshold: entry.threshold });
      results.set(entry.slot, stats);
      log(`[pieces]   Edge 解码 ${entry.slot}：透明 ${((stats.transparentCount / (stats.width * stats.height)) * 100).toFixed(2)}%，alpha>${entry.threshold} 包围盒 ${stats.bounds ? `x${stats.bounds.left}–${stats.bounds.right} y${stats.bounds.top}–${stats.bounds.bottom}` : '无'}`);
    }
    return results;
  } finally {
    await browser.close();
  }
}

export async function inspectPieceAssets({
  manifestPath = DEFAULT_MANIFEST,
  allowPartial = false,
  log = console.log,
} = {}) {
  const errors = [];
  const provided = [];
  const missing = [];
  let manifest = null;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { ok: false, errors: [`无法读取或解析清单 ${manifestPath}：${error.message}`], provided, missing, manifest, decoded: new Map(), counts: { provided: 0, total: SLOT_TOTAL } };
  }

  if (!isPlainObject(manifest)) {
    return { ok: false, errors: ['清单必须是对象'], provided, missing, manifest, decoded: new Map(), counts: { provided: 0, total: SLOT_TOTAL } };
  }
  if (manifest.manifestVersion !== 2) errors.push(`manifestVersion 必须为 2（实际 ${manifest.manifestVersion}）`);
  if (typeof manifest.status !== 'string' || manifest.status.trim() === '') errors.push('status 必须是非空字符串');
  if (!Array.isArray(manifest.pieces)) errors.push('pieces 必须是数组');

  const pieces = Array.isArray(manifest.pieces) ? manifest.pieces : [];
  if (pieces.length !== 12) errors.push(`pieces 必须恰好 12 个（实际 ${pieces.length}）`);

  const expectedIds = new Set(COLORS.flatMap((color) => TYPES.map((type) => `${color}${type}`)));
  const seenIds = new Set();
  for (const piece of pieces) {
    const id = piece?.id;
    if (typeof id !== 'string' || id === '') {
      errors.push(`存在缺少 id 的 piece：${JSON.stringify(piece)}`);
      continue;
    }
    if (seenIds.has(id)) errors.push(`重复的 piece id：${id}`);
    seenIds.add(id);
    if (!expectedIds.has(id)) errors.push(`无效的 piece id：${id}`);
    if (piece.color !== id[0] || piece.type !== id[1] || !COLORS.includes(piece.color) || !TYPES.includes(piece.type)) {
      errors.push(`${id} 的 color/type 与 id 不一致：${piece.color}/${piece.type}`);
    }
    if (typeof piece.name !== 'string' || piece.name.trim() === '') errors.push(`${id} 缺少 name`);
    if (!isPlainObject(piece.views)) {
      errors.push(`${id} 缺少 views 对象`);
      continue;
    }
    const keys = Object.keys(piece.views);
    for (const view of VIEWS) {
      if (!Object.hasOwn(piece.views, view)) errors.push(`${id}/${view} 缺少视图键（不能把缺失键当作 null 槽）`);
      if (piece.views[view] === null) missing.push(`${id}/${view}`);
    }
    for (const key of keys) {
      if (!VIEWS.includes(key)) errors.push(`${id} 含未知视图键：${key}`);
    }
  }
  for (const expected of expectedIds) {
    if (!seenIds.has(expected)) errors.push(`缺少 piece：${expected}`);
  }

  // Provided views: declared metadata first, browser decode later.
  const decodedEntries = [];
  for (const piece of pieces) {
    if (!piece?.id || !isPlainObject(piece.views)) continue;
    for (const view of VIEWS) {
      const slot = `${piece.id}/${view}`;
      const data = piece.views[view];
      if (data === null || data === undefined) continue;
      if (!isPlainObject(data)) {
        errors.push(`${slot} 的视图必须是对象或 null（实际 ${JSON.stringify(data)}）`);
        continue;
      }
      const required = ['path', 'width', 'height', 'bytes', 'sha256', 'contentBounds', 'boundsAlphaThreshold'];
      const missingFields = required.filter((field) => data[field] === undefined || data[field] === null);
      if (missingFields.length > 0) {
        errors.push(`${slot} 缺少必需字段：${missingFields.join(', ')}`);
        continue;
      }
      if (!Number.isInteger(data.width) || data.width <= 0 || !Number.isInteger(data.height) || data.height <= 0) {
        errors.push(`${slot} 的 width/height 必须是正整数`);
        continue;
      }
      if (!Number.isInteger(data.bytes) || data.bytes <= 0) {
        errors.push(`${slot} 的 bytes 必须是正整数`);
        continue;
      }
      if (typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(data.sha256)) {
        errors.push(`${slot} 的 sha256 必须是 64 位小写十六进制`);
        continue;
      }
      if (data.boundsAlphaThreshold !== 16) {
        errors.push(`${slot} 的 boundsAlphaThreshold 必须为 16`);
        continue;
      }
      const bounds = data.contentBounds;
      if (!isPlainObject(bounds)
        || !['left', 'top', 'right', 'bottom'].every((key) => Number.isInteger(bounds[key]))
        || bounds.left < 0 || bounds.top < 0 || bounds.right >= data.width || bounds.bottom >= data.height
        || bounds.left > bounds.right || bounds.top > bounds.bottom) {
        errors.push(`${slot} 的 contentBounds 无效`);
        continue;
      }

      let filePath;
      try {
        const safe = safeViewPath(data.path);
        filePath = safe.absolute;
      } catch (error) {
        errors.push(`${slot} path 无效：${error.message}`);
        continue;
      }
      if (!existsSync(filePath)) {
        errors.push(`${slot} 文件不存在：${data.path}`);
        continue;
      }
      try {
        assertRealPathInsideAssets(filePath);
      } catch (error) {
        errors.push(`${slot} path 无效：${error.message}`);
        continue;
      }
      const actualBytes = statSync(filePath).size;
      if (actualBytes !== data.bytes) {
        errors.push(`${slot} 字节数不符（期望 ${data.bytes}，实际 ${actualBytes}）`);
        continue;
      }
      const actualSha256 = sha256File(filePath);
      if (actualSha256 !== data.sha256) {
        errors.push(`${slot} SHA-256 不符（期望 ${data.sha256}，实际 ${actualSha256}）`);
        continue;
      }
      const header = readPngHeader(readFileSync(filePath));
      if (!header) {
        errors.push(`${slot} 不是有效 PNG（缺少 PNG 标识或 IHDR）`);
        continue;
      }
      if (header.width !== data.width || header.height !== data.height) {
        errors.push(`${slot} 实际尺寸 ${header.width}×${header.height} 与声明 ${data.width}×${data.height} 不符`);
        continue;
      }
      if (header.bitDepth !== 8 || header.colorType !== 6) {
        errors.push(`${slot} 必须是 8-bit RGBA（实际 bitDepth=${header.bitDepth}, colorType=${header.colorType}）`);
        continue;
      }
      if (header.interlace !== 0) errors.push(`${slot} 不支持隔行 PNG（interlace=${header.interlace}）`);

      provided.push({
        slot,
        pieceId: piece.id,
        view,
        name: piece.name,
        path: data.path,
        absolute: filePath,
        meta: data,
        threshold: data.boundsAlphaThreshold,
      });
      decodedEntries.push({ slot, absolute: filePath, threshold: data.boundsAlphaThreshold });
    }
  }

  log(`[pieces] 清单 ${relative(PROJECT_ROOT, manifestPath)}：manifestVersion=${manifest.manifestVersion}, status=${manifest.status}`);
  log(`[pieces] 有效视图 ${provided.length}/${SLOT_TOTAL}${missing.length ? `；缺失 ${missing.length} 个视图槽：${missing.join(', ')}` : ''}`);

  const decoded = new Map();
  if (errors.length === 0 && decodedEntries.length > 0) {
    try {
      const results = await decodeImagesWithEdge(decodedEntries, log);
      for (const entry of decodedEntries) decoded.set(entry.slot, results.get(entry.slot));
    } catch (error) {
      errors.push(`Edge 解码 PNG 失败：${error.message}`);
    }
  } else if (errors.length > 0) {
    log('[pieces] 跳过浏览器解码：先修复上述素材错误');
  }

  for (const entry of provided) {
    const stats = decoded.get(entry.slot);
    if (!stats) continue;
    const total = stats.width * stats.height;
    const transparentRatio = stats.transparentCount / total;
    if (stats.contentCount === 0) {
      errors.push(`${entry.slot} 是空图（没有 alpha>${entry.threshold} 的像素）`);
      continue;
    }
    if (stats.transparentCount === 0 && transparentRatio === 0) {
      errors.push(`${entry.slot} 完全不透明，缺少真实透明背景`);
    }
    const { bounds } = stats;
    if (bounds.left <= 0 || bounds.top <= 0 || bounds.right >= stats.width - 1 || bounds.bottom >= stats.height - 1) {
      errors.push(`${entry.slot} 内容碰到画布边缘（x${bounds.left}–${bounds.right}, y${bounds.top}–${bounds.bottom}，画布 ${stats.width}×${stats.height}）`);
    }
    const declared = entry.meta.contentBounds;
    if (declared.left !== bounds.left || declared.top !== bounds.top
      || declared.right !== bounds.right || declared.bottom !== bounds.bottom) {
      errors.push(`${entry.slot} 包围盒与清单不符（声明 x${declared.left}–${declared.right}, y${declared.top}–${declared.bottom}；实测 x${bounds.left}–${bounds.right}, y${bounds.top}–${bounds.bottom}）`);
    }
    entry.stats = { ...stats, transparentRatio };
    decoded.set(entry.slot, entry.stats);
  }

  if (missing.length > 0) {
    if (allowPartial) {
      if (manifest.status !== 'draft') {
        errors.push(`--allow-partial 只允许 status=draft 的 null 槽（当前 status=${manifest.status}）`);
      } else {
        log(`[pieces] --allow-partial：status=draft，允许 ${missing.length} 个 null 槽`);
      }
    } else {
      errors.push(`严格模式失败：缺少 ${missing.length}/${SLOT_TOTAL} 个视图槽：${missing.join(', ')}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    provided,
    missing,
    manifest,
    decoded,
    counts: { provided: provided.length, total: SLOT_TOTAL },
  };
}

function parseArgs(argv) {
  const options = { manifestPath: DEFAULT_MANIFEST, allowPartial: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-partial') options.allowPartial = true;
    else if (arg === '--manifest') {
      options.manifestPath = resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`用法：node scripts/check-piece-assets.js [选项]

选项：
  --allow-partial   仅允许 status=draft 时的 null 槽，已提供图片仍完整校验
  --manifest <file> 指定清单文件（默认 assets/pieces-manifest.json）
  -h, --help        显示本帮助`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await inspectPieceAssets(options);
  for (const error of report.errors) {
    console.error(`[pieces] 错误：${error}`);
  }
  if (!report.ok) {
    throw new Error(`素材校验未通过（有效 ${report.counts.provided}/${report.counts.total}，${report.errors.length} 项错误）`);
  }
  console.log(`[pieces] 素材校验通过：有效 ${report.counts.provided}/${report.counts.total} 个视图`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const entry = resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`[pieces] 错误：${error.message}`);
    process.exitCode = 1;
  });
}
