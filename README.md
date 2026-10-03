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

## 后续发行

Windows x64 便携 EXE 的打包工具、发行脚本和资源路径将在第三阶段锁定并实际构建验收；本阶段只安装网页与桌面启动所需依赖。`dist/web/` 是可部署的静态网页目录。

## 协作入口

- [工程结构与阶段范围](docs/ARCHITECTURE.md)
- [规则与引擎接口](docs/CONTRACTS.md)
- [DeepSeek 第一项任务提示词](docs/tasks/DS-01-playable-ui.md)
- [任务回报目录](docs/handoff/README.md)

依赖版本由 package-lock.json 锁定；核心业务代码放在 src/，根目录仅保留项目说明和工具配置。规则库来源：[chess.js](https://github.com/jhlywa/chess.js)，构建工具：[Vite](https://vite.dev/guide/)，桌面运行时：[Electron](https://www.electronjs.org/docs/latest/tutorial/security)。
