#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateManifest, verifyFile } from './setup-stockfish.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = join(projectRoot, '.cache');
const run = promisify(execFile);
const psLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

async function main() {
  const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('发行版本格式无效');
  if (process.platform !== 'win32') throw new Error('当前打包脚本需要 Windows PowerShell');
  const manifest = JSON.parse(await readFile(join(projectRoot, 'vendor/stockfish/manifest.json'), 'utf8'));
  validateManifest(manifest);
  const included = manifest.files.filter((file) => ['web-js', 'web-wasm', 'web-license', 'source-archive'].includes(file.role));
  for (const file of included) {
    const source = file.role === 'web-js' || file.role === 'web-wasm'
      ? join(projectRoot, 'dist/web/engines/stockfish', basename(file.path))
      : join(projectRoot, file.path);
    const verified = await verifyFile(source, file);
    if (!verified.ok) throw new Error(`发行资源校验失败 ${file.path}：${verified.reason}`);
  }

  await mkdir(cacheRoot, { recursive: true });
  const staging = await mkdtemp(join(cacheRoot, 'web-release-'));
  try {
    const site = join(staging, 'site');
    await cp(join(projectRoot, 'dist/web'), site, { recursive: true });
    const thirdParty = join(site, 'third-party/stockfish');
    await cp(join(projectRoot, 'vendor/stockfish/web'), join(thirdParty, 'web'), { recursive: true });
    await cp(join(projectRoot, 'vendor/stockfish/source'), join(thirdParty, 'source'), { recursive: true });
    // The original manifest retains repository paths for traceability.
    await copyFile(join(projectRoot, 'vendor/stockfish/manifest.json'), join(thirdParty, 'manifest.json'));
    await writeFile(join(site, 'THIRD-PARTY.md'), `# 引擎许可与源码

本发行使用 stockfish@19.0.0 的 lite single-threaded JS/WASM（GPLv3）。
许可、作者与上游说明：third-party/stockfish/web/。
对应 stockfish.js 和 Stockfish 的精确源码归档：third-party/stockfish/source/。
原始来源与摘要：third-party/stockfish/manifest.json（路径沿用仓库布局）。
网页引擎文件：engines/stockfish/stockfish-19-lite-single.{js,wasm}。
这些上游引擎的许可不改变其他文件的授权；项目业务源码未授予开源许可。
`, 'utf8');
    await writeFile(join(site, 'README.txt'), `Chess Demo ${version} 网页版

把解压后的整个目录放在 HTTP/HTTPS 静态服务器上，可部署在域名根目录或子目录。
引擎在浏览器本地运行，无须后端或远程 AI 服务。不要直接双击 index.html。
本地体验（已安装 Python）：在本目录运行 python -m http.server 8080 --bind 127.0.0.1，
然后用浏览器访问 http://127.0.0.1:8080/ 。关闭服务在终端按 Ctrl+C。
选择“人机对弈”、执棋色和难度即可与电脑下棋。
引擎许可与源码说明见 THIRD-PARTY.md。写实棋子素材尚未接入。
`, 'utf8');
    const packed = join(staging, `Chess-Web-${version}.zip`);
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Compress-Archive -Path ${psLiteral(join(site, '*'))} -DestinationPath ${psLiteral(packed)}`,
    ], { windowsHide: true, timeout: 120000 });
    const destination = join(projectRoot, 'release', basename(packed));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(packed, destination);
    const sha256 = createHash('sha256').update(await readFile(destination)).digest('hex');
    console.log(JSON.stringify({ path: destination, bytes: (await stat(destination)).size, sha256 }));
  } finally {
    const target = resolve(staging);
    if (dirname(target) !== cacheRoot || !basename(target).startsWith('web-release-')) {
      throw new Error('拒绝清理发行缓存目录之外的路径');
    }
    await rm(target, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
