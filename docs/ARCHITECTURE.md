# 工程结构与阶段范围

## 当前结构

| 路径 | 职责 | 主要负责人 |
| --- | --- | --- |
| src/core/game-session.js | 规则包装、局面历史、修订号、终局与和棋判断 | GPT |
| src/web/ | 页面、棋盘绘制、控制器、交互、样式 | DeepSeek 按任务单实现 |
| src/engine/contract.js | 引擎请求与结果契约 | GPT |
| src/desktop/main.js | 安全的 Electron 启动和退出 | GPT 定边界，DeepSeek 可承担明确改造 |
| tests/unit/ | 规则和状态边界测试 | GPT |
| tests/e2e/ | 命令行运行的浏览器与桌面自动化 | DeepSeek 可实现，GPT 验收 |
| tests/release/ | 真实便携 EXE 的独立目录与离线验证 | GPT |
| docs/tasks/ | 可直接交给 OpenCode 的任务单 | GPT |
| docs/handoff/ | DeepSeek 简短执行回报 | DeepSeek |
| assets/ | 写实棋子原始素材与来源资料，待素材阶段建立 | GPT 生成，DeepSeek 整理 |
| dist/web/ | 自动生成的静态网页 | 构建工具 |
| release/ | 自动生成的 Windows 发行包 | 构建工具 |

工程使用 JavaScript ESM + JSDoc，依赖锁定到精确版本。Vite 处理浏览器依赖和静态构建；Electron 载入同一份 dist/web，不给网页开放 Node 权限。未来原生引擎通过受限 IPC 接口接入。

## 数据流

用户操作 → web 控制器 → GameSession → 新快照 → 棋盘与面板。

GameSession 是唯一的棋局事实来源。UI 可以保存选中格、棋盘朝向、弹窗状态，但不能维护另一套规则棋盘。快照是脱离内部状态的数据，外部修改快照不会改变棋局。

未来引擎：快照的 initialFen + 完整 UCI 历史 → 引擎搜索 → 带 requestId/revision 的结果 → 控制器检查是否仍有效 → tryMove。任何重开、悔棋和换边操作都必须先取消搜索。

## 阶段顺序

1. 工程骨架、可用规则接口、网页/桌面启动和协作规格。
2. 同机双人完整棋盘交互，以临时符号显示棋子，提供可玩的版本。
3. 实际构建便携 EXE，验证资源路径、断网启动与退出。
4. Stockfish：网页 WASM Worker、桌面原生 UCI；难度、取消、超时、历史与结果校验。
5. 写实 Staunton 棋子：统一角度、材质、光照和透明背景，共白黑双方 12 件；先做样张再扩展。
6. 存档、PGN、体验与视觉完善。
7. 网页包、EXE、素材包、说明、第三方许可与对应源码资料的最终交付。

## 当前阶段与边界

第一步工程基础、第二步同机双人界面和第三步 Windows 便携发行已完成。真实 EXE 通过仓库外启动与断网走棋测试。没有 Stockfish、棋力分档、联网对弈或生成的写实素材；下一任务由 DeepSeek 准备固定版本引擎资源，再由 GPT 实现取消、过期结果检查和对局集成。

规则包装区别三次重复/50 回合的当前局面申请与五次重复/75 回合的自动和棋，支持常见子力不足判断。预先声明下一着的和棋申请、任意复杂死局的完整证明、PGN 导入历史、计时赛规则不属于第一步；后续必须明确实现范围，不能声称已满足全部赛事裁定。
