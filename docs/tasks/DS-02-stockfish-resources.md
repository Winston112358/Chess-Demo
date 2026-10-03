# DS-02：准备并验证固定版本 Stockfish 资源

工作目录 D:\Chess。请直接实现资源准备工具，不改棋盘，不接入人机按钮，不实现游戏搜索状态机。你通过 OpenCode 使用命令行、API 和脚本完成本任务，不需要鼠标操作或图片生成。

## 读取与写入范围

先读 AGENTS.md、package.json、docs/ARCHITECTURE.md、src/engine/contract.js、本任务单。可写：scripts/setup-stockfish.js、scripts/check-stockfish-resources.js、vendor/stockfish/ 下的资源/清单/许可说明、src/web/public/engines/stockfish/ 下的网页资源、tests/resources/、docs/STOCKFISH-RESOURCES.md、docs/handoff/DS-02-result.md。

可更新 .gitignore 来忽略下载缓存、EXE、WASM、源代码归档等生成物；可在 package.json 只增加 setup:stockfish 与 check:stockfish 脚本。不改现有依赖、overrides、build 配置、src/core/、src/desktop/、src/web/ 现有业务代码或 src/engine/contract.js。不自行提交或推送，验收后由 GPT 分批提交。

## 固定输入，不能替换成 latest

原生引擎：

- 官方版本 sf_19，源码 commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`。
- URL：https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip
- ZIP 字节数：81431614。
- ZIP SHA-256：`3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7`。
- 精确源码：https://github.com/official-stockfish/Stockfish/archive/edb0d9db6731067ec50ce619ff372b463bc4dd5d.zip
- 发布说明：https://github.com/official-stockfish/Stockfish/releases/tag/sf_19

网页引擎：

- npm 包 stockfish@19.0.0，选择 lite single-threaded，保留原文件名 `stockfish-19-lite-single.js` / `stockfish-19-lite-single.wasm`。
- npm tarball：https://registry.npmjs.org/stockfish/-/stockfish-19.0.0.tgz
- npm integrity：`sha512-jDyYLbqNpboQcMs5HodTHI2CrKL74zkQWb1+sgoNXw5HI6avTblW4G0X7afFt3BBOc6VbTSkOV64EUxm/DWSpg==`。
- 对应移植源码 commit：`54fde71d90c7c403964f6cacef48f7bbec495df1`。
- 精确移植源码：https://github.com/nmrugg/stockfish.js/archive/54fde71d90c7c403964f6cacef48f7bbec495df1.zip
- 用法与许可：https://github.com/nmrugg/stockfish.js

这些信息已经由 GPT 从官方 GitHub 与 npm 元数据核对。不要依赖未认证 GitHub latest API（可能限流）；固定下载 URL 即可。网页 npm 包约 205 MB 为解包体积，只把 lite single 所需文件放入网页公开资源目录，不能把完整多线程/完整模型引擎都复制进去。

## 实现要求

1. 使用 Node 内置模块实现 CLI；可以调用 Windows 自带 tar.exe。不要增加依赖或安装编译器，不修改上游引擎。
2. 下载到 .cache/stockfish/，使用临时文件；校验固定 ZIP 的大小/SHA-256，以及 npm 包 SHA-512 integrity 后再解包。已有缓存必须验证后才能复用。失败提示具体原因，不留下看似成功的半成品。
3. 解包前检查成员路径；只提取需要的文件，拒绝绝对路径和含 .. 的成员。任何清理只允许经过绝对路径检查的本项目缓存或该任务唯一临时目录，不删除用户其他文件。
4. native 文件放 vendor/stockfish/native/，保留原始上游文件或明确记录重命名后的 stockfish.exe。必须确认使用 Windows x86-64 universal 版本，并保留实际运行需要的 NNUE/其他资源；不要猜测目录结构或只选第一个 EXE。
5. 网页文件放 src/web/public/engines/stockfish/，保持 JS/WASM 相邻、原文件名一致。public 中不放源码 ZIP 或下载缓存。
6. 原生与网页各保留许可、作者信息、对应精确源码归档；vendor/stockfish/manifest.json 记录来源、版本/commit、路径、字节数、SHA-256。下载 archive 的既定 digest/integrity 也写入清单。为后续分发保留源代码资料，不能只留下“GPL”字符串。
7. check 工具校验清单、资源文件、WASM magic/version，实际启动原生引擎并完成 `uci`→`uciok`、`isready`→`readyok`，从 `position startpos moves e2e4` 开始搜索，拿到格式正确的 bestmove。设置小的时间/内存预算、超时和 windowsHide，检查结束后释放进程。不能把几行预制输出当成真正引擎执行。
8. 网页 JS 如果可通过官方支持的 Node CLI 运行，也做一次同样的 UCI 冒烟检查；如未实现浏览器 Worker 执行，回报要明确。生产页面目前 CSP 未开放 WASM 编译，因此本任务不修改生产 CSP、不声称已经接入网页人机对战；该部分由 GPT 后续集成。
9. 把 setup 与 check 命令写入 package.json，文档说明首次下载、缓存复用、失败重试、磁盘/资源体积、许可来源和当前验证边界。

## 验收命令

```powershell
npm.cmd run setup:stockfish
npm.cmd run setup:stockfish  # 再运行应验证并复用本地文件
npm.cmd run check:stockfish
npm.cmd test
npm.cmd build
```

用一个单独的测试文件验证损坏缓存会被拒绝或重新下载，不要破坏正常资源，也不要让测试反复下载整个大包。请报告下载包/实际保留资源的体积，以及原生引擎是否真正返回着法。

完成后写 docs/handoff/DS-02-result.md，列出修改文件、校验结果、原生/网页验证范围和未解决问题。最终简短报告，不重贴完整日志或源码。
