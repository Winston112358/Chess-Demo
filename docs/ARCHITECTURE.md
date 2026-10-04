# 工程结构与阶段范围

## 当前结构

| 路径 | 职责 | 主要负责人 |
| --- | --- | --- |
| src/core/game-session.js | 规则包装、局面历史、修订号、终局与和棋判断 | GPT |
| src/web/ | 页面、棋盘绘制、控制器、交互、样式 | DeepSeek 按任务单实现 |
| src/engine/contract.js | 引擎请求与结果契约 | GPT |
| src/engine/uci-adapter.js | UCI 握手、搜索预算、合法性校验、取消与连接清理 | GPT |
| src/engine/match-controller.js | 人机回合、过期结果检查、悔棋与错误恢复 | GPT |
| src/engine/*-transport.js | 原生进程 / 浏览器 Worker 的行通信 | DeepSeek 实现，GPT 验收 |
| src/desktop/main.js | 安全的 Electron 启动和退出 | GPT 定边界，DeepSeek 可承担明确改造 |
| tests/unit/ | 规则和状态边界测试 | GPT |
| tests/e2e/ | 命令行运行的浏览器与桌面自动化 | DeepSeek 可实现，GPT 验收 |
| tests/release/ | 真实便携 EXE 的独立目录与离线验证 | GPT |
| docs/tasks/ | 可直接交给 OpenCode 的任务单 | GPT |
| docs/handoff/ | DeepSeek 简短执行回报 | DeepSeek |
| assets/ | 写实棋子原始素材与来源资料 | GPT 生成，DeepSeek 整理 |
| dist/web/ | 自动生成的静态网页 | 构建工具 |
| release/ | 自动生成的 Windows 发行包 | 构建工具 |

工程使用 JavaScript ESM + JSDoc，依赖锁定到精确版本。Vite 处理浏览器依赖和静态构建；Electron 载入同一份 dist/web，不给网页开放 Node 权限。原生引擎通过受限 IPC 的 search/cancel/dispose 接口接入，主进程校验窗口、主 frame 与本地页面 URL。

## 数据流

用户操作 → web 控制器 → MatchController → GameSession → 新快照 → 棋盘与面板。

GameSession 是唯一的棋局事实来源。UI 可以保存选中格、棋盘朝向、弹窗状态，但不能维护另一套规则棋盘。快照是脱离内部状态的数据，外部修改快照不会改变棋局。

引擎：快照的 initialFen + 完整 UCI 历史 → 引擎搜索 → 带 requestId/revision 的结果 → MatchController 检查是否仍有效 → GameSession.tryMove。重开、悔棋和换边会取消搜索；翻转棋盘只改显示。

## 阶段顺序

1. 工程骨架、可用规则接口、网页/桌面启动和协作规格。
2. 同机双人完整棋盘交互，以临时符号显示棋子，提供可玩的版本。
3. 实际构建便携 EXE，验证资源路径、断网启动与退出。
4. Stockfish：网页 WASM Worker、桌面原生 UCI；难度、取消、超时、历史与结果校验。
5. 写实 Staunton 棋子：统一面对面观察方向、材质、光照与透明背景；双方共 12 类条目，每类 front/rear 两种俯视槽位，先做样张再扩展。近方朝远方使用 rear，远方朝近方使用 front，翻转棋盘切换素材视图。
6. 存档、PGN、体验与视觉完善。
7. 网页包、EXE、素材包、说明、第三方许可与对应源码资料的最终交付。

## 当前阶段与边界

DS-04 已完成并由 GPT 修复边界问题后验收：0.3.0 网页与 Windows 便携版都能与真实 Stockfish 19 对弈，支持执棋色、四档难度、取消、悔棋与错误重试。独立网页 ZIP 与 EXE 均通过仓库外运行验收，桌面离线对弈与思考中退出无引擎残留。有效样张已改为白马后俯视、黑马前俯视；旧侧视样张弃用。DS-05 只准备校验与图库，所有图片由 GPT 生成，完整前/后素材通过后再接入。完整素材、存档与 PGN 尚未实现。

规则包装区别三次重复/50 回合的当前局面申请与五次重复/75 回合的自动和棋，支持常见子力不足判断。预先声明下一着的和棋申请、任意复杂死局的完整证明、PGN 导入历史、计时赛规则不属于第一步；后续必须明确实现范围，不能声称已满足全部赛事裁定。
