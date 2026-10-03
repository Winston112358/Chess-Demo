# DS-04 验收与修复

2026-10-03。结论：修复后第四阶段通过。DS 初版实现了真实网页/桌面人机对弈，未提交或推送；写实素材与整个项目的最终交付仍待后续阶段。

## 修复与补验

- desktop-adapter 的 active 必须在 await 前占位，避免两个同时调用都进入 IPC；取消监听必须覆盖等待 barrier 的阶段，发出请求前再次检查取消。同步双请求、发出前取消的两项新增回归在旧版失败；现在通过。
- engine-service 在异步创建适配器期间释放，原实现漏掉尚未返回的实例。新增回归先失败；现在先取消并等待该搜索，再收集实例进行 dispose。
- bridge 的 cancel 失败后阻止新搜索，仍执行后端 dispose；不能吞掉取消失败后继续重叠搜索。等待取消确认时再次取消，调用方立即收到 AbortError。
- before-quit 的防重入仍需 preventDefault：重复退出请求不能绕过正在进行的清理。清理完成或达到有界退出条件才允许 app.quit。
- 换模式、执棋方或局面时关闭待升变弹窗并清理选中格。补了界面回归。
- 实际阻断 Worker JS 加载，验证错误保留当前棋局，恢复加载后点击重试由真实 WASM 返回回复。
- Electron 与便携 EXE 都在第二次真实搜索进行中关闭，并检查本次启动的 Stockfish PID 退出。
- 首轮将 UI 与 portable 测试并行运行，共用 test-results 导致 trace 被另一套测试清除。已将 UI、engine、release 输出目录分开，并顺序执行桌面验收；复跑通过。
- 新增 dist:web 与真实网页 ZIP 验收：引擎文件、许可与精确源码随附，解压到独立临时目录核对摘要，以 HTTP 子目录实际对弈。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| npm.cmd run check | 47 项单测、Vite 构建、25 项 UI 通过 |
| npm.cmd run test:engine-transports | 12 项 Node 与 5 项真实浏览器测试通过 |
| npm.cmd run dist:win | 当前 0.3.0 便携 EXE 构建成功 |
| npm.cmd run dist:web | 当前 0.3.0 静态网页 ZIP 构建成功 |
| npm.cmd run test:release | 仓库外离线 EXE、HTTP 子目录网页 ZIP 两项通过 |
| git diff --check | 通过 |

EXE：177530628 字节，SHA-256 `4e11e6a2a0d531e42d2729fbb083e6e22f5cdca95ac217b4914fd3911520c432`。
网页 ZIP：2300674 字节，SHA-256 `23d883e49c8315a106d130fbf72a0a298c59c61764c05f1de3efa95d7b195b0b`。
已查看实际发行截图：test-results/portable-computer.png、web-release.png。操作与布局可用；当前 Unicode 棋子是占位素材，白子细节和材质不是最终视觉验收结果。

DS-04-result.md 保留 DS 当时的报告与旧构建摘要；修复后以本文件及 WINDOWS-BUILD.md 为准。依赖与 overrides 未改变，lockfile 仅同步根版本。EXE 未签名，使用默认 Electron 图标；难度组合不等于 Elo 标定。
