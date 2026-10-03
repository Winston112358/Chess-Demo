# DS-01：可玩同机双人棋盘交付

日期：2026-10-03。按 `docs/tasks/DS-01-playable-ui.md` 完成，规则接口、快照语义与 CSP 未改动。

## 修改文件

- 新增 `src/web/pieces.js`：临时棋子渲染集中模块。Unicode 符号双层绘制（白棋白色棋身加深色描边，黑棋实心），换 PNG/WebP 只需替换此模块，不触及规则与棋盘坐标。
- 新增 `src/web/board.js`：64 个持久格，固定 `data-square` 实际坐标；合法目标、吃子、选中、将军、最近一着标记；翻转只重排显示顺序。
- 新增 `src/web/controller.js`：点选/重选/取消、调用 `session.tryMove`、升变弹窗（可取消）、悔棋/重置/翻转、SAN 棋谱、和棋申请、FEN 载入与复制、状态与终局文案、按钮禁用同步快照。
- 重写 `src/web/index.html`、`src/web/main.js`、`src/web/styles.css`：浅色大棋盘布局、坐标、顶部走棋方提示、窄屏操作区移至棋盘下方；CSP 原样保留，CSS 仍为独立 link。
- 新增 `tests/e2e/board.spec.js`（8 项交互验收）；升级 `tests/e2e/shell.spec.js`、`tests/e2e/desktop.spec.js` 为棋盘测试，保留启动无错误、重开与桌面 Node 隔离目的。
- 本回报文件。未改动 `src/core/`、`src/engine/`、`src/desktop/`、`package.json`、`package-lock.json`、构建配置。

## 验证结果

- `npm.cmd test`：8 项通过（核心未改动）。
- `npm.cmd run build`：通过，产物 `dist/web/`。
- `npm.cmd run test:ui`：10 项通过（board 8、desktop 1、shell 1），全部由脚本点击/输入完成，浏览器无 pageerror。覆盖：初始 32 子与 64 格、e2-e4 后轮到黑方、e2-e5 非法不改变棋局（revision 不变）；黑方应手后悔棋，棋盘/棋谱/走棋方同步恢复；翻转后按实际坐标继续走棋、重开恢复标准布局；升变先弹窗、取消不落子、选马后 `a8` 为白方马；`7k/P7/8/8/8/8/8/7K w - - 0 1` 选马后核心判子力不足和棋（规则引擎行为，非 UI 判断）；`7k/6Q1/6K1/8/8/8/8/8 b - - 0 1` 显示将死与结果、重开仍可走棋；无效 FEN 保留当前局面并显示原因；三次重复局面出现申请和棋操作并可结束对局；320px 视口无水平溢出、棋盘保持正方形、升变弹窗在视口内。
- 自动化截图（供 GPT 观感验收参考，非人工结论）：`test-results/desktop-board.png`、`test-results/shot-desktop.png`、`test-results/shot-narrow.png`。

## 未解决与说明

- 拖动走子未实现；任务单明确该阶段非必需。
- 最终视觉观感（配色、留白、棋子辨识度）由 GPT 验收；DeepSeek 仅通过截图检查了布局、溢出与白黑棋子可辨识性（白棋改为中心白色棋身加深色描边的双层 Unicode 方案）。
- “重置棋局”恢复标准局面但保留当前棋盘朝向（翻转属显示状态）；如需重置同时回到白方在下，请明确后调整。
- 剪贴板 API 不可用时显示可选中的 FEN 回退文本；桌面 `file://` 下是否可用取决于 Chromium，失败分支已实现。
- 未宣称完成人工桌面点击验收。
