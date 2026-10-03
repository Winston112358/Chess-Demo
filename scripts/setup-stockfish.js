#!/usr/bin/env node
/**
 * Downloads, verifies and installs the pinned Stockfish resources:
 * - official native Windows x86-64 universal build (sf_19, commit edb0d9d…)
 * - npm package stockfish@19.0.0, lite single-threaded WASM files
 * - exact matching source archives for both
 *
 * Only Node built-ins and the Windows tar.exe are used. Downloads are written
 * to temporary *.part files inside .cache/stockfish/, verified against the
 * pinned size/SHA-256/integrity, and only then extracted. Every archive member
 * path is validated before extraction and only whitelisted members are read.
 *
 * Usage:
 *   node scripts/setup-stockfish.js [--cache-dir <dir>] [--verify-only] [--force]
 *
 * Env:
 *   CHESS_STOCKFISH_CACHE  override the cache directory
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync,
  readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_PREFIX = '[stockfish]';

// ---------------------------------------------------------------------------
// Pinned inputs. These mirror docs/STOCKFISH-RESOURCES.md and must not be
// replaced by "latest" lookups.
// ---------------------------------------------------------------------------

export const NATIVE = Object.freeze({
  engine: 'Stockfish',
  release: 'sf_19',
  buildVersion: '19',
  commit: 'edb0d9db6731067ec50ce619ff372b463bc4dd5d',
  zipName: 'stockfish-windows-x86-64-universal.zip',
  zipUrl: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip',
  zipBytes: 81431614,
  zipSha256: '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7',
  releaseUrl: 'https://github.com/official-stockfish/Stockfish/releases/tag/sf_19',
  sourceUrl: 'https://github.com/official-stockfish/Stockfish/archive/edb0d9db6731067ec50ce619ff372b463bc4dd5d.zip',
  sourceName: 'Stockfish-edb0d9db6731067ec50ce619ff372b463bc4dd5d-src.zip',
});

export const WEB = Object.freeze({
  engine: 'stockfish.js',
  flavor: 'lite single-threaded',
  package: 'stockfish@19.0.0',
  packageVersion: '19.0.0',
  author: 'Nathan Rugg (nmrugg), Chess.com',
  usageUrl: 'https://github.com/nmrugg/stockfish.js',
  tarballName: 'stockfish-19.0.0.tgz',
  tarballUrl: 'https://registry.npmjs.org/stockfish/-/stockfish-19.0.0.tgz',
  integrity: 'sha512-jDyYLbqNpboQcMs5HodTHI2CrKL74zkQWb1+sgoNXw5HI6avTblW4G0X7afFt3BBOc6VbTSkOV64EUxm/DWSpg==',
  engineFiles: ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'],
  portCommit: '54fde71d90c7c403964f6cacef48f7bbec495df1',
  portSourceUrl: 'https://github.com/nmrugg/stockfish.js/archive/54fde71d90c7c403964f6cacef48f7bbec495df1.zip',
  portSourceName: 'stockfish.js-54fde71d90c7c403964f6cacef48f7bbec495df1-src.zip',
});

const FETCH_TIMEOUT_MS = 30 * 60 * 1000;
const DOWNLOAD_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1000, 3000, 6000];

// ---------------------------------------------------------------------------
// Generic helpers (exported for tests)
// ---------------------------------------------------------------------------

function hashFile(filePath, algorithm) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(hash.digest()));
  });
}

export function sha256File(filePath) {
  return hashFile(filePath, 'sha256').then((digest) => digest.toString('hex'));
}

function sha512Base64File(filePath) {
  return hashFile(filePath, 'sha512').then((digest) => digest.toString('base64'));
}

/**
 * Verifies byte size and/or SHA-256 / SRI integrity of a file.
 * Returns { ok, reason?, actualBytes?, actualSha256? } instead of throwing,
 * so callers can log a concrete reason and decide whether to re-download.
 */
