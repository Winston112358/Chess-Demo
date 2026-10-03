# GPT-04：DS-02 资源阶段验收

日期：2026-10-03。验收结论：经补充校验后通过资源阶段；尚未接入人机对弈。

## DS 成果

按任务范围实现了固定 Stockfish 19 原生资源、stockfish@19.0.0 lite single-threaded JS/WASM、许可与两份精确 commit 源码、可复用缓存的 setup 工具和真实 UCI 检查。没有新增依赖，没有修改棋局或生产 CSP。DS 尚未提交或推送。

## 验收修复

- 原来的校验只遍历清单已有条目，删掉条目会跳过对应文件，空清单可能误报成功。增加必需文件/下载记录、固定版本、摘要/大小、角色/路径、重复项和源码记录一致性校验；setup 写清单、verify-only 和 check 共用它。
- check 在资源验证失败时提前退出，不启动引擎或创建网页执行沙箱。
- 临时目录清理限定为缓存/系统临时目录的直接子目录与本工具命名前缀，并在资源测试中补齐绝对路径检查。
- 新增两项清单回归测试；资源测试加入默认 npm test，文档同步。
- Git 的 core.autocrlf=true 会改变上游文件字节（网页 Copying.txt 在暂存区已出现摘要不一致）。新增 .gitattributes 对上游资源禁用换行转换，重新暂存并逐个核对暂存区原始文件与清单摘要。

## 当前证据

- npm.cmd test：13 项通过（8 项规则 + 5 项资源测试）。
- npm.cmd run check：修复前原有 8 项规则、构建与 12 项网页/桌面测试通过；修复后重新运行 npm test 和资源检查，业务代码未改变。
- npm.cmd run check:stockfish：11 个资源哈希、WASM 头/相邻性、4 个缓存归档通过；原生 Stockfish 19 和 Node CLI 下的 Stockfish 19 Lite WASM 均实际返回合法 e7e5。
- 连续两次 setup:stockfish 均复用缓存，没有下载，manifest.json 文件哈希保持不变。
- 修复后 setup:stockfish -- --verify-only 与网页构建重新通过。
- 验证后未发现 Stockfish 或临时 Node WASM 进程残留。

现有 0.2.0 EXE 是此前同机双人版本，尚未重新发行带引擎的版本。Node CLI 成功不等于浏览器 Worker 已接入，真实浏览器通信交给 DS-03 单独验证。

下一任务：docs/tasks/DS-03-engine-transports.md。只实现通信层；搜索状态机、Electron IPC 安全边界和棋局集成由 GPT 负责。
