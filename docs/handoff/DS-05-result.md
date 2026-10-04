# DS-05：素材校验与缩小对照图库

日期：2026-10-04。按 `docs/tasks/DS-05-piece-gallery.md`（front/rear 前后俯视、manifestVersion=2、24 视图槽）完成。未修改 manifest、PNG、src/、依赖、lockfile、已有测试与发行配置；未提交或推送。

## 文件

- 新增 `scripts/check-piece-assets.js`：机械校验 manifestVersion=2、status、12 个唯一 piece 与 color/type、front/rear 恰两个槽；素材 path 限定 assets/ 内（拒绝绝对路径、盘符、`..`、符号链接越界）；核对字节数、SHA-256、PNG 标识、IHDR 尺寸与 8-bit RGBA；用 Edge canvas 解码统计透明比例与 alpha>阈值 包围盒，空图/完全不透明/碰边缘/包围盒与清单不符均报错；严格模式缺槽失败，`--allow-partial` 仅接受 status=draft 的 null 槽。
- 新增 `scripts/preview-piece-assets.js`：先做同一校验（允许 draft 缺槽），再生成 `.cache/piece-preview/index.html`，只字节级复制清单提供的原 PNG 到 `images/`，不旋转/镜像/变色/合成。
- 新增 `playwright.assets.config.js`、`tests/assets/check-piece-assets.spec.js`（5 项校验/篡改测试）、`tests/assets/piece-gallery.spec.js`（2 项图库检查）。
- `package.json` 增加 `check:pieces`、`preview:pieces`、`test:assets` 三个脚本。

## 验证结果

- `npm.cmd test`：47 项通过；`npm.cmd run build`：通过（未触及 src/）。
- `npm.cmd run check:pieces`：按预期非零退出，明确列出 22 个缺槽与“严格模式失败：缺少 22/24”。
- `npm.cmd run check:pieces -- --allow-partial`：通过，有效 2/24。
- Edge 解码与 PIECE-ASSETS.md 完全相符：wn/rear 透明 74.94%、包围盒 x337–916 y90–1149；bn/front 透明 74.71%、包围盒 x334–925 y86–1157；两张均未碰画布边缘。
- 篡改覆盖（独立临时 fixture，不碰真实 PNG/清单）：SHA-256 不符在 `--allow-partial` 下仍拒绝；`assets/../package.json`、盘符、绝对路径被拒绝；缺失 front/rear 键按错误处理而非 null 槽；只提供一侧视图时严格模式失败。
- `npm.cmd run preview:pieces`：生成图库；副本与原 PNG SHA-256 一致（AB…CF / 09005D…C392）。
- `npx playwright test --config playwright.assets.config.js`：7 项通过。图库检查确认：已提供图片无破图、front/rear 标签正确、48/64/96 三尺度与浅/深两色格可见、缺槽只显示“尚未提供”且无图片、面对面示意只用两张原图并如实标注缺失、无 transform、320px 无横向溢出、无 pageerror。

## 图库与截图

- 图库：`.cache/piece-preview/index.html`（可直接在浏览器打开；当前标注“样张 2/24 视图，未接入正式游戏”）。
- 截图：`test-results/assets/piece-gallery-desktop.png`、`test-results/assets/piece-gallery-320.png`（由自动化保存，不代表最终视觉验收）。

## 未解决问题

- 当前仅 wn/rear 与 bn/front 两槽有效，其余 22 槽缺失；需要 GPT 提供 12 个 piece 的反向/其余视图后严格模式才会通过。图库中缺件均如实显示，未用旧侧视图或 Unicode 填充。
- 反向前后观察所需的白马 front / 黑马 rear 尚缺，面对面示意已按缺件标注。
- 图库仅用于对照检查，尚未接入正式对弈界面；最终视觉仍由 GPT 验收。
