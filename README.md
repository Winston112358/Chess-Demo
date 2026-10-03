# Chess Demo · 国际象棋

网页与 Windows 客户端共用一个前端。当前支持同机双人、合法目标提示、升变、悔棋、翻转、和棋申请、SAN 棋谱及 FEN 局面工具。Stockfish 和写实素材尚未接入。

## 启动

开发环境：Windows 10/11 x64，Node.js 22.12+（建议 Node.js 24 LTS）。

```powershell
npm.cmd ci
npm.cmd start
```

打开 http://127.0.0.1:5173 。点击当前方棋子查看合法目标，再点击目标走棋。

```powershell
npm.cmd desktop    # 构建网页后启动 Electron
npm.cmd test       # 规则与状态边界测试
npm.cmd build      # 静态网页输出到 dist/web
npm.cmd test:ui    # 使用本机 Edge 运行浏览器自动化
npm.cmd check      # 测试、构建、浏览器自动化
```

浏览器自动化默认使用本机 Microsoft Edge，桌面自动化通过 Playwright 启动 Electron，不要求人工点击。首次启动桌面或运行桌面测试时，Electron 可能联网下载运行时；随后可离线启动。关闭开发服务器：在启动它的终端按 Ctrl+C；关闭桌面窗口即可退出 Electron。

## Windows 便携版

已生成 `release/Chess-Demo-0.2.0-x64.exe`，双击启动，无需安装 Node.js。本版本支持同机双人，尚未接入 Stockfish 和写实素材。

```powershell
npm.cmd run dist:win       # 构建 Windows x64 便携 EXE
npm.cmd run test:release   # 把真实 EXE 复制到独立临时目录，验证断网启动与走棋
```

便携版已实际在仓库外启动、断网重载、走棋与悔棋通过；单文件约 100 MB。发行包当前未签名，使用 Electron 默认图标。`dist/web/` 是可部署的静态网页目录。详细构建记录见 [Windows 构建说明](docs/WINDOWS-BUILD.md)。

## 协作入口

- [工程结构与阶段范围](docs/ARCHITECTURE.md)
- [规则与引擎接口](docs/CONTRACTS.md)
- [DeepSeek 第一项任务提示词](docs/tasks/DS-01-playable-ui.md)
- [DeepSeek 下一项 Stockfish 资源任务](docs/tasks/DS-02-stockfish-resources.md)
- [任务回报目录](docs/handoff/README.md)

依赖版本由 package-lock.json 锁定；核心业务代码放在 src/，根目录仅保留项目说明和工具配置。规则库来源：[chess.js](https://github.com/jhlywa/chess.js)，构建工具：[Vite](https://vite.dev/guide/)，桌面运行时：[Electron](https://www.electronjs.org/docs/latest/tutorial/security)。
