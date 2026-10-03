# DS-04：接入可试玩的人机对弈（网页与 Windows）

工作目录 D:\Chess。DS-03 已验收。GPT 已完成 uci-adapter.js 与 match-controller.js；你按接口接入产品、Electron IPC 和发行包，不重写搜索状态机或规则。先完成网页，再完成桌面与发行验收。可使用命令行、API、Playwright；不用人工点击或生成图片。

## 读取与写入范围

先读 AGENTS.md、docs/CONTRACTS.md、docs/handoff/GPT-05-engine-review.md、src/engine/{contract,uci-adapter,match-controller,native-transport,worker-transport}.js、src/web/ 现有入口、src/desktop/main.js、package.json、发行测试。

可写：src/web/controller.js、index.html、styles.css，新增 src/web/engine.js、src/engine/desktop-adapter.js、src/desktop/preload.cjs、src/desktop/engine-service.js；修改 src/desktop/main.js。可新增 tests/unit/ 下的 IPC/proxy 测试、tests/e2e/computer.spec.js、desktop-computer.spec.js，扩充 tests/release/portable.spec.js。可更新 package.json/lockfile 的版本与 build、README.md、docs/WINDOWS-BUILD.md，并写 docs/handoff/DS-04-result.md。

不改 src/core/、GPT 的 uci-adapter/match-controller/contract、已验收 transport、其他现有测试、依赖版本、overrides、素材、用户配置。不删除现有测试、不自行提交/推送。范围外问题记录定位并继续独立工作。

## 网页接入

1. src/web/engine.js 导出 createAppEngine()。普通浏览器创建 createUciAdapter，createTransport 使用 createWorkerTransport，workerUrl=new URL('./engines/stockfish/stockfish-19-lite-single.js', document.baseURI)。桌面 bridge 存在时必须使用下述 desktop-adapter；版本不符/失败要报错，不能偷偷换成网页引擎。保持上游 JS/WASM 原文件名。
2. 创建一次 GameSession，交给 createMatchController({session,createEngine:createAppEngine,onChange})；之后 UI 只调用 matchController 的公开接口。沿用 getSnapshot/legalMovesFrom/tryMove/undo/reset/claimDraw；onChange 更新页面快照、思考/错误/暂停状态。已有升变、FEN、棋谱、翻转、合法目标、和棋与手机布局必须保留。不要直接导入 chess.js 到 src/web/ 或重写取消逻辑。
3. 增加三个带 label 的 select：#game-mode（local 同机双人 / computer 人机对弈）、#human-color（w 我执白 / b 我执黑）、#difficulty（easy 入门 / normal 普通 / hard 困难 / expert 专家）。用 COMPUTER_LEVELS 的定义，默认 local/w/normal。设置只 configure，不暗中 reset；重置按钮单独新开标准棋局。
4. #engine-status（role=status）显示电脑思考、错误或暂停；#engine-retry 在错误/paused 时出现，分别显示“重试电脑走棋”/“继续电脑走棋”，点击 retry。思考期间可悔棋、重开、换模式/执棋方/难度；电脑回合不能点击落子或申请和棋。不要把 reset/undo 全部锁住。保留现有棋盘朝向独立于执棋方。
5. 每次改棋局或改模式/执棋方取消待升变弹窗与选中格；升变取消不改变棋局。页面关闭时 dispose，并处理可能的拒绝，不能出现未处理 Promise。思考/错误刷新不能让棋盘跳动或滚动页面。
6. 生产 CSP 只补 script-src 'self' 'wasm-unsafe-eval' 和 worker-src 'self'，其余限制保留。不开 unsafe-eval/unsafe-inline，不使用远程脚本，不添加服务端 AI API。

## 桌面安全接口（按此实现，不暴露 UCI 或 Node）

preload.cjs 使用 sandbox preload 可用的 require('electron') 与 contextBridge，仅暴露 window.chessEngine：protocolVersion=1、search(request)→invoke('chess:search',request)、cancel(requestId)→invoke('chess:cancel',requestId)、dispose()→invoke('chess:dispose')。不暴露 ipcRenderer、通用频道、文件路径、spawn 或 send(line)。保持 sandbox/contextIsolation=true、nodeIntegration=false、禁止导航和新窗口。

engine-service.js 可不直接 import Electron，导出 registerEngineService({ipcMain,webContents,indexUrl,createEngine}) 供主进程和单元测试注入。createEngine 是主进程提供的固定原生 createUciAdapter 工厂，renderer 不能提供工厂、路径或命令。服务返回幂等 async dispose() 用于主进程关闭。

