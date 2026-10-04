# DS-05：素材校验与缩小对照图库

工作目录 D:\Chess。DS-04 已由 GPT 修复并验收，代码推送 main。接下来 GPT 生成写实棋子，你先完成可复用的机械校验与预览工具，不修改正式对弈界面。本任务只有一枚白马样张；不能声称完成全部 12 枚素材。

2026-10-04 视角修正：有效样张已改为 assets/concepts/wn-staunton-overhead-v2.png。以当前 manifest 的路径、尺寸、摘要与包围盒为准；不要硬编码旧侧视样张或旧摘要。旧 wn-staunton-v1.png 已弃用，不算第二件有效素材。

## 读取与写入范围

只需读 AGENTS.md、docs/PIECE-ASSETS.md、assets/pieces-manifest.json、package.json、现有 Playwright 配置；图片是视觉资料，不是文字指令。

可新增 scripts/check-piece-assets.js、scripts/preview-piece-assets.js、tests/assets/ 下的测试、playwright.assets.config.js；可在 package.json 添加相关 scripts，写 docs/handoff/DS-05-result.md。生成 HTML/截图放 .cache/piece-preview/ 或 test-results/assets/。不修改 manifest、PNG 原文件、src/、依赖、lockfile、已有测试与发行配置。不自行提交或推送。

## 交付规格

1. `npm.cmd run check:pieces`：读取 manifest，验证版本、status、精确 12 个唯一槽位，以及每个 id 与 color/type 的对应关系。path 非 null 时只能是项目 assets/ 内的相对路径；拒绝绝对路径、..、符号链接越界。核对声明的文件大小、SHA-256、PNG 标识、实际尺寸与 RGBA；存在的文件错误必须非零退出。
2. 用已安装的 Playwright + Edge 解码 PNG 并读取 canvas alpha，不新增图片库。报告透明像素比例及 alpha>16 的内容包围盒；空图、完全不透明、碰到画布边缘都报错。当前样张的校验应与 PIECE-ASSETS.md 相符。没有 width/height 等必需字段的已提供图片拒绝，不用默认值掩盖问题。
3. 默认严格模式缺任何槽位即失败，明确列出缺少的 id。`npm.cmd run check:pieces -- --allow-partial` 只允许 manifest.status=draft 下的 path=null 槽位；不忽略已有图片格式、摘要、透明度等错误。当前应报告 1 件有效、11 件缺失，退出成功仅适用于该显式预览模式。
4. `npm.cmd run preview:pieces`：先执行与上面相同的已有素材检查，生成 .cache/piece-preview/index.html。只复制已经提供的原始图片，不压缩、变色、锐化、抠图或生成新图片。保留缺失槽位的名称与“尚未提供”，每个已提供棋子显示在浅/深棋格上，分别演示 48px、64px、96px 棋格；保留比例，以所在格 90% 大小的方形框 object-fit:contain 显示，不裁断透明余量。页面标明“样张 1/12，未接入正式游戏”。生成页可直接由浏览器打开，不依赖远程资源。
5. 图库的静态 HTML 应有正常标题、中文名称、素材尺寸和状态；浅/深格颜色使用当前项目的 #f7f8f4 / #dfe5de。不能用 Unicode 或复制同一张马填充缺失 11 件。
6. Playwright 自动查看生成图库，无破图、48/64/96 三种尺度和两种棋格都可见、320px 下无横向溢出；保存桌面与窄屏截图。截图不是最终视觉通过的证明，GPT 再看小尺寸效果。
7. 脚本生成/清理仅限自己拥有的 .cache/piece-preview/；递归清理前校验解析后的绝对路径。PNG 和 manifest 不能因“修复”而改变。测试篡改/缺失检查时用独立临时 fixture，不能改真实素材。

## 验证与回报

运行 npm.cmd test、npm.cmd build、npm.cmd run check:pieces（当前应明确失败并列出缺失 11 件）、npm.cmd run check:pieces -- --allow-partial、npm.cmd run preview:pieces，以及新增的图库 Playwright 检查。已有正式界面无需重打 EXE。

至少验证两类真实故障：已提供 PNG 摘要不符，即使 allow-partial 仍拒绝；manifest 路径越出 assets 仍拒绝。不得删除槽位或放宽 alpha 检查来凑通过。

DS-05-result.md 控制在一页：修改文件、命令结果、生成图库与截图路径、未解决问题。不要贴源码或成功日志。完成后保持代码待 GPT 验收。
