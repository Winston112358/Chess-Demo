# Chess Demo · 国际象棋

网页与 Windows 客户端共用一个前端。当前支持同机双人、人机对弈（固定版本 Stockfish 19）、写实 Staunton 棋子（面对面 front/rear 视角）、合法目标提示、升变、悔棋、翻转、和棋申请、SAN 棋谱及 FEN 局面工具。

人机对弈使用固定版本引擎：浏览器加载 `stockfish@19.0.0` 的 lite single-threaded WASM，Windows 客户端通过受限 IPC 调用原生 `sf_19` universal 引擎。引擎来源、许可与源码归档见 [Stockfish 资源说明](docs/STOCKFISH-RESOURCES.md)；棋子素材规格见 [写实棋子素材阶段](docs/PIECE-ASSETS.md)。

## 启动

开发环境：Windows 10/11 x64，Node.js 22.12+（建议 Node.js 24 LTS）。

```powershell
npm.cmd ci
npm.cmd run setup:stockfish   # 首次下载并校验固定版本的 Stockfish 资源
npm.cmd start
```

`prepare:pieces` 会在 `start`、`dev`、`build`、`test` 前自动运行：严格校验 `assets/pieces-manifest.json`（24/24 视图），把 16 张原始 PNG 逐字节复制到 `src/web/public/pieces/staunton-v3/`，并生成 `src/web/piece-assets.generated.js`（不修改原图）。相关命令：

```powershell
npm.cmd run check:pieces     # 严格校验素材清单与 PNG
npm.cmd run preview:pieces   # 生成 .cache/piece-preview/ 对照图库
npm.cmd run test:assets      # 素材校验与图库的 Playwright 检查
```

打开 http://127.0.0.1:5173 。点击当前方棋子查看合法目标，再点击目标走棋；在“对局设置”中选择同机双人或人机对弈、执棋色与难度。近方棋子显示背面、远方棋子显示正面；翻转棋盘后改用另一侧视角。

```powershell
npm.cmd desktop    # 构建网页后启动 Electron（原生引擎）
npm.cmd test       # 规则、资源、IPC/代理与棋子几何测试
npm.cmd build      # 静态网页输出到 dist/web
npm.cmd test:ui    # 使用本机 Edge 运行浏览器与桌面自动化
npm.cmd test:engine-transports  # 引擎通信层测试（Node + 真实浏览器）
npm.cmd check      # 测试、构建、浏览器自动化
```

浏览器自动化默认使用本机 Microsoft Edge，桌面自动化通过 Playwright 启动 Electron，不要求人工点击。首次启动桌面或运行桌面测试时，Electron 可能联网下载运行时；随后可离线启动。

## 发行包

已生成 0.4.0 便携版与网页版：`release/Chess-Demo-0.4.0-x64.exe`（双击启动，无需安装 Node.js，包含写实素材与原生 Stockfish，可离线人机对弈）和 `release/Chess-Web-0.4.0.zip`（静态网页，部署到 HTTP/HTTPS 服务器或子目录，浏览器内 WASM 引擎）。0.3.0 的人机版与 0.2.0 的同机双人版若保留，仅作历史版本。

```powershell
npm.cmd run dist:win       # Windows x64 便携 EXE（含原生引擎、素材与源码资料）
npm.cmd run dist:web       # 静态网页 ZIP（含 WASM 引擎、许可与源码）
npm.cmd run test:release   # 真实 EXE 与网页包在仓库外的离线验收
```

发行包大小与摘要见 [Windows 构建说明](docs/WINDOWS-BUILD.md)。写实棋子已按用户反馈放大，并检查面对面方向、升变候选和窄屏显示；当前游戏截图见 docs/images/。发行包未签名、使用 Electron 默认图标。

## 协作入口

- [工程结构与阶段范围](docs/ARCHITECTURE.md)
- [规则与引擎接口](docs/CONTRACTS.md)
- [Stockfish 资源与验证边界](docs/STOCKFISH-RESOURCES.md)
- [任务回报目录](docs/handoff/README.md)

依赖版本由 package-lock.json 锁定；核心业务代码放在 src/，根目录仅保留项目说明和工具配置。规则库来源：[chess.js](https://github.com/jhlywa/chess.js)，构建工具：[Vite](https://vite.dev/guide/)，桌面运行时：[Electron](https://www.electronjs.org/docs/latest/tutorial/security)，引擎：[Stockfish](https://github.com/official-stockfish/Stockfish)（GPLv3）。
