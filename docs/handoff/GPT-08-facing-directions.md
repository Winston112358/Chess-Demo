# 面对面棋子朝向修正

2026-10-04。用户要求双方隔着棋盘面对面：近方朝远方，观察者看到后俯视；远方朝近方，看到前俯视。GPT 的 v1/v2 马头左右侧视图均弃用，不能继续用作当前风格参考。

GPT 使用 imagegen 生成并查看了两张新样张：

- assets/concepts/wn-rear-overhead-v3.png：白马朝远端，后脑、耳背与马鬃可见。
- assets/concepts/bn-front-overhead-v3.png：黑马朝近端，额头、双眼槽与马鼻可见。

两张均为 1254×1254 RGBA PNG，实际 Edge 解码全透明像素约 74.94% / 74.71%，内容没有碰到画布边缘。字节数、SHA-256 和包围盒已写入 manifest。

清单升级为 manifestVersion=2：12 个棋子条目 × front/rear 两个视图槽。当前 2/24、缺 22 槽。白方在下时白 rear/黑 front，黑方在下时黑 rear/白 front；按当前观察端切换原图，不旋转位图，不改变逻辑坐标。棋子跨过棋盘中线不改变阵营朝向。

PIECE-ASSETS.md、ARCHITECTURE.md 与 DS-05 同步。DS 不具备生成图片的能力，任务只要求校验、原图复制、图库及后续接入；任何缺失视图都由 GPT 提供，不让 DS 合成或用 CSS 伪造。

这仍是方向样张阶段，尚未更改生产渲染或重新打包 EXE。完整素材与最终小尺寸辨识度仍待后续验收。
