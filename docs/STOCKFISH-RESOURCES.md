# Stockfish 固定版本资源

本页说明 `npm run setup:stockfish` 下载、校验并安装的引擎资源，以及 `npm run check:stockfish` 的验证边界。所有版本、URL、摘要均为固定值，不依赖 GitHub `latest` API 或 npm 的浮动标签。

## 固定输入

| 资源 | 版本 / commit | 固定来源 | 校验 |
| --- | --- | --- | --- |
| 原生 Windows x86-64 universal | Stockfish `sf_19`，commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d` | `stockfish-windows-x86-64-universal.zip`（GitHub Release） | 字节数 `81431614`，SHA-256 `3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7` |
| 原生精确源码 | 同上 commit | `Stockfish/archive/edb0d9d….zip` | 首次下载后记录 SHA-256 |
| 网页引擎 | npm `stockfish@19.0.0`，lite single-threaded | `registry.npmjs.org/stockfish/-/stockfish-19.0.0.tgz` | SHA-512 integrity `sha512-jDyYLbqNpboQcMs5HodTHI2CrKL74zkQWb1+sgoNXw5HI6avTblW4G0X7afFt3BBOc6VbTSkOV64EUxm/DWSpg==` |
| 网页移植源码 | `nmrugg/stockfish.js` commit `54fde71d90c7c403964f6cacef48f7bbec495df1` | `stockfish.js/archive/54fde71d….zip` | 首次下载后记录 SHA-256 |

发布说明 `https://github.com/official-stockfish/Stockfish/releases/tag/sf_19`；移植用法与许可 `https://github.com/nmrugg/stockfish.js`。

## 目录

| 路径 | 内容 |
| --- | --- |
| `scripts/setup-stockfish.js` | 下载、校验、解包与清单生成；Node 内置模块 + Windows `tar.exe` |
| `scripts/check-stockfish-resources.js` | 清单/文件/WASM 头校验与原生、网页 UCI 冒烟 |
| `.cache/stockfish/` | 下载缓存（`.part` 临时文件校验通过后才改名）；已被 git 忽略 |
| `vendor/stockfish/native/` | `stockfish-windows-x86-64-universal.exe`，以及 `Copying.txt`、`AUTHORS`、`README.md` |
| `vendor/stockfish/web/` | npm 包中的 `Copying.txt`、`README.md`、`package.json`（作者与版本信息） |
| `vendor/stockfish/source/` | 两份精确源码归档（Stockfish 与 stockfish.js） |
| `vendor/stockfish/manifest.json` | 来源、版本/commit、路径、字节数、SHA-256、integrity |
| `src/web/public/engines/stockfish/` | `stockfish-19-lite-single.js` / `stockfish-19-lite-single.wasm`，原文件名、同名相邻；不含 ZIP 或缓存 |
| `tests/resources/stockfish-cache.test.js` | 损坏缓存拒绝、成员路径安全、摘要校验的独立测试 |

## 命令

```powershell
npm run setup:stockfish                    # 首次下载、校验、解包并写清单
npm run setup:stockfish                    # 再次运行：校验缓存后复用，不重复下载
npm run setup:stockfish -- --verify-only   # 只校验缓存与已安装资源，不联网
npm run setup:stockfish -- --force         # 忽略缓存，强制重新下载
npm run check:stockfish                    # 校验清单/文件/WASM 头 + 引擎冒烟
npm test                                 # 规则与资源安全测试（不下载大包）
```

缓存目录默认 `.cache/stockfish`，可用 `--cache-dir <dir>` 或环境变量 `CHESS_STOCKFISH_CACHE` 覆盖。

## 下载、缓存复用与失败重试

- 下载先写 `<文件>.part`；大小/SHA-256/integrity 全部通过后才原子改名为最终文件。
- 重新运行时先校验已有缓存：任何不符都会删除该缓存文件并重新下载，不会复用未经验证的文件。
- 固定摘要用于原生 ZIP 与 npm tarball；源码归档首次下载后把 SHA-256 写入清单，之后按清单摘要校验。
- 下载失败最多尝试 4 次，间隔 1/3/6 秒，错误信息包含 HTTP 状态或校验原因；失败不会留下 `.part`。
- 解包前检查归档全部成员路径，拒绝绝对路径、盘符、`..` 与以 `-` 开头的名称；只提取白名单文件。
- 临时解包目录使用 `.cache/stockfish/tmp-extract-*` 唯一命名，清理前做绝对路径与名称前缀检查，不触碰用户其他文件。
- `manifest.json` 在全部步骤成功后写入；中途失败不会产生“看似成功”的清单。

## 体积

| 项目 | 约计 |
| --- | --- |
| 下载缓存 `.cache/stockfish/` | 232.5 MiB（原生 ZIP 77.7 MiB、npm tarball 153.8 MiB、两份源码归档 1.1 MiB） |
| `vendor/stockfish/` | 99.4 MiB（其中 `stockfish-windows-x86-64-universal.exe` 103,046,300 B ≈ 98.3 MiB） |
| 网页公开资源 | 1.75 MiB（`stockfish-19-lite-single.js` 20.9 KiB + `.wasm` 1.7 MiB） |

`.gitignore` 忽略下载缓存、原生 EXE、WASM 与源码归档；清单、许可和压缩后的 JS 保留在仓库中。新克隆后需要运行一次 `setup:stockfish` 才会出现可运行的二进制/ WASM。

## 许可与源码资料

- Stockfish 与 stockfish.js 均以 GPLv3 分发。原生侧保留 `Copying.txt`、`AUTHORS`、`README.md`；网页侧保留 npm 包内的 `Copying.txt`、`README.md`、`package.json`（作者 Nathan Rugg / Chess.com）。
- 两份精确对应源码归档保存在 `vendor/stockfish/source/`，后续分发 EXE 或网页引擎时必须随附这些资料，不能只保留“GPL”字样。

## 当前验证边界

- `check:stockfish` 实际执行：清单与每个文件的字节数/SHA-256、WASM magic（`00 61 73 6d`）与 version 1、JS/WASM 同名相邻、缓存归档摘要。
- 清单必须完整列出固定版本的引擎、许可/作者资料、两份源码和四个下载记录；缺失、重复、无摘要或路径越界会被拒绝。资源校验失败时不会启动引擎。
- 原生引擎真实启动并完成 `uci`→`uciok`、`isready`→`readyok`、`position startpos moves e2e4` + `go movetime 600`，用 chess.js 校验返回的 `bestmove` 合法；设置 `Threads=1`、`Hash=16`，带超时与 `windowsHide`，检查后 `quit`/必要时强制结束进程。
- 网页引擎通过官方支持的 Node CLI 做了同样的 UCI 冒烟：Emscripten 产物是 CommonJS，而本项目 `"type": "module"`，因此在校验时把公开文件的字节级副本放入 `.cache/stockfish/tmp-web-smoke-*` 的临时 CommonJS 沙箱运行，不修改公开文件本身。
- 浏览器 Worker/WASM 集成尚未实现；生产页面 CSP 仍为 `script-src 'self'`，未开放 WASM 编译。本任务不修改 CSP，也不声称网页人机对战已接入，该部分由 GPT 后续集成。
- 没有进行人工桌面点击验收；真实浏览器内的运行效果留待集成阶段验证。
