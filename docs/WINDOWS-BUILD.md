# Windows 便携版与网页版构建验收

版本 0.4.1，目标 Windows 10/11 x64。开发工具需要 Node.js 22.12+，实际使用 Node.js 24.14.1。0.4.1 增加吃子提示开关与人机对弈“开始”按钮，继续使用完整写实 Staunton 棋子（assets/pieces-manifest.json，24/24 视图、16 张原图）。

构建：`npm.cmd ci` → `npm.cmd run setup:stockfish`（首次准备引擎资源）→ `npm.cmd run dist:win` / `npm.cmd run dist:web`。`prebuild` 会自动运行 `prepare:pieces`：严格校验素材清单后把原 PNG 逐字节复制到 `src/web/public/pieces/staunton-v3/` 并生成 `src/web/piece-assets.generated.js`。素材校验使用本机 Edge 解码，因此构建机需要 Edge。引擎资源来源、固定版本、许可与摘要见 [STOCKFISH-RESOURCES.md](STOCKFISH-RESOURCES.md)，素材规格见 [PIECE-ASSETS.md](PIECE-ASSETS.md)。

electron-builder 26.15.3、Electron 44.5.1 固定版本。`overrides` 将下载工具 @electron/get 固定到 5.1.0，与 Electron 使用同一版本，避开旧下载缓存依赖；完整 npm 审计为 0 项漏洞。更新版本或 overrides 后必须重新实际构建和验收。

## 0.4.1 输出

- release/Chess-Demo-0.4.1-x64.exe：单文件便携版，189754866 字节（约 181.0 MiB）。SHA-256：`c5d859720b5b4477e1e53cf445c01fda5efc53ec8dcf9cc05e20db13fe3c9bb3`（portable 打包包含时间戳，不保证字节级可复现，重新构建后需重新记录）。
- release/Chess-Web-0.4.1.zip：静态网页包，14715248 字节（约 14.0 MiB）。SHA-256：`e3e5acd03b3a9c6ab362a050542ab62ba22428a6fb8888bd89c23e11aa593752`。当前 dist/web 通过与 `dist:web` 相同的 scripts/package-web.js 打包。
- release/win-unpacked/：构建中间产物；`resources/app.asar` 含 dist/web、src/desktop、src/engine 与 chess.js；`resources/stockfish/` 含原生 EXE、许可与源码。
- dist/web/：独立静态网页产物，含 `engines/stockfish/` 的 lite JS/WASM 与 `pieces/staunton-v3/` 的 16 张原图副本（共 12,770,992 字节，逐字节复制、未压缩重绘）。

打包布局（`extraResources`）：

- `resources/stockfish/native/`：`stockfish-windows-x86-64-universal.exe`（103,046,300 字节，NNUE 内嵌）与 `Copying.txt`、`AUTHORS`、`README.md`。
- `resources/stockfish/web/`：npm 包许可 `Copying.txt`、`README.md`、`package.json`。
- `resources/stockfish/source/`：Stockfish 与 stockfish.js 的两份精确源码归档。
- `resources/stockfish/manifest.json`：来源、版本/commit、路径、字节数与 SHA-256 清单。

缓存、node_modules 下载包、完整 npm 多版本引擎与源码 ZIP 不进入网页 public 目录。

## 验收

`npm.cmd run test:release` 用两个 Playwright 测试实际操作发行物：

便携 EXE（复制到系统临时目录下唯一的含空格路径，离线运行）：

- 包内 file 页面能载入 64 格、32 子；全部 32 张棋子图片已加载，逐项检查 front/rear 源地址、自然尺寸、等比显示高度和底座基线。默认白方 rear / 黑方 front，翻转后相反，无位图旋转或外部素材请求。
- 网络设为离线后重载仍能下棋，e2-e4 后正确轮到黑方；悔棋恢复局面和走棋方。
- 离线切到人机对弈先显示“待开始”；点击棋盘不会走棋，也不会创建原生引擎。点击“开始”后打包的原生 Stockfish 真实回复，棋谱出现两着且轮到白方；`#engine-status` 恢复空闲，吃子提示开关可以正常操作。
- 关闭窗口后本次启动的 Stockfish PID 退出，其他 Node/Electron 进程不受影响；在第二次真实搜索尚未结束时关闭也能释放。
- 无 pageerror，清理仅限本测试创建并验证过绝对路径与名称前缀的临时目录。
- 非当前走棋方的王被将军的非法 FEN 被拒绝，原 FEN、历史和 revision 保持不变；两种发行包都实际验证了此行为。

网页 ZIP（解压到仓库外独立目录，经由 HTTP 子目录 `/chess-demo/`）：

- 逐项核对 JS/WASM、许可与源码摘要；32 张棋子图片加载成功，翻转后白 front / 黑 rear；实际请求 `/chess-demo/pieces/staunton-v3/` 下的 PNG。
- 待开始时不请求 WASM；点击“开始”后浏览器内 WASM 引擎完成人类一着与电脑回复，吃子提示开关可以正常操作；除本机测试服务器外无外部请求；无 pageerror。
- 截图见 `test-results/web-release.png` 与 `test-results/portable-computer.png`；素材接入截图见 `test-results/ui/pieces-white-bottom.png`、`pieces-black-bottom.png`、`pieces-320.png`。

本次 0.4.1 验证：57 单元、37 界面、2 发行包测试通过，生产构建与 24/24 素材严格校验通过。两种包均已在仓库外实际运行 Stockfish，验证待开始状态、开始后的应答与搜索中退出。包内 16 张原图摘要、前端 JS/CSS 与当前构建内容一致。GPT 查看待开始桌面布局与关闭吃子提示的 320px 截图，保存在 docs/images/chess-0.4.1-waiting.png、chess-0.4.1-capture-off-320.png。旧 0.4.0 的引擎通信与素材专项验收记录保存在 docs/handoff/GPT-11-realistic-release-review.md。发行包未签名、使用 Electron 默认图标；旧发行文件仅作历史版本。
