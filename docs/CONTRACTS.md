# 规则与引擎接口 v1

## 导入与生命周期

```js
import { createGameSession } from '../core/game-session.js';
const session = createGameSession();
// 自定义起点：createGameSession({ fen: '合法 FEN' })
```

构造或 reset 的 FEN 无效时抛出异常，调用方显示可理解的错误。reset 在验证通过后才替换现有棋局。

## 公共方法

| 方法 | 返回与行为 |
| --- | --- |
| getSnapshot() | 返回脱离内部状态的新快照 |
| legalMovesFrom(square) | 返回该格当前合法着法；无效格、非当前方、终局返回空数组 |
| tryMove({ from, to, promotion? }) | 成功返回 `{ok:true,snapshot}`；失败返回 `{ok:false,code,snapshot,choices?}` |
| undo() | 撤回一着，成功返回 `{ok:true,snapshot}`，无历史返回 code `no-history` |
| reset({ fen? } = {}) | 返回新快照；不传 FEN 时恢复标准初始局面 |
| claimDraw(reason) | 申请当前快照 drawClaims 中的一项，返回与 tryMove 同形式的结果 |

失败码：`illegal-move`、`promotion-required`、`game-over`、`no-history`、`draw-unavailable`。

升变必须显式选择 q/r/b/n（后/车/象/马）。当返回 `promotion-required` 时，`choices` 是允许的选项；尚未改变棋局。UI 显示弹窗，选定后携带 promotion 再调用 tryMove。取消弹窗不会落子。

## 快照字段

```js
{
  revision: 0,
  initialFen: '...',
  fen: '...',
  turn: 'w',                  // w 白方，b 黑方
  board: [/* 8 行，每行 8 格 */],
  history: [/* 完整着法描述 */],
  lastMove: null,              // 无历史时 null
  inCheck: false,
  outcome: null,               // 或 {result, reason}
  drawClaims: [],              // 当前可申请的和棋理由
  canUndo: false
}
```

- board[0] 是第 8 横线，board[7] 是第 1 横线；每行由 a 到 h。
- 格子为 null，或 `{square, type, color}`。type 为 p/n/b/r/q/k。
- 着法描述包含 color/from/to/piece/san/uci，吃子时包含 captured，升变时包含 promotion。
- SAN 用于显示棋谱；UCI 用于引擎和恢复历史，二者不能混用。
- 成功走棋、撤回、reset、申请和棋都会递增 revision；失败不会。重开也不归零，便于识别过期搜索。
- outcome.result 为 `1-0`、`0-1` 或 `1/2-1/2`；reason 为 `checkmate`、`stalemate`、`insufficient-material`、`fivefold-repetition`、`seventy-five-moves` 或申请的和棋理由。
- drawClaims 可包含 `threefold-repetition` 和 `fifty-moves`。UI 不自行重复计算这些条件。

## 界面状态边界

白方在下：显示 a8…h8 到 a1…h1；黑方在下：显示 h1…a1 到 h8…a8。每个 DOM 格保留实际坐标 `data-square`，不能使用显示数组下标推算走棋坐标。

点击/拖动只产生 `{from,to,promotion?}`。每次成功改变棋局，重新读取快照并渲染。悔棋、重开、载入 FEN、终局后清空选中格与待升变状态。FEN 导入只知道起点，不含此前历史；不能推断导入前的重复局面次数。

## 未来引擎契约

正式字段见 src/engine/contract.js。请求携带 requestId、revision、initialFen、moves、moveTimeMs、skillLevel；结果返回 requestId、revision、bestMove。

`search(request, {signal})` 返回 Promise；`dispose()` 释放 Worker 或本机进程。控制器必须检查请求标识与 revision、校验着法合法性。引擎接口本阶段仅定义，不能通过随机着法伪装 Stockfish。

参考：[chess.js](https://jhlywa.github.io/chess.js/)、[FIDE 基本规则与和棋条款](https://handbook.fide.com/chapter/e012023)。
