import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE, assertSafeArchiveMember, validateManifest, verifyFile } from '../../scripts/setup-stockfish.js';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SETUP_SCRIPT = join(PROJECT_ROOT, 'scripts', 'setup-stockfish.js');

function removeTestDirectory(dir) {
  const target = resolve(dir);
  assert.equal(dirname(target), resolve(tmpdir()), '只清理系统临时目录中的直接子目录');
  assert.match(basename(target), /^chess-sf-(verify|cache)-/, '只清理本测试创建的目录');
  rmSync(target, { recursive: true, force: true });
}

function manifestFixture() {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, 'vendor/stockfish/manifest.json'), 'utf8'));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('verifyFile rejects size and SHA-256 mismatches instead of trusting the cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-sf-verify-'));
  try {
    const file = join(dir, 'sample.zip');
    const content = Buffer.from('fake archive content', 'utf8');
    writeFileSync(file, content);

    const wrongSize = await verifyFile(file, { bytes: content.length + 1 });
    assert.equal(wrongSize.ok, false);
    assert.match(wrongSize.reason, /字节数/);

    const wrongHash = await verifyFile(file, { bytes: content.length, sha256: '0'.repeat(64) });
    assert.equal(wrongHash.ok, false);
    assert.match(wrongHash.reason, /SHA-256/);

    const wrongIntegrity = await verifyFile(file, {
      integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
    });
    assert.equal(wrongIntegrity.ok, false);
    assert.match(wrongIntegrity.reason, /integrity/);

    const good = await verifyFile(file, { bytes: content.length, sha256: sha256(content) });
    assert.equal(good.ok, true);
    assert.equal(good.actualBytes, content.length);

    const missing = await verifyFile(join(dir, 'nope.zip'), { bytes: 1 });
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /不存在/);
  } finally {
    removeTestDirectory(dir);
  }
});

test('archive member validation rejects traversal and absolute paths', () => {
  assert.throws(() => assertSafeArchiveMember('../evil.exe'), /\.\./);
  assert.throws(() => assertSafeArchiveMember('stockfish/../../evil.exe'), /\.\./);
  assert.throws(() => assertSafeArchiveMember('/abs/evil.exe'), /绝对路径/);
  assert.throws(() => assertSafeArchiveMember('C:/evil.exe'), /盘符/);
  assert.throws(() => assertSafeArchiveMember('..\\evil.exe'), /\.\./);
  assert.throws(() => assertSafeArchiveMember('-oops'), /-/);
  assert.throws(() => assertSafeArchiveMember(''), /无效/);
  assert.equal(
    assertSafeArchiveMember('package/bin/stockfish-19-lite-single.js'),
    'package/bin/stockfish-19-lite-single.js',
  );
  assert.equal(assertSafeArchiveMember('stockfish\\Copying.txt'), 'stockfish/Copying.txt');
});

test('setup --verify-only refuses a corrupted cache without downloading anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-sf-cache-'));
  try {
    // Same name as the pinned native archive, but the wrong size and hash.
    writeFileSync(join(dir, NATIVE.zipName), Buffer.alloc(4096, 0x5a));
    const result = spawnSync(process.execPath, [SETUP_SCRIPT, '--verify-only', '--cache-dir', dir], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0, `期望非零退出码；输出：${output}`);
    assert.match(output, /字节数不符/);
  } finally {
    removeTestDirectory(dir);
  }
});

test('manifest cannot omit engines, licensing, sources or download records', () => {
  assert.doesNotThrow(() => validateManifest(manifestFixture()));
  const empty = manifestFixture();
  empty.files = [];
  empty.downloads = [];
  assert.throws(() => validateManifest(empty), /缺少必需文件/);
  for (const role of ['native-exe', 'web-wasm', 'native-license', 'web-license', 'source-archive']) {
    const manifest = manifestFixture();
    manifest.files = manifest.files.filter((file) => file.role !== role);
    assert.throws(() => validateManifest(manifest), /缺少必需文件/, role);
  }
  const missingDownloads = manifestFixture();
  missingDownloads.downloads = [];
  assert.throws(() => validateManifest(missingDownloads), /缺少必需下载记录/);
});

test('manifest rejects unverified sizes, hashes, unexpected paths and changed versions', () => {
  for (const update of [
    (manifest) => { delete manifest.files[0].sha256; },
    (manifest) => { manifest.files[0].bytes = 0; },
    (manifest) => { manifest.files[0].path = '../outside.exe'; },
    (manifest) => { manifest.files.push({ ...manifest.files[0] }); },
    (manifest) => { manifest.native.sourceCommit = 'unknown'; },
    (manifest) => { manifest.downloads[1].sha256 = '0'.repeat(64); },
  ]) {
    const manifest = manifestFixture();
    update(manifest);
    assert.throws(() => validateManifest(manifest));
  }
});
