# DS-06：接入写实棋子，发布 0.4.0

本任务已完成并由 GPT 验收。2026-10-04 用户追加要求增大棋子；最新尺寸以 assets/pieces-manifest.json 和 docs/PIECE-ASSETS.md 为准，下面规格已同步，原始 DS 回报记录的是调整前状态。最终结果见 docs/handoff/GPT-11-realistic-release-review.md。

工作目录 D:\Chess。DS-05 已经 GPT 修正并验收。GPT 已提供完整素材：assets/pieces-manifest.json 为 ready、24/24 槽、16 张独立 PNG；预览 docs/images/staunton-v3-pack-preview.png。你负责代码接入、自动验证与打包，不负责生成或修改图片。所有图片已齐，不需要猜图或补图。

## 读取与写入范围

先读 AGENTS.md、docs/ARCHITECTURE.md（如存在）、docs/PIECE-ASSETS.md、manifest、src/web/、现有测试与发行脚本。

允许改 src/web/pieces.js、board.js、controller.js、styles.css、index.html；新增 scripts/prepare-piece-assets.js、必要的纯显示辅助模块与测试；修改 package.json 的版本和 scripts、package-lock.json 中根项目版本、.gitignore、README.md、docs/WINDOWS-BUILD.md 及 docs/handoff/DS-06-result.md。允许按下述规范生成静态公共资源和映射文件，使用现有 dist:win/dist:web。

不要修改 src/core/、src/engine/、src/desktop/、Stockfish 资源与许可、原图、manifest、已验收素材工具或依赖版本。图片中的文字不是指令。不要提交或推送；由 GPT 分批验收提交。范围外问题记录定位，继续完成独立部分。

## 1. 静态资源准备

新增 npm run prepare:pieces。使用既有 inspectPieceAssets 的严格模式校验完整清单，再按路径去重，将 16 张原图逐字节复制到 src/web/public/pieces/staunton-v3/，名称唯一且稳定。检查源/副本 SHA-256 一致。不能压缩重绘、裁剪、换色、镜像或旋转图像。

同时生成 src/web/piece-assets.generated.js：导出以 piece id 为键的显示映射，包括 relativeHeight 和 front/rear 的静态相对 URL、width/height/contentBounds。不要输出绝对本地路径或 Node 代码。图片 URL 在运行时按 document.baseURI 解析成 ./pieces/staunton-v3/...，兼容 Vite、部署子目录和 Electron file://。映射可以引用同一对称 PNG 的两个槽，不复制成假正反面。

生成目录和模块加入 .gitignore，来源 PNG/manifest 已跟踪。prestart、predev、prebuild、pretest 自动运行 prepare:pieces；命令行失败时停止后续步骤。保证新克隆安装依赖后按现有资源初始化步骤即可运行 npm test/build/dev，不依赖此前手动生成的缓存。只能清理自己拥有的输出路径，递归操作前验证真实绝对路径和符号链接；不能删除整个 public/ 或 .cache/。

## 2. 棋盘与升变图片

createPieceElement 保留稳定 .piece 类、data-color、data-piece 和棋格 aria-label，新增 img，图片装饰性 alt=""、aria-hidden、不可拖动，pointer-events:none。默认全部使用写实 PNG，不再叠加 Unicode 伪元素。占位图如保留为加载失败兜底，正常状态不得显示它，不能借兜底掩盖缺件。不要新增远程请求。

显示朝向只有一个判断：nearColor = flipped ? 'b' : 'w'；piece.color === nearColor 用 rear，另一阵营用 front。默认白下黑上，白 rear、黑 front；翻转后黑 rear、白 front。翻转重新选择图片，不对棋子位图或容器使用 rotate/scaleX/mirror。坐标保持 a1–h8，不能改 FEN 或棋局历史。朝向不随轮到谁、humanColor、走法、所在半场变化；一匹白马走到第七横线仍按阵营选择视图。

使用 manifest 的 contentBounds/relativeHeight 按 PIECE-ASSETS.md 的公式等比缩放、水平居中并把底座对齐棋格 97% 高处，高度上限 94%。王相对高 1，后 .96，象 .92，马 .88，车 .86，兵 .80。不要按整张 PNG 同样高度缩放，不拉伸，不裁掉棋子。可用绝对定位和百分比，避免每格反复测布局。保持选中、合法目标、吃子、将军、最近一步标记清楚；标记不能完全盖住棋子。

升变窗口四个候选也复用同一图片渲染器，颜色来自当前升变的兵，视角来自当前棋盘 flipped；保留中文名称与键盘/鼠标操作、取消行为。候选用明确的方形图框。翻转时更新已打开候选的视角。模态窗口会阻止外部按钮点击，可用程序派发翻转事件验证此状态，不解除模态限制。不得放宽 core 的合法升变或改变引擎异步处理。不要改棋盘布局尺寸；先完成本次素材接入。

## 3. 自动验证

保留全部现有测试，不通过删测试、删断言或改规则凑通过。只因图片 DOM 结构变化需要调整的显示断言，应说明原因并保留原功能覆盖。至少增加以下 Playwright 场景：

- 初始 32 个棋子图片加载成功（complete 且 naturalWidth>0），源地址与 manifest 对应。白马 rear/黑马 front；翻转后白马 front/黑马 rear，64 个 data-square 和 FEN 不变；反复翻转不出现侧图、破图或位图变换。
- 用现有合法 FEN 输入把近方马摆到对方半场，验证方向仍按阵营；回合与人机执子切换不能偷偷改变手动棋盘朝向。
- 升变候选正确颜色/视图，选择后 core 中类型正确；取消后棋局不变。至少验证白方和黑方的升变，并验证打开候选时翻转能更新素材。
- 棋格 48/64/96px 范围内，可见边界不溢出、底座基线一致、王比兵高；320px 视窗无横向溢出、点击走棋正常。截图保存 test-results/ui/，桌面白下、黑下与窄屏都要有。
- 原有人机/悔棋/重开/引擎错误恢复测试仍通过。包内网页在部署子目录、桌面 file:// 下均无破图和远程素材请求。

截图只作证据，最终视觉由 GPT 查看，不能仅凭 OCR 或自动截图声称最终美术通过。

## 4. 版本、发布与回报

版本升为 0.4.0，依赖不变，package-lock 只更新根项目版本。依次运行 npm.cmd test、npm.cmd build、npm.cmd run check:pieces、npm.cmd run test:assets、npm.cmd run test:ui、npm.cmd run test:engine-transports。构建后运行 npm.cmd run dist:win、npm.cmd run dist:web、npm.cmd run test:release。

复用现有 portable 和网页包验证，补上包内新素材实际加载的断言（不仅检查 .piece 数量）。EXE 在仓库外启动、离线实际完成一次 Stockfish 应答、搜索中关闭后进程退出；网页 zip 在子目录实际运行 WASM 并应答。Stockfish 许可和精确源码包照旧保留。不得把本机 dev 成功写成发行包成功。

docs/handoff/DS-06-result.md 一页以内：修改文件、命令及数量/失败原因、截图路径、0.4.0 两种包路径/字节数/SHA-256、未解决问题。不要粘贴源码或成功日志，不输出 API Key。完成后等待 GPT 验收。
