# 人机开始按钮与吃子提示验收

2026-10-04，版本 0.4.1。功能提交 bce52d8，未增加依赖或改动棋子原图。

- src/engine/match-controller.js：新增 started 与 start()，人机设置变更进入待开始状态并保留局面；待开始不能走棋或申请和棋，不创建引擎，retry 不能绕过开始。重复开始不重复搜索；修改难度取消旧搜索并保留 epoch/revision 校验、适配器释放屏障。有效重置/FEN 载入后需重新开始；非法 FEN 保留棋局与正在运行的搜索。
- src/web/{controller,board,index,styles}：人机模式显示“开始”及“待开始”；吃子提示为默认开启的本地显示按钮，可立即开关所选棋子的合法可吃目标标记（含吃过路兵），不改变合法走法，重置与翻转不改变开关。
- 测试、CONTRACTS、ARCHITECTURE、README、网页包说明与版本更新；新增 tests/e2e/options.spec.js，既有桌面与两种发行测试改为明确点击开始。

验证：npm.cmd test **57/57**；npm.cmd run build 通过；npm.cmd run test:ui **37/37**；npm.cmd run dist:win 与 node scripts/package-web.js 通过；npm.cmd run test:release **2/2**。首次界面回归发现非法 FEN 输入框未恢复当前 FEN，已补 render 后完整重跑通过，未删除或放宽原断言。

关键证据：两色设置时不提前请求浏览器引擎，桌面待开始不创建 Stockfish PID；重复开始不增加搜索；调整难度后旧应答不落子、再次开始使用最新参数；关闭提示后普通吃子与吃过路兵仍成功。320px 无水平溢出。GPT 已查看 docs/images/chess-0.4.1-waiting.png 与 chess-0.4.1-capture-off-320.png。

真实发行包：EXE 复制到仓库外含空格目录，断网时点击开始后原生 Stockfish 应答，搜索中关闭窗口后本次引擎 PID 退出。网页 ZIP 在独立 HTTP 子目录运行，待开始不请求 WASM，开始后真实应答，许可与精确源码摘要通过，无外部请求或 pageerror。ASAR 中原图摘要与当前前端字节核对一致。

| 文件 | 字节数 | SHA-256 |
| --- | --- | --- |
| release/Chess-Demo-0.4.1-x64.exe | 189754866 | c5d859720b5b4477e1e53cf445c01fda5efc53ec8dcf9cc05e20db13fe3c9bb3 |
| release/Chess-Web-0.4.1.zip | 14715248 | e3e5acd03b3a9c6ab362a050542ab62ba22428a6fb8888bd89c23e11aa593752 |

难度使用同一本地 Stockfish 的 Skill Level 0/8/16/20，分别思考 300/700/1500/2500ms，UCI 实际发送 setoption 与 go movetime。未接入远程大模型走棋，未标定 Elo。原生与 lite WASM 采用相同设置，不承诺棋力完全相同。

业务与发行源码提交远程 Git；发行物、构建缓存仍按 .gitignore 留在本机。EXE 使用默认图标且未签名。
