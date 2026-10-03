# Windows 便携版构建与验收

版本 0.3.0，目标 Windows 10/11 x64。开发工具需要 Node.js 22.12+，实际使用 Node.js 24.14.1。0.3.0 在 0.2.0 同机双人版基础上加入原生 Stockfish 19 人机对弈。

构建：`npm.cmd ci` → `npm.cmd run setup:stockfish`（首次准备引擎资源）→ `npm.cmd run dist:win`。首次使用 Electron 时下载开发运行时；构建使用已安装的 node_modules/electron/dist，网页先由 Vite 打包。引擎资源的来源、固定版本、许可与摘要见 [STOCKFISH-RESOURCES.md](STOCKFISH-RESOURCES.md)。

electron-builder 26.15.3、Electron 44.5.1 固定版本。`overrides` 将下载工具 @electron/get 固定到 5.1.0，与 Electron 使用同一版本，避开旧下载缓存依赖；已通过实际便携构建，完整 npm 审计为 0 项漏洞。更新版本或 overrides 后必须重新实际构建和验收。

## 0.3.0 输出

- release/Chess-Demo-0.3.0-x64.exe：单文件便携版，177530628 字节（约 169.3 MiB）。SHA-256：`4e11e6a2a0d531e42d2729fbb083e6e22f5cdca95ac217b4914fd3911520c432`（GPT 修复取消/退出时序后重新构建并由 `test:release` 实际启动验收；portable 打包包含时间戳，不保证字节级可复现，重新构建后需重新记录）。
- release/win-unpacked/：构建中间产物；`resources/app.asar` 含 dist/web、src/desktop、src/engine 与 chess.js；`resources/stockfish/` 含原生 EXE、许可与源码。
- dist/web/：独立静态网页产物，含 `engines/stockfish/stockfish-19-lite-single.js` 与同名 WASM。
- release/Chess-Web-0.3.0.zip：2300674 字节。SHA-256：`23d883e49c8315a106d130fbf72a0a298c59c61764c05f1de3efa95d7b195b0b`。`npm.cmd run dist:web` 生成；包含网页、许可与两份精确源码，适用于 HTTP/HTTPS 静态服务器。

打包布局（`extraResources`）：

- `resources/stockfish/native/`：`stockfish-windows-x86-64-universal.exe`（103,046,300 字节，NNUE 内嵌）与 `Copying.txt`、`AUTHORS`、`README.md`。
- `resources/stockfish/web/`：npm 包许可 `Copying.txt`、`README.md`、`package.json`。
- `resources/stockfish/source/`：Stockfish 与 stockfish.js 的两份精确源码归档。
- `resources/stockfish/manifest.json`：来源、版本/commit、路径、字节数与 SHA-256 清单。

缓存、node_modules 下载包、完整 npm 多版本引擎不进入发行包。源码 ZIP 随桌面包放在 resources/stockfish/source/，不进入网页 public 目录。

## 验收

`npm.cmd run test:release` 启动真实便携 EXE（不是开发运行 `electron .`），将它复制到系统临时目录下唯一的含空格路径。通过仅用于测试的 CDP 端口验证：

- 包内 file 页面能载入 64 格、32 子；不依赖仓库源码或 node_modules；`window.require` 仍为 undefined。
- 网络设为离线后重载仍能下棋，e2-e4 后正确轮到黑方；悔棋恢复局面和走棋方。
- 离线切到人机对弈：选择电脑难度后走 e2-e4，打包的原生 Stockfish 真实回复，棋谱出现两着且轮到白方；`#engine-status` 恢复空闲。
- 关闭窗口后本次启动的 Stockfish PID 退出，其他 Node/Electron 进程不受影响。
- 在第二次真实搜索尚未结束时关闭，仍能释放原生引擎。
- 无 pageerror，清理仅限本测试创建并验证过绝对路径与名称前缀的临时目录。

构建记录：0.3.0 EXE 已在仓库外含空格目录启动、断网重载、同机走棋与离线人机对弈通过；测试可用 `test-results/portable-computer.png` 截图复核。发行包未签名、使用 Electron 默认图标；写实素材尚未制作。0.2.0 的 `release/Chess-Demo-0.2.0-x64.exe`（100114556 字节，SHA-256 `5d2798d5266238764b064919b2c797f262c2822f5290839997f429cd47d7425a`）仅是同机双人版，若保留请区分说明。

同一发行测试还把网页 ZIP 解压到仓库外独立目录，逐项核对 JS/WASM、许可与源码摘要，在 HTTP 子目录 `/chess-demo/` 实际完成人类一着与电脑回复。该网页版本使用浏览器 WASM，无需后端引擎服务；截图见 `test-results/web-release.png`。