export async function verifyFile(filePath, { bytes, sha256, integrity } = {}) {
  if (!existsSync(filePath)) return { ok: false, reason: '文件不存在' };
  const actualBytes = statSync(filePath).size;
  if (typeof bytes === 'number' && actualBytes !== bytes) {
    return { ok: false, reason: `字节数不符（期望 ${bytes}，实际 ${actualBytes}）`, actualBytes };
  }
  if (sha256) {
    const actualSha256 = await sha256File(filePath);
    if (actualSha256 !== sha256) {
      return { ok: false, reason: `SHA-256 不符（期望 ${sha256}，实际 ${actualSha256}）`, actualBytes, actualSha256 };
    }
    return { ok: true, actualBytes, actualSha256 };
  }
  if (integrity) {
    const [algorithm, expected] = integrity.split('-', 2);
    const actual = (await hashFile(filePath, algorithm)).toString('base64');
    if (actual !== expected) {
      return { ok: false, reason: `${algorithm} integrity 不符（期望 ${expected}，实际 ${actual}）`, actualBytes };
    }
    return { ok: true, actualBytes };
  }
  return { ok: true, actualBytes };
}

/** Rejects absolute paths, drive letters, leading dashes and ".." segments. */
export function assertSafeArchiveMember(member) {
  if (typeof member !== 'string' || member.trim() === '') {
    throw new Error(`归档成员名无效：${JSON.stringify(member)}`);
  }
  const name = member.replace(/\\/g, '/').replace(/\/+$/, '');
  if (name.startsWith('/')) throw new Error(`拒绝绝对路径成员：${member}`);
  if (/^[A-Za-z]:/.test(name)) throw new Error(`拒绝盘符路径成员：${member}`);
  if (name.startsWith('-')) throw new Error(`拒绝以 - 开头的成员：${member}`);
  const segments = name.split('/');
  if (segments.some((segment) => segment === '..')) throw new Error(`拒绝含 .. 的成员：${member}`);
  const clean = posix.normalize(name);
  if (clean.startsWith('../') || clean === '..') throw new Error(`拒绝越出目录的成员：${member}`);
  return clean;
}

