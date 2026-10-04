import { createGameSession } from '../core/game-session.js';
import { createMatchController } from '../engine/match-controller.js';
import { createAppEngine } from './engine.js';
import { createBoardView } from './board.js';
import { createPieceElement } from './pieces.js';

const REASON_TEXT = {
  checkmate: '将死',
  stalemate: '逼和',
  'insufficient-material': '子力不足和棋',
  'fivefold-repetition': '五次重复局面和棋',
  'seventy-five-moves': '七十五回合规则和棋',
  'threefold-repetition': '三次重复局面和棋',
  'fifty-moves': '五十回合规则和棋',
};

const RESULT_TEXT = { '1-0': '白方胜', '0-1': '黑方胜', '1/2-1/2': '和棋' };
const CLAIM_TEXT = { 'threefold-repetition': '三次重复局面', 'fifty-moves': '五十回合' };
const COLOR_TEXT = { w: '白方', b: '黑方' };

export function startApp() {
  const session = createGameSession();
  const matchController = createMatchController({
    session,
    createEngine: createAppEngine,
    onChange: handleChange,
  });
  const byId = (id) => document.getElementById(id);

  const boardEl = byId('board');
  const ranksEl = byId('coord-ranks');
  const filesEl = byId('coord-files');
  const turnEl = byId('turn');
  const statusEl = byId('status');
  const lastMoveEl = byId('last-move');
  const moveListEl = byId('move-list');
  const undoBtn = byId('undo');
  const resetBtn = byId('reset');
  const flipBtn = byId('flip');
  const drawClaimsEl = byId('draw-claims');
  const fenInput = byId('fen-input');
  const loadFenBtn = byId('load-fen');
  const copyFenBtn = byId('copy-fen');
  const fenMessageEl = byId('fen-message');
  const fenFallbackEl = byId('fen-fallback');
  const promotionDialog = byId('promotion-dialog');
  const promotionCancelBtn = byId('promotion-cancel');
  const modeSelect = byId('game-mode');
  const humanColorSelect = byId('human-color');
  const difficultySelect = byId('difficulty');
  const engineStatusEl = byId('engine-status');
  const engineRetryBtn = byId('engine-retry');
  const startBtn = byId('start');
  const captureHintsBtn = byId('capture-hints');

  let snapshot = matchController.getSnapshot();
  let state = matchController.getState();
  let selected = null;
  let targets = new Map();
  let flipped = false;
  let pendingPromotion = null;
  let showCaptureHints = true;

  const boardView = createBoardView({ boardEl, ranksEl, filesEl, onSquareClick: handleSquareClick });

  function handleChange(event) {
    const positionChanged = event.snapshot.revision !== snapshot.revision;
    const playerChanged = event.state.mode !== state.mode || event.state.humanColor !== state.humanColor;
    snapshot = event.snapshot;
    state = event.state;
    if (positionChanged || playerChanged || snapshot.outcome) clearTransient();
    render();
  }

  function humanCanAct() {
    return snapshot.outcome === null && (state.mode === 'local' || (state.started && snapshot.turn === state.humanColor));
  }

  function pieceAt(square) {
    const row = 8 - Number(square[1]);
    const column = square.charCodeAt(0) - 97;
    return snapshot.board[row][column];
  }

  function clearSelection() {
    selected = null;
    targets = new Map();
  }

  function clearTransient() {
    pendingPromotion = null;
    clearSelection();
    if (promotionDialog.open) promotionDialog.close();
  }

  function selectSquare(square) {
    const moves = matchController.legalMovesFrom(square);
    if (moves.length === 0) {
      clearSelection();
      render();
      return;
    }
    selected = square;
    targets = new Map();
    for (const move of moves) {
      targets.set(move.to, Boolean(targets.get(move.to)) || Boolean(move.captured));
    }
    render();
  }

  function handleSquareClick(square) {
    if (pendingPromotion || !humanCanAct()) return;
    const piece = pieceAt(square);
    if (selected) {
      if (targets.has(square)) {
        attemptMove(selected, square);
        return;
      }
      if (square === selected) {
        clearSelection();
        render();
        return;
      }
      if (piece && piece.color === snapshot.turn) {
        selectSquare(square);
        return;
      }
      clearSelection();
      render();
      return;
    }
    if (piece && piece.color === snapshot.turn) selectSquare(square);
  }

  function attemptMove(from, to) {
    const result = matchController.tryMove({ from, to });
    if (result.code === 'promotion-required') {
      pendingPromotion = { from, to, color: snapshot.turn };
      promotionDialog.showModal();
      updatePromotionPreviews();
      return;
    }
    clearSelection();
    render();
  }

  function choosePromotion(promotion) {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    pendingPromotion = null;
    clearSelection();
    matchController.tryMove({ from, to, promotion });
    if (promotionDialog.open) promotionDialog.close();
    render();
  }

  function cancelPromotion() {
    clearTransient();
    render();
  }

  function updatePromotionPreviews() {
    if (!promotionDialog.open || !pendingPromotion) return;
    const { color } = pendingPromotion;
    for (const option of promotionDialog.querySelectorAll('[data-promotion]')) {
      option.querySelector('.promotion-piece')?.replaceChildren(
        createPieceElement({ color, type: option.dataset.promotion }, { flipped }),
      );
    }
  }

  function findKingSquare() {
    if (!snapshot.inCheck) return null;
    for (const row of snapshot.board) {
      for (const piece of row) {
        if (piece && piece.type === 'k' && piece.color === snapshot.turn) return piece.square;
      }
    }
    return null;
  }

  function renderTurn() {
    turnEl.dataset.turn = snapshot.turn;
    const waiting = state.mode === 'computer' && !state.started && !snapshot.outcome;
    turnEl.dataset.state = snapshot.outcome ? 'over' : waiting ? 'waiting' : 'playing';
    if (waiting) {
      turnEl.textContent = '待开始';
    } else if (!snapshot.outcome) {
      turnEl.textContent = `${COLOR_TEXT[snapshot.turn]}走棋`;
    } else if (snapshot.outcome.result === '1/2-1/2') {
      turnEl.textContent = '和棋（1/2-1/2）';
    } else {
      turnEl.textContent = `${RESULT_TEXT[snapshot.outcome.result]}（${snapshot.outcome.result}）`;
    }
  }

  function renderStatus() {
    if (snapshot.outcome) {
      statusEl.textContent = `${REASON_TEXT[snapshot.outcome.reason]}，${RESULT_TEXT[snapshot.outcome.result]}。`;
    } else if (state.mode === 'computer' && !state.started) {
      statusEl.textContent = '选好执棋色和电脑难度，点击“开始”后下棋。';
    } else if (snapshot.inCheck) {
      statusEl.textContent = `将军！${COLOR_TEXT[snapshot.turn]}应将。`;
    } else if (state.mode === 'computer' && snapshot.turn !== state.humanColor) {
      statusEl.textContent = state.thinking ? '电脑正在思考，请稍候。' : '等待电脑走棋。';
    } else {
      statusEl.textContent = '点击棋子查看合法目标；再次点击所选棋子或空白处可取消选择。';
    }
  }

  function renderLastMove() {
    const last = snapshot.lastMove;
    lastMoveEl.textContent = last
      ? `最近一着：${last.san}（${COLOR_TEXT[last.color]} ${last.from} → ${last.to}）`
      : '最近一着：暂无';
  }

  function createMoveCell(move) {
    const span = document.createElement('span');
    span.className = move ? 'move-san' : 'move-san move-san--empty';
    span.textContent = move?.san ?? '…';
    if (move === snapshot.lastMove) span.classList.add('move-san--last');
    return span;
  }

  function renderMoveList() {
    const history = snapshot.history;
    if (history.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'move-empty';
      empty.textContent = '尚无着法';
      moveListEl.replaceChildren(empty);
      return;
    }
    const rounds = new Map();
    let fullmove = Number(snapshot.initialFen.split(' ')[5]);
    for (const move of history) {
      if (!rounds.has(fullmove)) rounds.set(fullmove, {});
      rounds.get(fullmove)[move.color] = move;
      if (move.color === 'b') fullmove += 1;
    }
    const rows = [];
    for (const [fullmoveNumber, moves] of rounds) {
      const row = document.createElement('li');
      row.className = 'move-row';
      const number = document.createElement('span');
      number.className = 'move-index';
      number.textContent = `${fullmoveNumber}.`;
      const white = createMoveCell(moves.w);
      const black = createMoveCell(moves.b);
      row.append(number, white, black);
      rows.push(row);
    }
    moveListEl.replaceChildren(...rows);
    // Scroll only the notation container, keeping the board in place on narrow screens.
    moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  function renderDrawClaims() {
    if (!humanCanAct()) {
      drawClaimsEl.replaceChildren();
      return;
    }
    drawClaimsEl.replaceChildren(
      ...snapshot.drawClaims.map((claim) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `claim-${claim}`;
        button.textContent = `申请和棋（${CLAIM_TEXT[claim]}）`;
        button.addEventListener('click', () => {
          matchController.claimDraw(claim);
        });
        return button;
      }),
    );
  }

  function renderEngineStatus() {
    if (state.error) {
      engineStatusEl.textContent = `电脑走棋出错：${state.error}`;
    } else if (state.mode === 'computer' && state.thinking) {
      engineStatusEl.textContent = '电脑思考中…';
    } else if (state.paused) {
      engineStatusEl.textContent = '电脑走棋已暂停。';
    } else {
      engineStatusEl.textContent = '';
    }
    engineStatusEl.classList.toggle('engine-status--error', Boolean(state.error));
    engineRetryBtn.hidden = !(state.error || state.paused);
    engineRetryBtn.textContent = state.error ? '重试电脑走棋' : '继续电脑走棋';
  }

  function renderSettings() {
    if (modeSelect.value !== state.mode) modeSelect.value = state.mode;
    if (humanColorSelect.value !== state.humanColor) humanColorSelect.value = state.humanColor;
    if (difficultySelect.value !== state.level) difficultySelect.value = state.level;
    startBtn.hidden = state.mode !== 'computer';
    startBtn.disabled = state.started || Boolean(snapshot.outcome);
    startBtn.textContent = state.started ? '已开始' : '开始';
    captureHintsBtn.setAttribute('aria-pressed', String(showCaptureHints));
    captureHintsBtn.textContent = `吃子提示：${showCaptureHints ? '开' : '关'}`;
  }

  function syncFen() {
    if (document.activeElement !== fenInput) fenInput.value = snapshot.fen;
  }

  function setFenMessage(text, isError = false) {
    fenMessageEl.textContent = text;
    fenMessageEl.classList.toggle('message--error', isError);
  }

  function render() {
    boardEl.dataset.flipped = String(flipped);
    document.body.dataset.revision = String(snapshot.revision);
    boardView.render(snapshot, { flipped, selected, targets, checkSquare: findKingSquare(), showCaptureHints });
    renderTurn();
    renderStatus();
    renderLastMove();
    renderMoveList();
    renderDrawClaims();
    renderEngineStatus();
    renderSettings();
    updatePromotionPreviews();
    undoBtn.disabled = !snapshot.canUndo;
    syncFen();
  }

  undoBtn.addEventListener('click', () => {
    clearTransient();
    try {
      matchController.undo();
    } catch {
      render();
    }
  });

  resetBtn.addEventListener('click', () => {
    clearTransient();
    setFenMessage('');
    try {
      matchController.reset();
    } catch (error) {
      setFenMessage(error.message, true);
    }
  });

  flipBtn.addEventListener('click', () => {
    flipped = !flipped;
    render();
  });

  loadFenBtn.addEventListener('click', () => {
    clearSelection();
    try {
      matchController.reset({ fen: fenInput.value.trim() });
    } catch (error) {
      setFenMessage(`无法载入该 FEN：${error.message}`, true);
      render();
      return;
    }
    pendingPromotion = null;
    setFenMessage('已载入 FEN 局面。');
    render();
  });

  copyFenBtn.addEventListener('click', async () => {
    const fen = snapshot.fen;
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(fen);
      fenFallbackEl.hidden = true;
      fenFallbackEl.textContent = '';
      setFenMessage('已复制当前 FEN。');
    } catch {
      fenFallbackEl.hidden = false;
      fenFallbackEl.textContent = fen;
      setFenMessage('自动复制不可用，请手动选择下方文本复制。');
    }
  });

  function applySettings() {
    clearTransient();
    try {
      matchController.configure({
        mode: modeSelect.value,
        humanColor: humanColorSelect.value,
        level: difficultySelect.value,
      });
    } catch (error) {
      engineStatusEl.textContent = `设置失败：${error.message}`;
      engineStatusEl.classList.add('engine-status--error');
    }
  }

  modeSelect.addEventListener('change', applySettings);
  humanColorSelect.addEventListener('change', applySettings);
  difficultySelect.addEventListener('change', applySettings);

  startBtn.addEventListener('click', () => matchController.start());
  captureHintsBtn.addEventListener('click', () => {
    showCaptureHints = !showCaptureHints;
    render();
  });

  engineRetryBtn.addEventListener('click', () => {
    try {
      matchController.retry();
    } catch (error) {
      engineStatusEl.textContent = `无法继续：${error.message}`;
      engineStatusEl.classList.add('engine-status--error');
    }
  });

  promotionDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelPromotion();
  });
  promotionDialog.addEventListener('click', (event) => {
    if (event.target === promotionDialog) cancelPromotion();
  });
  promotionCancelBtn.addEventListener('click', cancelPromotion);
  for (const option of promotionDialog.querySelectorAll('[data-promotion]')) {
    option.addEventListener('click', () => choosePromotion(option.dataset.promotion));
  }

  window.addEventListener('pagehide', () => {
    matchController.dispose().catch(() => {});
  }, { once: true });

  render();
}
