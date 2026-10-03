# Windows 便携版构建与验收

版本 0.2.0，目标 Windows 10/11 x64。开发工具需要 Node.js 22.12+，实际使用 Node.js 24.14.1。

构建：`npm.cmd ci` → `npm.cmd run dist:win`。首次使用 Electron 时下载开发运行时；构建使用已安装的 node_modules/electron/dist，网页先由 Vite 打包。

electron-builder 26.15.3、Electron 44.5.1 固定版本。`overrides` 将下载工具 @electron/get 固定到 5.1.0，与 Electron 使用同一版本，避开旧下载缓存依赖；已通过实际便携构建，完整 npm 审计为 0 项漏洞。更新版本或 overrides 后必须重新实际构建和验收。

输出：

- release/Chess-Demo-0.2.0-x64.exe：单文件便携版，100114556 字节（约 100.11 MB）。
- release/win-unpacked/：构建中间产物。
- dist/web/：独立静态网页产物。

本次便携 EXE 的 SHA-256：`5d2798d5266238764b064919b2c797f262c2822f5290839997f429cd47d7425a`。

生成物不提交到源代码仓库。当前便携包未签名、使用默认 Electron 图标；之后替换写实素材时可一并增加自有图标。当前不包含 Stockfish。

`npm.cmd run test:release` 启动真实便携 EXE（不是开发 electron .），将它复制到系统临时目录下唯一的含空格路径。通过仅用于测试的 CDP 端口验证：

- 包内 file 页面能载入 64 格、32 子；不依赖仓库源码或 node_modules。
- 网络设为离线后重载仍能下棋，e2-e4 后正确轮到黑方。
- 悔棋恢复局面和走棋方；网页不能访问 window.require。
- 无 pageerror，窗口关闭后清理仅本次创建并验证过绝对路径的临时目录。

该测试通过 Playwright 的命令行脚本完成，不依赖人工鼠标操作。测试端口参数只在验收时传入；普通双击启动不启用它。截图位于 test-results/portable-board.png。
