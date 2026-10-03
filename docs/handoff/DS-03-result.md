# DS-03：Stockfish 原生进程与浏览器 Worker 通信层

日期：2026-10-03。按 `docs/tasks/DS-03-engine-transports.md` 完成，只实现“发送一行、接收一行、报错一次、释放资源”。未做走棋按钮、搜索状态机、Electron IPC、素材；未修改 contract.js、现有测试、依赖、lockfile、build 或生产页面 CSP。未提交或推送。

## 修改文件

- 新增 `src/engine/native-transport.js`：Node-only 工厂 `createNativeTransport({ executablePath, args = [], onLine, onError })`，`spawn` 无 shell、`windowsHide: true`；stdout 处理分块/半行/多行/CRLF，关闭时交付无换行尾行；stderr 仅作诊断（最多 8 KiB，附到错误）；stdin 异步错误（含 EPIPE）不会令父进程崩溃；终止性故障按实例至多回调一次；`dispose` 幂等，发送 quit 等待 1 秒、超时 kill 再等 1 秒、仍无法释放则 reject，spawn 失败也能释放。
- 新增 `src/engine/worker-transport.js`：Browser-only 工厂 `createWorkerTransport({ workerUrl, onLine, onError })`，classic Worker；字符串消息按换行拆分、无换行立即交付；Worker error/messageerror 只报告一次；`dispose` 立即 terminate、移除监听、幂等；dispose 或故障后 `send`/非法参数行为与原生一致。
- 新增 `tests/engine/fixtures/fake-engine.cjs` 与 `tests/engine/native-transport.test.js`（10 项假进程测试）、`tests/engine/native-smoke.test.js`（真实原生资源冒烟）。
- 新增 `playwright.engine.config.js`（testDir `tests/engine-browser`、msedge、单 worker、复用 5173 开发服务）与 `tests/engine-browser/worker-transport.spec.js`（真实 WASM Worker + 假 Worker 各一项）。
- `package.json` 仅新增 `test:engine-transports`（Node 通信测试后执行独立浏览器测试）。

## 检查结果

- `npm.cmd test`：13 项通过（未改动的规则与资源测试）。
- `npm.cmd run build`：通过。
- `npm.cmd run test:engine-transports`：Node 11 项通过，Playwright 2 项通过（约 10 秒）。运行后无引擎或假进程残留。

## 原生与真实浏览器结果

- 原生：读取 `vendor/stockfish/manifest.json` 的 native-exe 真实启动，`uci`→`uciok`、`isready`→`readyok`、`position startpos moves e2e4` + `go movetime 300` 得到 `bestmove`，经 chess.js 校验合法；`finally` 中 dispose。缺资源时会以“请先运行 npm run setup:stockfish”失败，不跳过。
- 真实浏览器：测试夹具（仅测试用 CSP：`script-src 'self' 'wasm-unsafe-eval'`、`worker-src 'self'`、`connect-src 'self'`）通过 `/@fs/` 导入 `worker-transport.js`，用真实 `/engines/stockfish/stockfish-19-lite-single.js` + 同名相邻 WASM 完成 `uci`→`uciok`、`isready`→`readyok`、`go movetime 300`，chess.js 校验 `bestmove` 合法；记录到 JS 与 WASM 都被实际请求且无失败、无 pageerror，未 mock 任何引擎消息。dispose 后 `send` 抛错。

## 故障与清理测试

- 假进程：CRLF/多行/半行拼接、最终无换行尾行、stderr 不串入协议且随退出附到错误、空串/多行/非字符串 send 抛 TypeError、启动失败与意外退出各只报告一次、故障后拒绝发送、退出竞态写入不崩溃且至多一次、dispose 幂等且不再回调、忽略 quit 的进程被强制结束（用 pid 存活检查确认）。
- 假 Worker：多行与无换行消息交付、boom 只报一次错误、故障后 send 抛错、dispose 幂等并阻止后续回调。
- 无递归清理逻辑；测试不写系统临时目录（夹具为仓库内固定文件），未触碰缓存与安装资源。

## 未解决问题

- Windows 下无法稳定让子进程 stdin 产生真实 EPIPE（关闭读端后写入仍被缓冲），因此以“进程已退出时的竞态写入”覆盖“异步 stdin 错误不崩溃、至多一次”；stdin 的 `error` 监听仍在原生 transport 中保留。
- 生产页面 CSP 仍不允许 WASM 编译，`worker-transport.js` 尚未被任何生产入口引用；Electron 主进程接入与搜索状态机由 GPT 后续完成。
- `tests/engine*` 只在 `test:engine-transports` 中运行；`npm test` 的脚本按任务约束未改动。
