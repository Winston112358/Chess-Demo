# DS-06：写实棋子接入与 0.4.0 发布

日期：2026-10-04。按 `docs/tasks/DS-06-realistic-pieces.md` 完成。未修改 src/core、src/engine、src/desktop、Stockfish 资源与许可、原图、manifest、已验收素材工具与依赖版本；未提交或推送。

## 修改文件

- 新增 `scripts/prepare-piece-assets.js`：严格校验 ready 清单（24/24），按路径去重把 16 张原图逐字节复制到 `src/web/public/pieces/staunton-v3/`，复核副本 SHA-256；生成 `src/web/piece-assets.generated.js`（相对 URL、width/height/contentBounds/relativeHeight/rendering，无绝对路径与 Node 代码）。清理前校验真实绝对路径与符号链接，只动自己的输出目录。
- 新增 `src/web/piece-view.js`（纯显示数学：nearColor 视角规则、PERCENT 公式、URL 解析）与 `tests/unit/piece-view.test.js`（24 槽公式、基线 92%、视角规则、URL 解析）。
- `src/web/pieces.js`：`createPieceElement(piece,{flipped})` 输出 `<img>`（alt=""、aria-hidden、不可拖动、pointer-events:none），保留 `.piece`、data-color/data-piece，新增 data-view；缺映射只标记不伪造。`board.js` 传入 flipped；`styles.css` 移除 Unicode 伪元素与字号规则；`controller.js` 升变候选复用同一渲染器（颜色取升变兵、视角取棋盘 flipped，模态打开时翻转即时更新）；`index.html` 升变化为图片候选。
- `.gitignore` 忽略生成目录与生成模块；`package.json` 增 `prepare:pieces`、`prestart/predev/prebuild/pretest` 钩子，版本 0.4.0；lockfile 仅根版本同步。
- `tests/e2e/pieces.spec.js`（7 项）与 release 两个 spec 的素材加载断言；README、WINDOWS-BUILD 更新。

## 命令与结果

- `npm.cmd test`：51 项通过（含 4 项棋子几何/视角单测；pretest 自动 prepare）。
- `npm.cmd run build`：通过；`dist/web/pieces/staunton-v3/` 16 张（12,770,992 字节，副本 SHA-256 与源一致）。
- `npm.cmd run check:pieces`：24/24 通过（严格模式）。
- `npm.cmd run test:assets`：8 项通过；`npm.cmd run test:ui`：32 项通过（原 12 项与全部人机/悔棋/重开/错误恢复测试保留）；`npm.cmd run test:engine-transports`：12 Node + 5 浏览器通过。
- 新增 Playwright 覆盖：32 图加载与源对应、反复翻转只换视角（无 rotate/镜像/破图）、FEN/64 格/revision 不变、敌半场按阵营、回合与执子/模式切换不改朝向、白黑升变候选颜色/视角、模态中翻转更新、取消不变、48–96px 棋格内内容不越界且基线一致、王高于兵、320px 无溢出可走棋、无外部素材请求。
- `npm.cmd run dist:win`、`npm.cmd run dist:web`、`npm.cmd run test:release`：2 项通过。EXE 在仓库外含空格目录离线启动：32 图 file:// 加载、原生 Stockfish 真实应答、搜索中关闭后进程退出；网页 ZIP 在 `/chess-demo/` 子目录运行 WASM 应答并实际请求 pieces PNG，无外部请求、无 pageerror。

## 0.4.0 发行物

- `release/Chess-Demo-0.4.0-x64.exe`：189751149 字节（约 181.0 MiB），SHA-256 `218B6A818B1DF274025F1FF4646523002E2F2318ADBEC1AA468A6FB82F929439`。
- `release/Chess-Web-0.4.0.zip`：14714551 字节（约 14.0 MiB），SHA-256 `E7C08BCB1E6DE5A88F879B2AAABE6BA2DBAC1A6F36A140AF9263ABF33053DC2E`。
- portable 包含时间戳，不保证字节级可复现。

## 截图

`test-results/ui/pieces-white-bottom.png`、`pieces-black-bottom.png`、`pieces-320.png`；`test-results/web-release.png`、`portable-computer.png`。截图仅作证据，最终美术由 GPT 验收。

## 未解决问题

- `scripts/package-web.js` 生成的 README.txt 仍写“写实棋子素材尚未接入”（该脚本不在本任务写入范围，未改）。
- 已验收的 `preview:pieces` 图库页仍标注“未接入正式游戏”，工具冻结未改。
- 原有 FEN 输入接受“双方都被将军”的非法局面，之后引擎会报错并在界面显示可重试错误；属 core/engine 既有边界，记录未改。
- `prepare:pieces` 依赖本机 Edge 做 PNG 解码校验；新克隆按 `npm ci`+`npm run setup:stockfish` 后可自动运行。
