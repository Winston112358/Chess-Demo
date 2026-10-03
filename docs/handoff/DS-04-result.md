# DS-04：可试玩人机对弈（网页与 Windows 0.3.0）

日期：2026-10-03。按 `docs/tasks/DS-04-playable-computer.md` 完成。未修改 src/core、GPT 的 uci-adapter/match-controller/contract、已验收 transport、依赖版本与 overrides。未提交或推送。

## 修改文件

- 新增 `src/web/engine.js`：`createAppEngine()`。普通浏览器用 `createUciAdapter` + `createWorkerTransport`（`new URL('./engines/stockfish/stockfish-19-lite-single.js', document.baseURI)`）；存在 `window.chessEngine` 时必须用 desktop-adapter，版本不符直接报错，不静默回退网页引擎。
- 重写 `src/web/controller.js`：创建一次 GameSession，交给 `createMatchController`，UI 只调用其公开接口；接入模式/执棋色/难度三个带 label 的 select（默认 local/w/normal，只 configure 不 reset）、`#engine-status`（role=status）与 `#engine-retry`（错误→重试电脑走棋，paused→继续电脑走棋）；思考中不阻挡悔棋/重开/切换；电脑回合棋盘与和棋申请不可用；保留升变、FEN、棋谱、翻转、合法目标、和棋与移动端布局；pagehide 时 dispose 并吞掉拒绝。
- `src/web/index.html`、`src/web/styles.css`：新增设置卡片与引擎状态区；CSP 仅补 `script-src 'self' 'wasm-unsafe-eval'` 与 `worker-src 'self'`，其余限制不变。
- 新增 `src/engine/desktop-adapter.js`（browser-only）：转发受限 bridge，AbortSignal→`cancel(requestId)`，取消 barrier 与晚到结果隔离，dispose 幂等且等待服务释放。
- 新增 `src/desktop/preload.cjs`：contextBridge 仅暴露 `window.chessEngine`（protocolVersion=1、search/cancel/dispose），不暴露 ipcRenderer/频道/路径/spawn/UCI。
- 新增 `src/desktop/engine-service.js`：三个 IPC handler，逐项校验 sender、mainFrame 与去掉 hash 的 indexUrl；单搜索、cancel ID 隔离并等待 settle、dispose 清理与 barrier、释放失败明确拒绝后续搜索、幂等移除 handler。
- 修改 `src/desktop/main.js`：sandbox preload、固定原生 EXE（开发 vendor，打包 process.resourcesPath/stockfish/native）、注册服务、before-quit 先释放引擎再有界退出（5 秒上限、防重入）。
- 新增 `tests/unit/engine-service.test.js`、`tests/unit/desktop-adapter.test.js`；新增 `tests/e2e/computer.spec.js`、`tests/e2e/desktop-computer.spec.js`；扩充 `tests/release/portable.spec.js`。
- `package.json`/`package-lock.json`：版本 0.3.0；build.files 增加 `src/engine/**/*`；extraResources 放入 native/web 许可与资料、source 源码归档、manifest；未改依赖、overrides 或其他锁定项。
- 更新 `README.md`、`docs/WINDOWS-BUILD.md`。

## 验证结果

- `npm.cmd test`：43 项通过（规则/资源 + 新增 IPC 服务与 desktop-adapter 单测）。
- `npm.cmd run check`：43 项单测 + 构建 + 23 项 UI 全部通过。原有 12 项（shell/board/review/desktop）保留，新增 10 项人机网页测试与 1 项桌面原生测试。
- `npm.cmd run test:engine-transports`：12 项 Node + 5 项真实浏览器/Worker 通过。
- `npm.cmd run dist:win`：生成 `release/Chess-Demo-0.3.0-x64.exe`，177535516 字节（约 169.3 MiB），SHA-256 `416226AA76E7EE2E3A7F2B5C6F6B02AE54EAA98220276D429B5F20EB478DDAC4`（portable 含时间戳，不保证字节级复现）。
- `npm.cmd run test:release`：通过（真实 EXE 在仓库外含空格目录、离线）。
- 验证后无 Stockfish 残留进程；未结束任何用户其他进程。

## 真实返回着法的范围

- 网页：Edge 中真实 WASM Worker（非 mock）完成 uci/isready 与搜索，人类 e2-e4 后棋谱出现两着并轮到白方；执黑时电脑先走；悔棋、思考中悔棋/重开/切回 local 均不落旧着法；自定义 FEN 可被电脑应手；终局不启动搜索；320px 无溢出、无 pageerror。
- 桌面：Electron 预加载 bridge 存在、window.require 仍为 undefined，原生 Stockfish 在人类 e2-e4 后真实回复；关闭窗口后本次启动的 Stockfish PID 已退出。
- 便携 EXE：断网离线启用 computer 后原生引擎真实回复两着，关闭后引擎 PID 退出，临时目录按绝对路径与名称前缀校验后清理。

## 未解决问题

- 写实棋子素材尚未制作；本任务只完成人机对弈接入，不代表整个项目完成。
- 错误→“重试电脑走棋”的 UI 路径未做端到端测试（需要故意让真实引擎失败；单测已覆盖 adapter/service 的失败与释放路径），paused→“继续电脑走棋”已端到端覆盖。
- 难度为 Skill Level + movetime 组合（easy 300ms / normal 700ms / hard 1500ms / expert 2500ms），不是 Elo 标定；专家档在慢机器上等待更久。
- 网页生产 CSP 已允许 WASM 编译与 Worker，但仍需 HTTP 部署或 Electron 承载；源码 ZIP 只在 vendor/resources 中，public 仅含 lite JS/WASM。
- 新克隆需先运行 `npm run setup:stockfish` 才有引擎二进制/WASM；发布包内已带原生引擎与许可源码资料。
