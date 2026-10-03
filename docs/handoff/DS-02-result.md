# DS-02：固定版本 Stockfish 资源准备与验证

日期：2026-10-03。按 `docs/tasks/DS-02-stockfish-resources.md` 完成；未修改棋盘、未接入人机按钮、未实现搜索状态机。未提交或推送。

## 修改文件

- 新增 `scripts/setup-stockfish.js`：下载、缓存校验、安全解包、许可/源码归档与 `vendor/stockfish/manifest.json` 生成。仅使用 Node 内置模块与 Windows `tar.exe`；扩展名 `.part` 临时下载，校验通过才改名；可 `--cache-dir`、`--verify-only`、`--force`，支持 `CHESS_STOCKFISH_CACHE`。
- 新增 `scripts/check-stockfish-resources.js`：清单与全部文件字节数/SHA-256、WASM magic/version、JS/WASM 相邻、缓存归档摘要，以及原生与网页引擎的真实 UCI 冒烟（`uci`→`uciok`、`isready`→`readyok`、`position startpos moves e2e4`、`go movetime 600`、chess.js 校验合法 `bestmove`；小内存预算、超时、`windowsHide`、退出后释放进程）。
- 新增 `tests/resources/stockfish-cache.test.js`（3 项）：损坏缓存按大小/摘要被拒绝、成员路径穿越与绝对路径被拒绝、`--verify-only` 对损坏缓存非零退出且不下载。测试只用系统临时目录，不触碰正常资源。
- `vendor/stockfish/`：`manifest.json`、`native/`（universal EXE + `Copying.txt`/`AUTHORS`/`README.md`）、`web/`（npm 包 `Copying.txt`/`README.md`/`package.json`）、`source/`（两份精确源码归档）。
- `src/web/public/engines/stockfish/`：`stockfish-19-lite-single.js` 与同名 `.wasm`，原文件名、相邻，无 ZIP/缓存。
- 新增 `docs/STOCKFISH-RESOURCES.md`：固定输入、缓存复用、失败重试、体积、许可与验证边界。
- 更新 `.gitignore`（忽略 EXE、WASM、源码归档、缓存）；`package.json` 仅新增 `setup:stockfish`、`check:stockfish`。

## 校验结果

- `npm run setup:stockfish` 首次：原生 ZIP 校验 81431614 字节与固定 SHA-256；npm tarball 校验 SHA-512 integrity；两份源码归档记录 SHA-256；解包前拒绝非常规成员。第二次运行：全部“复用缓存”，清单未变化，不重复下载。
- `npm run setup:stockfish -- --verify-only`：缓存与 11 个已安装文件全部通过。
- `npm run check:stockfish`：11 个文件哈希、WASM 头（magic + version 1）、相邻性、4 个缓存归档全部通过；**原生引擎真实返回** `id name Stockfish 19`、`bestmove e7e5`；**网页引擎经官方 Node CLI** 返回 `Stockfish 19 Lite WASM`、`bestmove e7e5`；检查后无残留引擎进程。
- `node --test "tests/resources/**/*.test.js"`：3 项通过；`npm.cmd test`：8 项通过；`npm run build`：通过，`dist/web/engines/stockfish/` 已包含 JS/WASM。

## 体积

- 下载缓存 `.cache/stockfish/` 约 232.5 MiB：原生 ZIP 81,431,614 B（77.7 MiB）、npm tarball 161,239,627 B（153.8 MiB）、Stockfish 源码 382,624 B、stockfish.js 源码 737,789 B。
- `vendor/stockfish/` 约 99.4 MiB，其中 `stockfish-windows-x86-64-universal.exe` 103,046,300 B（98.3 MiB）；EXE/WASM/源码归档按约定被 git 忽略，清单与许可保留。
- 网页公开资源共 1,808,986 B（JS 21,415 + WASM 1,787,571）。

## 验证范围与边界

- 原生与网页引擎都执行了真实 UCI 冒烟并返回合法着法，不是预制输出。
- 网页 Emscripten 产物是 CommonJS，而项目为 `"type": "module"`；校验时在 `.cache/stockfish/tmp-web-smoke-*` 临时 CommonJS 沙箱运行公开文件的字节级副本，不修改公开文件。浏览器 Worker/WASM 集成未实现，生产页面 CSP（`script-src 'self'`）未修改，不声称网页人机对战已接入。
- `tests/resources/` 独立测试需手动运行 `node --test "tests/resources/**/*.test.js"`：任务只允许在 package.json 增加两个脚本，`npm test` 的 glob 未改动。

## 未解决问题

- 首次从 codeload 下载 stockfish.js 源码归档时该主机偶发中断（原生 ZIP 与 npm tarball 正常）；setup 现为 4 次尝试并指数退避，缓存有效时不会重下大包。
- 浏览器内的 WASM 加载与 Worker 执行留待 GPT 集成阶段验证；本任务只证明 Node 环境可用与资源结构正确。
