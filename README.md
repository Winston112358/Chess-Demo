# Chess Demo · 国际象棋

网页与 Windows 客户端共用一个前端。当前支持同机双人、人机对弈（固定版本 Stockfish 19）、合法目标提示、升变、悔棋、翻转、和棋申请、SAN 棋谱及 FEN 局面工具。写实素材尚未制作。

人机对弈使用固定版本引擎：浏览器加载 `stockfish@19.0.0` 的 lite single-threaded WASM，Windows 客户端通过受限 IPC 调用原生 `sf_19` universal 引擎。引擎来源、许可与源码归档见 [Stockfish 资源说明](docs/STOCKFISH-RESOURCES.md)。

## 启动

开发环境：Windows 10/11 x64，Node.js 22.12+（建议 Node.js 24 LTS）。

```powershell
npm.cmd ci
npm.cmd run setup:stockfish   # 首次下载并校验固定版本的 Stockfish 资源
npm.cmd start
```

打开 http://127.0.0.1:5173 。点击当前方棋子查看合法目标，再点击目标走棋；在“对局设置”中选择同机双人或人机对弈、执棋色与难度。

```powershell
npm.cmd desktop    # 构建网页后启动 Electron（原生引擎）
npm.cmd test       # 规则、资源与 IPC/代理测试
npm.cmd build      # 静态网页输出到 dist/web
npm.cmd test:ui    # 使用本机 Edge 运行浏览器与桌面自动化
npm.cmd test:engine-transports  # 引擎通信层测试（Node + 真实浏览器）
npm.cmd check      # 测试、构建、浏览器自动化
```

浏览器自动化默认使用本机 Microsoft Edge，桌面自动化通过 Playwright 启动 Electron，不要求人工点击。首次启动桌面或运行桌面测试时，Electron 可能联网下载运行时；随后可离线启动。关闭开发服务器：在启动它的终端按 Ctrl+C；关闭桌面窗口即可退出 Electron。

## Windows 便携版

已生成 0.3.0 便携版 `release/Chess-Demo-0.3.0-x64.exe`，双击启动，无需安装 Node.js。本版本包含原生 Stockfish，可离线人机对弈；写实素材尚未接入。0.2.0 的 `release/Chess-Demo-0.2.0-x64.exe`（若有保留）只是同机双人版本。

```powershell
npm.cmd run dist:win       # 构建 Windows x64 便携 EXE（含原生引擎与源码资料）
npm.cmd run test:release   # 把真实 EXE 复制到独立临时目录，验证断网人机对弈与退出释放
npm.cmd run dist:web       # 静态网页 ZIP，随附引擎许可与精确源码
```

发行包内 `resources/stockfish/` 包含原生 EXE 与许可、网页引擎许可、两份精确源码归档及 manifest，具体大小与摘要见 [Windows 构建说明](docs/WINDOWS-BUILD.md)。`release/Chess-Web-0.3.0.zip` 是可部署的网页包，解压后将整个目录放到 HTTP/HTTPS 静态服务器，支持根目录与子目录；许可与源码在 `third-party/stockfish/`。不要直接双击 index.html。发行测试同时验证真实 EXE 和解压到独立目录的网页 ZIP。

## 协作入口

- [工程结构与阶段范围](docs/ARCHITECTURE.md)
- [规则与引擎接口](docs/CONTRACTS.md)
- [Stockfish 资源与验证边界](docs/STOCKFISH-RESOURCES.md)
- [任务回报目录](docs/handoff/README.md)

依赖版本由 package-lock.json 锁定；核心业务代码放在 src/，根目录仅保留项目说明和工具配置。规则库来源：[chess.js](https://github.com/jhlywa/chess.js)，构建工具：[Vite](https://vite.dev/guide/)，桌面运行时：[Electron](https://www.electronjs.org/docs/latest/tutorial/security)，引擎：[Stockfish](https://github.com/official-stockfish/Stockfish)（GPLv3）。