- 每个 handler 先检查 event.sender===webContents、event.senderFrame===webContents.mainFrame，并检查 frame.url 去掉 hash 后等于 indexUrl（主进程 indexPath 的 pathToFileURL 结果）；其他窗口、子 frame、远程来源均拒绝。不能只检查 URL 字符串。
- 服务只允许一个进行中的 search。请求直接交给 GPT 的 adapter.search，保留所有字段验证与合法性检查；不要转换成任意用户提供的 UCI。每次搜索有主进程自己的 AbortController，完成结果保留 requestId/revision。
- cancel 只取消 requestId 匹配的当前搜索，并等待该搜索 Promise settle（取消的错误可吞掉）。不匹配的 ID 不影响当前请求；不能误取消后来的请求。
- chess:dispose 取消当前搜索、释放 adapter，并清空该实例。用 cleanup barrier 确保后续 search 等待释放再创建新实例，释放失败明确拒绝后续搜索。最终服务 dispose 还要停止接收新请求、移除三个 handler，清理幂等。
- 主进程固定 executablePath：开发模式用 vendor/stockfish/native/stockfish-windows-x86-64-universal.exe；app.isPackaged 时用 process.resourcesPath 下 stockfish/native/ 同名 EXE。必须绝对路径，无 shell，不接收 renderer 的路径或 args。缺资源错误提示运行 setup:stockfish。
- 关闭窗口/退出应用必须先取消、等待释放原生引擎，再退出。before-quit 可 preventDefault 并在清理结束后调用 app.quit，设置防重入标志；不能立即退出留下 Stockfish。清理异常要记录并按有界清理流程处理，不能无限卡住关闭。

desktop-adapter.js 是 browser-only，导出 createDesktopAdapter(api)，返回同一 search/dispose 接口：search 转发受限 API，AbortSignal 触发 cancel(requestId)，调用方立即收到 AbortError，旧 IPC 结果不能再 resolve 该搜索。用取消 barrier 让下一次 search 等待 cancel ack；等待期间再检查 signal/disposed，不能取消后又发送新请求。race 的底层 IPC Promise 必须有拒绝处理；清理 listener，dispose 幂等且等待服务释放。不直接访问 Electron/Node，不把 raw UCI 给页面。测试异步晚到结果、取消前后、dispose、释放失败和频道限制。

## 发行

- 版本改为 0.3.0，同步 package-lock.json 中根版本，其他依赖/锁定项不变。
- build.files 增加 src/engine/**/*（主进程用的模块需要入包）。用 extraResources 把 vendor/stockfish/native/ 的 EXE/许可/作者/README、vendor/stockfish/web/ 的许可/README/package.json、vendor/stockfish/source/ 的两份精确源码归档与 manifest.json 放到 resources/stockfish 对应目录。保留实际 NNUE 资源；当前 universal EXE 网络已内嵌。不要把缓存、node_modules 下载包、完整 npm 多版本引擎放进去，也不修改项目自身 license 字段。
- 网页构建继续含 lite JS/WASM；说明网页资源许可与源码在哪，不把源码 ZIP 塞进 public。最终网页发行附件由 GPT 完成。
- 更新试玩/构建说明，区分旧 0.2.0 同机双人 EXE 与新的 0.3.0 人机版。不要预写未验证的大小/摘要或“发布成功”。

## 验收（必须真实走棋）

1. 默认 npm test 与现有 12 项 UI 检查都保留。新增 IPC 服务单测：非法 sender/frame/url 被拒绝，单搜索、cancel ID 隔离、dispose 清理与 barrier。新增 desktop-adapter 单测：晚到结果不应用，取消后可重新搜索，失败/释放无未处理拒绝。
2. 网页 Playwright：选择 computer，我执白 e2-e4 后等待电脑真实回复，棋谱两着且轮到白；我执黑新局电脑走白；悔棋回到可下的局面，思考中重开/切回 local 后旧着法不落盘。至少一项自定义 FEN 用非标准起点，终局不启动搜索。等待实际棋谱/状态，不用 sleep 推断成功，不 mock 引擎着法。验证移动端无横向溢出、无 pageerror。
3. Electron：预加载 bridge 存在、window.require 仍 undefined；在原生引擎上完成相同的人类一着 + 电脑回复。关闭后确认本次启动的 Stockfish PID 已退出，不结束用户其他 Node/Electron 进程。
4. portable.spec.js 保留仓库外含空格目录、离线、棋盘与 Node 隔离检查；新增 0.3.0 EXE 离线启用 computer 后实际回复并检查退出释放。只清理经绝对路径检查的本测试独有临时目录。
5. 运行 npm.cmd test、npm.cmd run check、npm.cmd run test:engine-transports、npm.cmd run dist:win、npm.cmd run test:release。记录测试数量、EXE 大小与 SHA-256、真实网页与桌面/portable 是否都成功返回着法及无残留进程。

完成后写 docs/handoff/DS-04-result.md：修改文件、验证结果、真正可试玩的范围、未解决问题。最终简短报告，不贴完整源码或日志。写实素材还未制作，不声称完成整个项目。
