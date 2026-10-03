# GPT-01：工程基础交付

日期：2026-10-03。

完成工程目录、精确依赖与锁文件、规则包装、未来引擎契约、Vite 网页入口、隔离 Node 权限的 Electron 入口、协作规格及 DS-01 任务单。规则接口可以直接用于下一阶段 UI，当前界面仅为启动验证页。

验证结果：

- npm.cmd test：8 项通过，覆盖非法走法无副作用、快照隔离、修订号、升变、易位、吃过路兵、和棋边界与终局。
- npm.cmd run build：通过，产物为 dist/web/。
- npm.cmd run test:ui：网页与 Electron 2 项通过，实际启动并由脚本操作，验证初始状态、重置、无页面异常和桌面 Node 隔离。
- 查看自动化截图 test-results/desktop-shell.png：基础布局与独立 CSS 正常显示。
- npm install 完成时完整依赖审计为 0 vulnerabilities；npm.cmd audit --omit=dev 同样为 0。
- git diff --check：通过。

本阶段没有构建发行 EXE、接入 Stockfish 或生成写实素材。Windows 打包工具留到第三阶段锁定与验收。桌面运行时首次调用可能需要下载，此机器已下载完成。

下一任务：docs/tasks/DS-01-playable-ui.md。DeepSeek 可通过 CLI 和 Playwright 完成，不要求人工鼠标操作或图片生成。