function listArchiveMembers(archivePath) {
  const result = spawnSync('tar.exe', ['-tf', archivePath], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`无法运行 tar.exe：${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`tar.exe 列出归档失败（退出码 ${result.status}）：${(result.stderr || '').trim()}`);
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function extractMembers(archivePath, destDir, members) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('tar.exe', ['-xf', archivePath, '-C', destDir, '--', ...members], {
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`tar.exe 解包失败（退出码 ${code}）：${stderr.trim()}`));
    });
  });
}

function suffix() {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** Cheap sanity check that a downloaded archive is a real zip/tar with expected prefix. */
function assertArchiveShape(archivePath, expectedPrefix, label) {
  const members = listArchiveMembers(archivePath).map((member) => assertSafeArchiveMember(member));
  if (members.length === 0) throw new Error(`${label} 归档为空`);
  if (expectedPrefix) {
    const matches = members.filter((member) => member.startsWith(expectedPrefix));
    if (matches.length === 0) {
      throw new Error(`${label} 归档内容与预期不符（缺少 ${expectedPrefix} 下的成员，共 ${members.length} 个成员）`);
    }
  }
  return members;
}

function makeTempDir(cacheDir) {
  const dir = join(cacheDir, `tmp-extract-${suffix()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Cleanup is limited to our own cache directory. */
function removeTempDir(dir, cacheDir) {
  const resolved = resolve(dir);
  const cacheRoot = resolve(cacheDir);
  const allowed = dirname(resolved) === cacheRoot;
  if (!allowed || !basename(resolved).startsWith('tmp-extract-')) {
    console.warn(`${LOG_PREFIX} 跳过非缓存临时目录清理：${resolved}`);
    return;
  }
  rmSync(resolved, { recursive: true, force: true });
}

async function fetchToFile(url, dest, label) {
  console.log(`${LOG_PREFIX} 下载 ${label}\n${LOG_PREFIX}   ${url}`);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'chess-demo-setup-stockfish/1.0' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText ?? ''}`.trim());
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastPercent = -10;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (total > 0) {
        const percent = Math.floor((received / total) * 100);
        if (percent >= lastPercent + 10) {
          lastPercent = percent - (percent % 10);
          console.log(`${LOG_PREFIX}   ${Math.min(percent, 100)}%（${formatBytes(received)} / ${formatBytes(total)}）`);
        }
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(dest));
}

/**
 * Ensures a verified cache file. Reuses an existing file only after the pinned
 * checks pass; on mismatch the file is removed and downloaded again.
 */
async function downloadFile({ url, dest, label, expectedBytes, expectedSha256, integrity, force }) {
  const partPath = `${dest}.part`;
  rmSync(partPath, { force: true });
  if (!force && existsSync(dest)) {
    const cached = await verifyFile(dest, { bytes: expectedBytes, sha256: expectedSha256, integrity });
    if (cached.ok) {
      console.log(`${LOG_PREFIX} 复用缓存 ${label}（${formatBytes(cached.actualBytes)}）`);
      return { bytes: cached.actualBytes, reused: true };
    }
    console.warn(`${LOG_PREFIX} 缓存无效（${label}）：${cached.reason}，重新下载`);
    rmSync(dest, { force: true });
  }
  mkdirSync(dirname(dest), { recursive: true });
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await fetchToFile(url, partPath, label);
      const check = await verifyFile(partPath, { bytes: expectedBytes, sha256: expectedSha256, integrity });
      if (!check.ok) throw new Error(check.reason);
      rmSync(dest, { force: true });
      renameSync(partPath, dest);
      return { bytes: check.actualBytes, reused: false };
    } catch (error) {
      lastError = error;
      rmSync(partPath, { force: true });
      console.warn(`${LOG_PREFIX} 下载失败（${label}，第 ${attempt}/${DOWNLOAD_ATTEMPTS} 次）：${error.message}`);
      if (attempt < DOWNLOAD_ATTEMPTS) await delay(RETRY_DELAYS_MS[attempt - 1] ?? 6000);
    }
  }
  throw new Error(`下载 ${label} 失败：${lastError.message}`);
}

async function installFile(from, to, role) {
  mkdirSync(dirname(to), { recursive: true });
  const tempPath = `${to}.tmp-${suffix()}`;
  copyFileSync(from, tempPath);
  rmSync(to, { force: true });
  renameSync(tempPath, to);
  const bytes = statSync(to).size;
  const sha256 = await sha256File(to);
  return { path: toPath(relative(PROJECT_ROOT, to)), role, bytes, sha256 };
}

function toPath(value) {
  return value.split(sep).join('/');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.warn(`${LOG_PREFIX} 现有 manifest.json 无法解析，将重建：${error.message}`);
    return null;
  }
}

const isInfoMember = (member) => /(^|\/)(copying(\.txt)?|license(\.txt)?|authors(\.txt)?|readme(\.md|\.txt)?)$/i.test(member);

// ---------------------------------------------------------------------------
// Project paths
// ---------------------------------------------------------------------------

function projectPaths(cacheDir) {
  const vendorDir = join(PROJECT_ROOT, 'vendor', 'stockfish');
  return {
    cacheDir,
    vendorDir,
    nativeDir: join(vendorDir, 'native'),
    webDir: join(vendorDir, 'web'),
    sourceDir: join(vendorDir, 'source'),
    publicDir: join(PROJECT_ROOT, 'src', 'web', 'public', 'engines', 'stockfish'),
    manifestPath: join(vendorDir, 'manifest.json'),
  };
}

// ---------------------------------------------------------------------------
// Preparation steps
// ---------------------------------------------------------------------------

async function prepareNative({ cacheDir, paths, force, previousManifest }) {
  const zipPath = join(cacheDir, NATIVE.zipName);
  const download = await downloadFile({
    url: NATIVE.zipUrl,
    dest: zipPath,
    label: `原生构建 ${NATIVE.zipName}`,
    expectedBytes: NATIVE.zipBytes,
    expectedSha256: NATIVE.zipSha256,
    force,
  });

  const members = listArchiveMembers(zipPath).map((member) => assertSafeArchiveMember(member));
  const exeMembers = members.filter((member) => /\.exe$/i.test(member));
  const universalExes = exeMembers.filter((member) => /universal/i.test(member));
  if (universalExes.length !== 1) {
    throw new Error(
      `无法唯一定位 Windows x86-64 universal EXE（匹配 ${universalExes.length} 个）。归档中的 EXE：${exeMembers.join(', ') || '无'}`,
    );
  }
  const exeMember = universalExes[0];
  if (!/windows/i.test(exeMember) || !/x86[-_]64/i.test(exeMember)) {
    throw new Error(`universal EXE 名称未确认是 Windows x86-64：${exeMember}`);
  }
  const dataMembers = members.filter((member) => /\.nnue$/i.test(member));
  const infoMembers = members.filter((member) => isInfoMember(member));
  const wanted = [...new Set([exeMember, ...dataMembers, ...infoMembers])];

  const tempDir = makeTempDir(cacheDir);
  const files = [];
  try {
    await extractMembers(zipPath, tempDir, wanted);
    files.push(await installFile(join(tempDir, exeMember), join(paths.nativeDir, basename(exeMember)), 'native-exe'));
    for (const member of dataMembers) {
      files.push(await installFile(join(tempDir, member), join(paths.nativeDir, basename(member)), 'native-data'));
    }
    for (const member of infoMembers) {
      files.push(await installFile(join(tempDir, member), join(paths.nativeDir, basename(member)), 'native-license'));
    }
  } finally {
    removeTempDir(tempDir, cacheDir);
  }

  const exeEntry = files.find((entry) => entry.role === 'native-exe');
  console.log(`${LOG_PREFIX} 原生引擎：${exeEntry.path}（${formatBytes(exeEntry.bytes)}，universal x86-64）`);

  return {
    files,
    download: {
      role: 'native-zip',
      name: NATIVE.zipName,
      url: NATIVE.zipUrl,
      bytes: download.bytes,
      sha256: NATIVE.zipSha256,
    },
    exe: exeEntry.path,
    hasExtraData: dataMembers.length > 0,
  };
}

async function prepareWeb({ cacheDir, paths, force }) {
  const tarballPath = join(cacheDir, WEB.tarballName);
  const download = await downloadFile({
    url: WEB.tarballUrl,
    dest: tarballPath,
    label: `npm 包 ${WEB.package}`,
    integrity: WEB.integrity,
    force,
  });

  const members = listArchiveMembers(tarballPath).map((member) => assertSafeArchiveMember(member));
  const required = WEB.engineFiles.map((name) => `package/bin/${name}`);
  const engineMembers = [];
  for (const member of required) {
    if (!members.includes(member)) throw new Error(`npm 包中缺少必需文件：${member}`);
    engineMembers.push(member);
  }
  const infoMembers = ['package/Copying.txt', 'package/README.md', 'package/package.json']
    .filter((member) => members.includes(member));
  if (!infoMembers.includes('package/Copying.txt')) {
    throw new Error('npm 包中缺少许可文件 package/Copying.txt');
  }

  const tempDir = makeTempDir(cacheDir);
  const files = [];
  try {
    await extractMembers(tarballPath, tempDir, [...engineMembers, ...infoMembers]);
    for (const member of engineMembers) {
      const name = basename(member);
      const role = name.endsWith('.wasm') ? 'web-wasm' : 'web-js';
      files.push(await installFile(join(tempDir, member), join(paths.publicDir, name), role));
    }
    for (const member of infoMembers) {
      files.push(await installFile(join(tempDir, member), join(paths.webDir, basename(member)), 'web-license'));
    }
  } finally {
    removeTempDir(tempDir, cacheDir);
  }

  console.log(`${LOG_PREFIX} 网页引擎：${engineMembers.join(' + ')}（lite single-threaded）`);

  return {
    files,
    download: {
      role: 'web-tarball',
      name: WEB.tarballName,
      url: WEB.tarballUrl,
      bytes: download.bytes,
      integrity: WEB.integrity,
    },
  };
}

async function prepareSourceArchive({ url, name, label, cacheDir, paths, force, previousManifest, prefix }) {
  const cachePath = join(cacheDir, name);
  const previous = previousManifest?.downloads?.find((entry) => entry.name === name);
  const download = await downloadFile({
    url,
    dest: cachePath,
    label,
    expectedSha256: previous?.sha256,
    force,
  });
  assertArchiveShape(cachePath, prefix, label);
  const sha256 = await sha256File(cachePath);
  const entry = await installFile(cachePath, join(paths.sourceDir, name), 'source-archive');
  console.log(`${LOG_PREFIX} 源代码归档：${entry.path}（${formatBytes(entry.bytes)}）`);
  return {
    files: [entry],
    download: { role: 'source-archive', name, url, bytes: download.bytes, sha256 },
  };
}

// ---------------------------------------------------------------------------
// Manifest and verification
// ---------------------------------------------------------------------------

/** Require the pinned engines, licensing and sources before trusting any paths. */
export function validateManifest(manifest) {
  const require = (condition, reason) => {
    if (!condition) throw new Error(`资源清单无效：${reason}`);
  };
  require(manifest?.manifestVersion === 1, 'manifestVersion 必须为 1');
  require(manifest.native?.release === NATIVE.release && manifest.native?.sourceCommit === NATIVE.commit,
    '原生版本或源码 commit 与固定输入不符');
  require(manifest.native?.expectedSha256 === NATIVE.zipSha256 && manifest.native?.expectedBytes === NATIVE.zipBytes,
    '原生下载摘要或大小与固定输入不符');
  require(manifest.web?.packageVersion === WEB.packageVersion && manifest.web?.portCommit === WEB.portCommit
    && manifest.web?.expectedIntegrity === WEB.integrity, '网页版本、commit 或 integrity 与固定输入不符');

  const requiredFiles = new Map([
    [`vendor/stockfish/native/${NATIVE.zipName.replace(/\.zip$/, '.exe')}`, 'native-exe'],
    ['vendor/stockfish/native/Copying.txt', 'native-license'],
    ['vendor/stockfish/native/AUTHORS', 'native-license'],
    ['vendor/stockfish/native/README.md', 'native-license'],
    ...WEB.engineFiles.map((name) => [`src/web/public/engines/stockfish/${name}`, name.endsWith('.wasm') ? 'web-wasm' : 'web-js']),
    ['vendor/stockfish/web/Copying.txt', 'web-license'],
    ['vendor/stockfish/web/README.md', 'web-license'],
    ['vendor/stockfish/web/package.json', 'web-license'],
    [`vendor/stockfish/source/${NATIVE.sourceName}`, 'source-archive'],
    [`vendor/stockfish/source/${WEB.portSourceName}`, 'source-archive'],
  ]);
  const validSize = (bytes) => Number.isSafeInteger(bytes) && bytes > 0;
  const validHash = (hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
  require(Array.isArray(manifest.files), 'files 必须为数组');
  const files = new Map();
  for (const file of manifest.files) {
    require(typeof file?.path === 'string', '文件路径缺失');
    require(assertSafeArchiveMember(file.path) === file.path && !file.path.includes(':'), `文件路径不规范：${file.path}`);
    const expectedRole = requiredFiles.get(file.path);
    require(expectedRole ? file.role === expectedRole
      : file.role === 'native-data' && /^vendor\/stockfish\/native\/[^/]+\.nnue$/.test(file.path),
    `非预期的路径或角色：${file.path}`);
    require(!files.has(file.path), `文件记录重复：${file.path}`);
    require(validSize(file.bytes) && validHash(file.sha256), `文件大小或 SHA-256 缺失/无效：${file.path}`);
    files.set(file.path, file);
  }
  for (const path of requiredFiles.keys()) require(files.has(path), `缺少必需文件：${path}`);
  require(manifest.native.exe === [...requiredFiles.keys()][0], 'native.exe 路径与固定输入不符');

  const requiredDownloads = new Map([
    [NATIVE.zipName, { role: 'native-zip', url: NATIVE.zipUrl, sha256: NATIVE.zipSha256, bytes: NATIVE.zipBytes }],
    [WEB.tarballName, { role: 'web-tarball', url: WEB.tarballUrl, integrity: WEB.integrity }],
    [NATIVE.sourceName, { role: 'source-archive', url: NATIVE.sourceUrl }],
    [WEB.portSourceName, { role: 'source-archive', url: WEB.portSourceUrl }],
  ]);
  require(Array.isArray(manifest.downloads), 'downloads 必须为数组');
  const seenDownloads = new Set();
  for (const download of manifest.downloads) {
    const expected = requiredDownloads.get(download?.name);
    require(expected && !seenDownloads.has(download.name), `非预期或重复的下载记录：${download?.name}`);
    for (const [key, value] of Object.entries(expected)) {
      require(download[key] === value, `下载记录 ${download.name} 的 ${key} 与固定输入不符`);
    }
    require(validSize(download.bytes), `下载大小缺失/无效：${download.name}`);
    if (!expected.integrity) require(validHash(download.sha256), `下载 SHA-256 缺失/无效：${download.name}`);
    if (download.role === 'source-archive') {
      const installed = files.get(`vendor/stockfish/source/${download.name}`);
      require(installed.sha256 === download.sha256 && installed.bytes === download.bytes,
        `源码归档与下载记录不一致：${download.name}`);
    }
    seenDownloads.add(download.name);
  }
  for (const name of requiredDownloads.keys()) require(seenDownloads.has(name), `缺少必需下载记录：${name}`);
}

function buildManifest({ files, downloads, nativeInfo, webInfo, cacheDir }) {
  const nativeExe = nativeInfo.exe;
  return {
    manifestVersion: 1,
    generatedBy: 'scripts/setup-stockfish.js',
    generatedAt: new Date().toISOString(),
    cacheDir: toPath(relative(PROJECT_ROOT, cacheDir)) || '.cache/stockfish',
    native: {
      engine: NATIVE.engine,
      release: NATIVE.release,
      buildVersion: NATIVE.buildVersion,
      sourceCommit: NATIVE.commit,
      releaseUrl: NATIVE.releaseUrl,
      downloadUrl: NATIVE.zipUrl,
      expectedBytes: NATIVE.zipBytes,
      expectedSha256: NATIVE.zipSha256,
      exe: nativeExe,
      notes: nativeInfo.hasExtraData ? '包含独立数据文件，见 files 列表' : 'NNUE 网络内嵌于官方二进制，无独立网络文件',
    },
    web: {
      engine: WEB.engine,
      flavor: WEB.flavor,
      package: WEB.package,
      packageVersion: WEB.packageVersion,
      author: WEB.author,
      usageUrl: WEB.usageUrl,
      portCommit: WEB.portCommit,
      tarballUrl: WEB.tarballUrl,
      expectedIntegrity: WEB.integrity,
      publicDir: toPath(relative(PROJECT_ROOT, join(PROJECT_ROOT, 'src', 'web', 'public', 'engines', 'stockfish'))),
    },
    files,
    downloads,
  };
}

function writeManifest(manifestPath, manifest) {
  validateManifest(manifest);
  mkdirSync(dirname(manifestPath), { recursive: true });
  const previous = readManifest(manifestPath);
  const strip = (value) => JSON.stringify({ ...value, generatedAt: undefined });
  if (previous && strip(previous) === strip(manifest)) {
    console.log(`${LOG_PREFIX} 清单内容未变化，保留现有 manifest.json`);
    return;
  }
  const tempPath = `${manifestPath}.tmp-${suffix()}`;
  writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  rmSync(manifestPath, { force: true });
  renameSync(tempPath, manifestPath);
  console.log(`${LOG_PREFIX} 已写入 ${toPath(relative(PROJECT_ROOT, manifestPath))}（${manifest.files.length} 个文件）`);
}

async function verifyOnly({ cacheDir, paths }) {
  let failed = false;
  const report = async (label, filePath, spec) => {
    const result = await verifyFile(filePath, spec);
    if (result.ok) console.log(`${LOG_PREFIX} 通过 ${label}`);
    else { console.error(`${LOG_PREFIX} 失败 ${label}：${result.reason}`); failed = true; }
    return result;
  };

  console.log(`${LOG_PREFIX} --verify-only：仅校验，不下载、不解包`);
  await report(`原生 ZIP ${NATIVE.zipName}`, join(cacheDir, NATIVE.zipName), {
    bytes: NATIVE.zipBytes, sha256: NATIVE.zipSha256,
  });
  await report(`npm tarball ${WEB.tarballName}`, join(cacheDir, WEB.tarballName), { integrity: WEB.integrity });

  const manifest = readManifest(paths.manifestPath);
  if (!manifest) {
    console.error(`${LOG_PREFIX} 失败 未找到 vendor/stockfish/manifest.json，请先运行 npm run setup:stockfish`);
    failed = true;
  } else {
    validateManifest(manifest);
    for (const download of manifest.downloads ?? []) {
      if (download.role === 'source-archive' && download.sha256) {
        await report(`源代码归档 ${download.name}`, join(cacheDir, download.name), { sha256: download.sha256 });
      }
    }
    for (const file of manifest.files ?? []) {
      await report(file.path, join(PROJECT_ROOT, file.path), { bytes: file.bytes, sha256: file.sha256 });
    }
  }
  if (failed) throw new Error('缓存或已安装资源校验失败');
  console.log(`${LOG_PREFIX} --verify-only 校验全部通过`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { cacheDir: null, verifyOnly: false, force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cache-dir') {
      options.cacheDir = argv[index + 1];
      index += 1;
      if (!options.cacheDir) throw new Error('--cache-dir 缺少路径参数');
    } else if (arg === '--verify-only') options.verifyOnly = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`用法：node scripts/setup-stockfish.js [选项]

选项：
  --cache-dir <dir>  覆盖下载缓存目录（默认 .cache/stockfish）
  --verify-only      只校验缓存与已安装资源，不下载、不解包
  --force            忽略缓存，重新下载
  -h, --help         显示本帮助

环境变量：CHESS_STOCKFISH_CACHE 覆盖缓存目录`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { printHelp(); return; }
  const cacheDir = resolve(options.cacheDir ?? process.env.CHESS_STOCKFISH_CACHE ?? join(PROJECT_ROOT, '.cache', 'stockfish'));
  const paths = projectPaths(cacheDir);
  mkdirSync(cacheDir, { recursive: true });
  if (options.verifyOnly) {
    await verifyOnly({ cacheDir, paths });
    return;
  }

  console.log(`${LOG_PREFIX} 缓存目录：${cacheDir}`);
  const previousManifest = readManifest(paths.manifestPath);
  const files = [];
  const downloads = [];

  const native = await prepareNative({ cacheDir, paths, force: options.force, previousManifest });
  files.push(...native.files);
  downloads.push(native.download);

  const nativeSource = await prepareSourceArchive({
    url: NATIVE.sourceUrl, name: NATIVE.sourceName, label: 'Stockfish 精确源码归档',
    cacheDir, paths, force: options.force, previousManifest,
    prefix: `Stockfish-${NATIVE.commit}/`,
  });
  files.push(...nativeSource.files);
  downloads.push(nativeSource.download);

  const web = await prepareWeb({ cacheDir, paths, force: options.force });
  files.push(...web.files);
  downloads.push(web.download);

  const webSource = await prepareSourceArchive({
    url: WEB.portSourceUrl, name: WEB.portSourceName, label: 'stockfish.js 移植源码归档',
    cacheDir, paths, force: options.force, previousManifest,
    prefix: `stockfish.js-${WEB.portCommit}/`,
  });
  files.push(...webSource.files);
  downloads.push(webSource.download);

  const manifest = buildManifest({
    files, downloads,
    nativeInfo: { exe: native.exe, hasExtraData: native.hasExtraData },
    webInfo: {},
    cacheDir,
  });
  writeManifest(paths.manifestPath, manifest);

  const cacheBytes = downloads.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  const vendorBytes = files.filter((entry) => entry.path.startsWith('vendor/')).reduce((sum, entry) => sum + entry.bytes, 0);
  const publicBytes = files.filter((entry) => entry.path.startsWith('src/')).reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`${LOG_PREFIX} 完成：缓存 ${formatBytes(cacheBytes)}，vendor ${formatBytes(vendorBytes)}，网页公开资源 ${formatBytes(publicBytes)}`);
  console.log(`${LOG_PREFIX} 下一步：npm run check:stockfish`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const entry = resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} 错误：${error.message}`);
    process.exitCode = 1;
  });
}
