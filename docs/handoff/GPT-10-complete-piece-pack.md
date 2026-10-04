# 整套面对面写实素材交付

2026-10-04。DS-05 工具验收见 GPT-09；GPT 使用内置 imagegen 补齐其余 14 张透明 PNG，保留最初白马 rear / 黑马 front 原图，16 张独立原图覆盖 24/24 视图槽。所有原图为 1254×1254、8-bit RGBA，没有用程序生成、改色、裁剪或旋转图片。

assets/pieces-manifest.json 为 manifestVersion=2、status=ready，更新每槽尺寸、字节数、SHA-256 与 alpha>16 包围盒；新增 relativeHeight 与渲染基线规格。马和象两种颜色都有独立正反面。王、后、车、兵采用竖轴半周对称造型，GPT 查看后显式为 front/rear 复用同一原图，并写明 sharedViewsReason。DS 无权自行补图或更改这种映射。

验证：

- npm.cmd run check:pieces 严格通过 24/24，真实 Edge 解码验证透明背景和包围盒，全部内容未触及边缘。
- npm.cmd run test:assets 8 项通过；完整素材在 48/64/96px、两种棋格颜色中无破图、无位图变换，320px 无横向溢出。原有严格缺槽 fixture、摘要/路径/视图键/alpha 阈值错误回归仍有效。
- 原有 47 项测试和生产 build 已在 DS-05 修复后通过，见 GPT-09；此次只改素材/清单/文档，不改生产代码。
- 已人工查看所有新增生成图和 docs/images/staunton-v3-pack-preview.png；整套对照图按清单包围盒缩放、统一底座并保留高度差，白下/黑下的马脸与后脑切换符合面对面朝向。图库预览不代表正式棋盘已经接入。

素材包 release/Chess-Pieces-Staunton-v3.zip：12608863 字节，SHA-256 bb9ef7f0365cf2c5e2d120901cb50a73a175db272487f6fc1ec9e075dec51c79。包含 16 张原图、完整 manifest、素材规格与整套预览；旧侧视 v1/v2 未收入。

正式游戏仍是 0.3.0 的占位符号；没有重打游戏 EXE。下一步 docs/tasks/DS-06-realistic-pieces.md：DS 接入现有 PNG、升变候选、翻转朝向与离线静态资源，自动验证并生成 0.4.0 网页/EXE，GPT 再验收视觉和发布包。
