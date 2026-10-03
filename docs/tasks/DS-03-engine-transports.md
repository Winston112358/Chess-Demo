# DS-03：Stockfish 原生进程与浏览器 Worker 通信层

工作目录 D:\Chess。DS-02 已由 GPT 验收。请直接完成本任务，只实现“发送一行 UCI、接收一行 UCI、报告错误、释放资源”的底层通信。此阶段不做走棋按钮、搜索状态机、Electron IPC 或素材。你可使用命令行和 Playwright，不需要人工点击。

## 读取与写入范围

先读 AGENTS.md、src/engine/contract.js、docs/STOCKFISH-RESOURCES.md、docs/handoff/GPT-04-stockfish-review.md、package.json、playwright.config.js。

可新增 src/engine/native-transport.js、src/engine/worker-transport.js、tests/engine/ 下的 Node 测试与假进程夹具、tests/engine-browser/ 下的浏览器测试、playwright.engine.config.js、docs/handoff/DS-03-result.md。可在 package.json 只增加 test:engine-transports 脚本，执行 Node 通信测试再执行独立浏览器测试。不修改现有 test/check、依赖、lockfile、build、其他生产文件或 contract.js，不提交或推送。范围外问题记录后继续可独立完成的工作。

## 唯一接口

两个模块都导出工厂，直接返回 EngineLineTransport（见 contract.js），创建时就注册回调：

```js
// Node-only，之后由 Electron 主进程调用；不能导入浏览器入口。
createNativeTransport({ executablePath, args = [], onLine, onError })

// Browser-only，classic Worker；URL 由调用方传入。
createWorkerTransport({ workerUrl, onLine, onError })

// 返回值，两者一致：
{ send(line), async dispose() }
```

- executablePath 是调用方提供的绝对路径；不扫描目录、不猜 EXE、不调用 shell、不允许通过参数换成远程引擎。单元测试可传入自建假进程的绝对路径。真实测试使用 manifest 里的 native-exe。
- workerUrl 为 string 或 URL，真实测试指向 /engines/stockfish/stockfish-19-lite-single.js；WASM 保持同名相邻。不复制、修改、eval 上游文件，不改生产 CSP。
- onLine 接收单独的非空文本行，去掉 CR/LF。原生 stdout 必须处理分块、半行和一次到达多行；关闭时处理最终未带换行的非空尾行。浏览器 message 数据为字符串，按换行拆分；没有换行的消息也立即交付。不把 stderr 当作协议输出。
- send 只接受非空 string，拒绝含 CR/LF 的输入；调用方提供完整 UCI 单行，保持原内容，加一个换行后写入原生 stdin，Worker 则 postMessage 原字符串。无效参数抛 TypeError；故障或 dispose 后调用抛 Error。
- 工厂不是搜索器，不自动发送 uci/isready/go，不解释 bestmove，不改变棋局、不安排多次搜索。
- onError 接收 Error，报告启动/读写错误、意外退出、Worker error/messageerror；每个实例的终止性故障至多回调一次。捕获 stdin 的异步错误，不能因 EPIPE 令父进程异常退出。原生诊断只保留最多 8 KiB stderr，附到错误即可。
- dispose 第一次调用就停止向调用方发送任何回调；多次调用返回同一个完成结果，保证幂等。原生发送 quit，最多等 1 秒，未退出则 kill，再最多等 1 秒；仍无法释放则 reject，不能声称清理成功。spawn 失败也能 dispose。Worker 立即 terminate；清理事件监听与计时器，不能留下进程、Worker 或活跃计时器。原生必须 windowsHide: true。
- 不实现 Electron preload/main 修改；原始 UCI 发送接口以后只供内部使用，不直接暴露给 renderer。

## 自动化验收

1. Node 假进程测试覆盖 stdout 半行/多行/CRLF/最终尾行、stderr 不串入协议、非法 send、启动失败与意外退出只报告一次、故障后拒绝发送、dispose 幂等、dispose 后无回调，以及不响应 quit 时被强制结束。可使用 process.execPath 启动 .cjs 假进程；若需要 args 注入，仅供 Node 内部工厂的可选参数 args=[]，不得增加 shell。不要用睡眠时间推断成功，等待实际输出、退出事件并设置测试超时。
2. 原生真实资源冒烟：使用工厂完成 uci→uciok、isready→readyok，position startpos moves e2e4 后 go movetime 300，用 chess.js 检查 bestmove 合法，finally dispose。资源缺失时明确提示先运行 npm run setup:stockfish；不要返回预制结果或静默跳过。
3. 独立 Playwright 配置沿用项目 msedge、单 worker、127.0.0.1:5173 开发服务可复用的设置，testDir 为 tests/engine-browser。测试夹具可通过 page.route 提供独立 HTML，或通过 Vite 的 /@fs/ 路径导入 worker-transport.js。夹具 CSP 允许 script-src 'self' 'wasm-unsafe-eval'、worker-src 'self'、connect-src 'self'，只在测试夹具中使用，不改生产页面。
4. 真实浏览器通过 createWorkerTransport 启动公开 JS/WASM，完成相同 UCI 握手和一次合法着法搜索。记录 pageerror/加载失败；真实网络资源加载应成功，不能 mock 引擎消息。用假 Worker 单独验证错误只报告一次、多行消息和 dispose 取消回调；真实测试验证 dispose 后 send 抛错。可以在 page.evaluate 内驱动模块，不要求人工操作。
5. 任何递归清理必须先校验绝对目标处于本任务唯一临时目录及指定前缀，不碰正常缓存和安装资源。

运行 npm.cmd test、npm.cmd build、npm.cmd run test:engine-transports。测试不得反复下载大包，不增加依赖。不要为过关修改原有测试。

完成后写 docs/handoff/DS-03-result.md：修改文件、检查结果、原生和真实浏览器分别是否返回合法着法、故障/清理测试、未解决问题。最后简短报告；不要重贴整份源码和日志。
