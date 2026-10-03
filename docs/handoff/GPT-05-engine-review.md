# GPT-05：DS-03 验收与共用搜索/对局控制器

日期：2026-10-03。DS-03 经修复后通过；生产页面仍为同机双人模式。

## DS 成果与验收修复

原生进程和 classic Worker 通信按接口实现，未越界修改生产入口、依赖或 CSP。真实原生 Stockfish 与浏览器 JS/WASM 均完成握手和合法着法搜索。

修复 Worker 在 onLine 中 dispose 后仍交付同一消息后续行的问题；dispose 立即清理/terminate。补上同步 postMessage 异常的终止状态、原生 stdout/stderr 读取错误监听、长期假进程测试的 finally 清理。对应浏览器回归测试已加入。

## GPT 继续完成

- src/engine/uci-adapter.js：验证请求、保留起始 FEN 与完整 UCI 历史，限制 Skill Level 0–20、movetime 100–5000ms；握手/就绪/搜索超时；正常搜索复用进程或 Worker；取消时退休连接并忽略旧回调，下一搜索等待清理；实际校验 bestmove 合法性，清理失败不会继续创建新引擎。
- src/engine/match-controller.js：唯一通过 GameSession 改棋局，取消与 epoch/revision/requestId 检查，人类执黑时自动启动电脑、人机悔棋、第一着撤回后的暂停、错误后的 retry、终局停止和显式升变。界面尚未引用它。
- 默认测试新增状态/取消/过期/非法结果用例；真实原生与浏览器均验证共用搜索器连续两次搜索且只创建一个引擎实例。

## 当前验证

- npm.cmd test：31 项通过。
- npm.cmd run test:engine-transports：12 项 Node + 5 项真实浏览器/Worker 检查通过。
- npm.cmd run build：通过；生产入口未改变，仍是 0.2.0 同机双人版本。

下一任务 docs/tasks/DS-04-playable-computer.md：按规定实现 UI、受限 Electron IPC、原生资源打包和真实人机验收。写实棋子留待素材阶段，不能宣称已完成整体项目。
