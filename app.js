import { BOARDS, TYPES, NAMES, newGame, label, sideName, canMove, draw, deploy, move, hasMove, canDeployDirectly, deployDirectly } from './game.js';

import { silhouette, animateTurn } from './pieces.js';
import { setupBoardZoom } from './board-view.js';
import { applyComputerAction, winningActions } from './computer.js';
import { SAVE_KEY, encodeGame, decodeGame } from './local-game.js';

let state = newGame();
let opponent = 'computer';
let difficulty = 'standard';
let storageAvailable = true;
let restored = false;
try {
  const saved = decodeGame(localStorage.getItem(SAVE_KEY));
  if (saved) { ({ state, opponent, difficulty } = saved); restored = true; }
} catch { storageAvailable = false; }
let computerWorker = null;
let computerTimer = null;
let thinking = false;
let computerError = '';
let restartOpponent = opponent;
let threatPly = -1, threats = [];
let selected = null;
let moving = false;
let busy = false;
let resultAnnounced = false;
let restartMode = state.mode;
let cells = [];
let room = null;
let networkBusy = false;
let networkHealthy = true;
let roomError = '';
let pollTask = null;
let focused = false;
const $ = (id) => document.getElementById(id);
const resetBoardZoom = setupBoardZoom($('board-scroll'), $('zoom-board'), $('zoom-out'), $('zoom-reset'), $('zoom-value'));
const coord = (i) => `${String.fromCharCode(65 + i % state.cols)}${Math.floor(i / state.cols) + 1}`;
const pieceMarkup = (p, extra = '') => `<span class="piece ${p.side} ${extra}">${label(p)}${extra.includes('embodied') ? silhouette(p.type) : ''}</span>`;

function buildBoard() {
  const { cols, rows } = state;
  const board = $('board');
  board.style.setProperty('--cols', cols);
  board.style.aspectRatio = `${cols}/${rows}`;
  board.dataset.mode = state.mode;
  board.setAttribute('aria-label', `${cols}列${rows}行棋盘`);
  const lines = [];
  for (let x = 0; x < cols; x++) lines.push(`M${x*100+50} 50V${rows*100-50}`);
  for (let y = 0; y < rows; y++) lines.push(`M50 ${y*100+50}H${cols*100-50}`);
  const river = state.mode === 'xiangqi' ? '<rect class="river-bg" x="52" y="453" width="796" height="94"/><text x="250" y="513" text-anchor="middle">楚河</text><text x="650" y="513" text-anchor="middle">汉界</text>' : '';
  board.innerHTML = `<svg class="board-lines" viewBox="0 0 ${cols*100} ${rows*100}" preserveAspectRatio="none" aria-hidden="true"><path d="${lines.join(' ')}"/>${river}</svg>`;
  cells = Array.from({ length: cols * rows }, (_, index) => {
    const button = document.createElement('button');
    button.className = 'cell'; button.type = 'button';
    button.addEventListener('click', () => play(index));
    button.addEventListener('keydown', (event) => {
      const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
      if (!(event.key in shifts)) return;
      event.preventDefault();
      const next = index + shifts[event.key];
      if (next >= 0 && next < cells.length && (Math.abs(shifts[event.key]) === cols || Math.floor(next / cols) === Math.floor(index / cols))) cells[next].focus();
    });
    board.append(button);
    return button;
  });
  board.insertAdjacentHTML('beforeend', `<svg class="winning-connection" viewBox="0 0 ${cols*100} ${rows*100}" preserveAspectRatio="none" aria-hidden="true"><line id="winning-connection" /></svg>`);
  resetBoardZoom();
}

function hint(message) { $('action-hint').textContent = message; }

function saveLocal() {
  if (room) return;
  try { localStorage.setItem(SAVE_KEY, encodeGame(state, opponent, difficulty)); storageAvailable = true; }
  catch { storageAvailable = false; }
}
function cancelComputer() {
  clearTimeout(computerTimer); computerTimer = null;
  computerWorker?.terminate(); computerWorker = null; thinking = false; computerError = '';
}
function scheduleComputer() {
  if (room || opponent !== 'computer' || state.turn !== 'black' || state.result || busy || networkBusy || thinking || computerError) return;
  thinking = true;
  const currentState = state, ply = state.ply;
  computerTimer = setTimeout(() => {
    const fail = () => {
      cancelComputer(); computerError = '电脑暂时未能落子，点击重试继续，棋局已保留。'; render();
    };
    try {
      computerWorker = new Worker(new URL('./computer-worker.js', import.meta.url), { type: 'module' });
      computerWorker.onerror = fail;
      computerWorker.onmessage = async ({ data }) => {
        if (state !== currentState || state.ply !== ply || room || opponent !== 'computer') return;
        if (data.error || !data.action) { fail(); return; }
        cancelComputer();
        try {
          applyComputerAction(state, data.action);
          saveLocal(); busy = true; render();
          await animateTurn($('board'), cells, state.history.at(-1), pieceMarkup);
        } catch { computerError = '电脑暂时未能落子，点击重试继续，棋局已保留。'; }
        finally { busy = false; render(); }
      };
      computerWorker.postMessage({ state, difficulty });
    } catch { fail(); }
  }, 350);
}

async function play(index) {
  if (state.result || inputLocked()) return;
  setFocus(true);
  const previousPly = state.ply;
  try {
    if (state.pending) {
      if (room) { await sendAction({ type: 'deploy', to: index }); return; }
      deploy(state, index);
      selected = null; moving = false;
    } else if (!moving && selected === null && !state.board[index] && canDeployDirectly(state)) {
      if (room) { await sendAction({ type: 'deploy-directly', to: index }); return; }
      deployDirectly(state, index);
      selected = null; moving = false;
    } else if (selected !== null && canMove(state.board, selected, index, state.cols)) {
      if (room) { await sendAction({ type: 'move', from: selected, to: index }); return; }
      move(state, selected, index);
      selected = null; moving = false;
    } else if (state.board[index]?.side === state.turn) {
      selected = selected === index ? null : index;
      moving = selected !== null;
    } else {
      hint(selected !== null ? '不能走到这里，请选择标记位置。' : moving ? '请先点己方棋子，再点标记位置移动；再次点移动按钮可取消。' : '请先抽子，或选择棋盘上自己的棋子。');
      return;
    }
    if (state.ply !== previousPly) {
      saveLocal();
      busy = true; render();
      try { await animateTurn($('board'), cells, state.history.at(-1), pieceMarkup); }
      finally { busy = false; render(); }
    } else render();
  } catch (error) { hint(error.message); }
}

function inputLocked() {
  return busy || networkBusy || Boolean(!room && opponent === 'computer' && state.turn === 'black') || Boolean(room && (!networkHealthy || !room.joined || room.side !== state.turn || room.restartVotes.length));
}

function render() {
  scheduleComputer();
  const ended = Boolean(state.result);
  const side = state.turn;
  const direct = !moving && selected === null && canDeployDirectly(state);
  document.body.dataset.turn = side;
  document.body.dataset.result = state.result || '';
  const last = state.history.at(-1);
  $('play-mode').value = opponent;
  $('play-mode').disabled = busy || Boolean(room) || networkBusy;
  $('difficulty').value = difficulty;
  $('difficulty').hidden = opponent !== 'computer' || Boolean(room);
  $('difficulty').disabled = busy || thinking;
  $('difficulty-hint').hidden = $('difficulty').hidden;
  $('difficulty-hint').textContent = {
    practice: '简易也会防连五、避送子，适合熟悉攻防。',
    standard: '兼顾连线与吃子，计算对手的反击。',
    hard: '更深入计算连续攻防与交换，复杂局面需思考数秒。',
  }[difficulty];
  $('match-label').textContent = room ? '好友对弈' : opponent === 'computer' ? '单人挑战 · 你执红' : '双人同屏';
  $('save-status').textContent = room ? '好友房间 · 自动同步' : !storageAvailable ? '浏览器未允许保存，请勿关闭本页' : `${restored ? '已续上次棋局 · ' : ''}本机自动保存`;
  $('computer-retry').hidden = !computerError;
  if (threatPly !== state.ply) {
    threatPly = state.ply;
    const enemy = side === 'red' ? 'black' : 'red';
    threats = ended ? [] : winningActions({ ...state, pending: null, turn: enemy }, enemy);
  }
  $('board-mode').disabled = busy || Boolean(room);
  $('room-open').disabled = busy || networkBusy;
  $('new-game').disabled = busy || networkBusy || Boolean(room && (!room.joined || !networkHealthy));
  $('board').setAttribute('aria-busy', String(busy || thinking));
  cells.forEach((cell, i) => {
    const p = state.board[i];
    const legal = !ended && selected !== null && canMove(state.board, selected, i, state.cols);
    const threat = threats.some((action) => action.to === i);
    cell.className = ['cell', selected === i ? 'selected' : '', legal ? (p ? 'capture-target' : 'legal-target') : '', last?.to === i ? 'last-play' : '', state.winningLine.includes(i) ? 'winning' : '', threat ? 'threat-target' : '', (state.pending || direct) && !p ? 'deploy-target' : ''].filter(Boolean).join(' ');
    cell.innerHTML = p ? pieceMarkup(p, 'embodied') : '';
    cell.setAttribute('aria-label', `${coord(i)} ${p ? sideName(p.side) + label(p) : '空位'}${legal ? '，可' + (p ? '吃子' : '移动') : ''}${threat ? '，对方下一手可在此成五' : ''}`);
    cell.setAttribute('aria-pressed', String(selected === i));
    cell.disabled = ended || inputLocked();
  });
  const connection = $('winning-connection');
  connection.parentElement.style.display = state.winningLine.length ? '' : 'none';
  if (state.winningLine.length) {
    for (const [n, index] of [[1, state.winningLine[0]], [2, state.winningLine.at(-1)]]) {
      connection.setAttribute(`x${n}`, index % state.cols * 100 + 50);
      connection.setAttribute(`y${n}`, Math.floor(index / state.cols) * 100 + 50);
    }
  }
  for (const player of ['red', 'black']) {
    const pool = state.pools[player];
    const onBoard = state.board.filter((p) => p?.side === player).length;
    const captured = 16 - pool.length - onBoard - (state.pending?.side === player ? 1 : 0);
    const card = $(`${player}-player`);
    card.classList.toggle('active', side === player && !ended);
    card.innerHTML = `<div class="player-heading">${pieceMarkup({ side: player, type: 'king' })}<div><h3>${sideName(player)}<span>${player === 'red' ? '先手' : '后手'}</span></h3><p>场上 ${onBoard} <span>·</span> 被吃 ${captured}</p></div><span class="turn-badge">${ended ? '已结束' : side === player ? '当前回合' : '等待中'}</span></div><div class="pool">${TYPES.map((type, index) => {
      const count = pool.filter((p) => p === type).length;
      return `<div class="pool-piece ${count ? '' : 'depleted'}" aria-label="${NAMES[player][index]}剩余${count}枚"><span>${NAMES[player][index]}</span><small>${count}</small></div>`;
    }).join('')}</div><div class="pool-total">待入场 <b>${pool.length}</b> 枚</div>`;
  }
  const outcome = state.result === 'draw' ? '本局和棋' : `${sideName(side)}五子成势`;
  const computerTurn = !room && opponent === 'computer' && side === 'black';
  $('turn-label').textContent = ended ? outcome : computerTurn ? '电脑思考中…' : `${sideName(side)}${!room && opponent === 'computer' ? ' · 轮到你' : state.ply === 0 ? '先行' : '行棋'}`;
  $('turn-count').textContent = ended ? `共 ${state.ply} 手` : `第 ${String(state.ply + 1).padStart(2, '0')} 手`;
  $('action-side').textContent = ended ? 'MATCH COMPLETE' : `${side.toUpperCase()}'S TURN`;
  $('action-title').textContent = ended ? outcome : state.pending ? `${label(state.pending)}已入手，请落子` : selected !== null ? `移动「${label(state.board[selected])}」` : moving ? '选择一枚己方棋子' : direct ? '点击空位，直接上场' : '落子，或走子';
  $('action-description').textContent = ended ? (state.result === 'draw' ? '当前玩家没有可用行动。再来一局吧。' : '五枚相连，胜负已定。好棋，下一局见。') : state.pending ? '点击任意空点部署，落子后轮到对方。' : selected !== null ? '实心圆点可移动，红圈位置可吃子。' : direct ? '点击空位随机抽子并部署，或选择己方棋子移动。也可先抽子查看。' : '抽取一枚棋子入场，或移动棋盘上的己方棋子。';
  $('draw-preview').innerHTML = state.pending ? `${pieceMarkup(state.pending, 'drawn')}<div><strong>${sideName(side)} · ${label(state.pending)}</strong><small>已锁定部署 · 请选择空位</small></div>` : ended ? `<span class="mystery-piece result-symbol">${state.result === 'draw' ? '和' : '胜'}</span><div><strong>${outcome}</strong><small>共 ${state.ply} 手 · 本局结束</small></div>` : '<span class="mystery-piece">?</span><div><strong>下一枚，会是什么？</strong><small>从剩余棋池中随机抽取</small></div>';
  $('draw-button').disabled = inputLocked() || ended || Boolean(state.pending) || !state.pools[side].length || !state.board.some((p) => !p);
  $('draw-button').firstElementChild.textContent = state.pending ? `已抽到「${label(state.pending)}」· 点空位` : !state.pools[side].length ? '棋池已空' : '抽子入场';
  $('move-button').disabled = inputLocked() || ended || Boolean(state.pending) || !hasMove(state);
  $('move-button').classList.toggle('is-active', moving);
  hint(ended ? '点击「重新开局」开始下一场对弈。' : state.pending ? '本回合只能部署，落子后不能再移动。' : selected !== null ? '再次点击选中棋子可取消选择。' : moving ? '点击自己的棋子，查看可走的位置。' : direct ? '点空位随机落子，点己方棋子选择移动。' : '抽子后须完成部署，不能重抽。');
  const movement = { rook: '车：横竖直走，不能越子。', horse: '马：走日字，直行相邻有子会蹩腿。', elephant: '象：斜走两格，中间有子不能走。', advisor: '士：斜走一格，不限九宫。', king: '将帅：横竖一格，被吃不直接判负。', cannon: '炮：直走，吃子须恰好隔一子。', pawn: '兵卒：上下左右一格，可以后退。' };
  $('coach-hint').textContent = computerError || (ended ? '目标达成后可以换棋盘，或挑战更谨慎的电脑。' : computerTurn ? '电脑与您使用相同棋池、相同走子规则。' : selected !== null ? movement[state.board[selected].type] : threats.length ? '警惕金圈：对方下一手可成五！堵住落点，或吃掉连线中的棋子。' : state.ply < 4 ? '点空位随机上场，点己方棋子移动；同色横、竖、斜连五就赢。' : '连五才能获胜，吃将不算赢。点己方棋子，查看绿点走法与红圈吃子。');
  const historyMarkup = (events) => events.slice().reverse().map((event) => `<li><span class="move-number">${String(event.ply).padStart(2, '0')}</span><span class="record-piece ${event.side}">${label(event.piece)}</span><span>${event.action === 'deploy' ? '部署' : event.captured ? `吃${label(event.captured)}` : '移动'} <small>${event.action === 'move' ? coord(event.from) + ' → ' : ''}${coord(event.to)}</small></span><span class="record-side">${sideName(event.side)}</span></li>`).join('');
  const empty = '<li class="empty-history">棋盘尚静，等你落下第一子。</li>';
  $('history').innerHTML = historyMarkup(state.history.slice(-5)) || empty;
  $('full-history').innerHTML = historyMarkup(state.history) || empty;
  $('history-count').textContent = state.ply;
  renderRoom();
  $('result-banner').hidden = !ended;
  $('result-title').textContent = state.result === 'draw' ? '本局和棋' : `${sideName(side)}获胜！`;
  $('result-description').textContent = room?.restartVotes.length ? `${sideName(room.restartVotes[0])}已申请重开，等待另一方同意。` : `共 ${state.ply} 手${state.result === 'draw' ? '，当前无可用行动。' : '，五子连线，胜负已定。'}${room ? '双方同意后开始下一局。' : '再来一局，重新开战。'}`;
  $('result-restart').disabled = busy || networkBusy || Boolean(room && (!room.joined || !networkHealthy || room.restartVotes.includes(room.side)));
  $('result-restart').textContent = !room ? '再来一局' : room.restartVotes.includes(room.side) ? '等待好友同意' : room.restartVotes.length ? '同意重开' : '申请再来一局';
  if (!ended) resultAnnounced = false;
  else if (!busy && !resultAnnounced) {
    resultAnnounced = true;
    $('result-banner').focus({ preventScroll: true });
    $('result-banner').scrollIntoView({ block: 'nearest' });
  }
  $('announcement').textContent = `${$('turn-label').textContent}。${$('action-title').textContent}。${last ? `上一手${sideName(last.side)}${label(last.piece)}到${coord(last.to)}。` : ''}`;
}

$('draw-button').addEventListener('click', () => {
  if (inputLocked()) return;
  setFocus(true);
  if (room) { void sendAction({ type: 'draw' }); return; }
  try { draw(state); selected = null; moving = false; saveLocal(); render(); }
  catch (error) { hint(error.message); }
});
$('move-button').addEventListener('click', () => { if (inputLocked()) return; setFocus(true); moving = !moving; selected = null; render(); });
$('rules-open').addEventListener('click', () => $('rules-dialog').showModal());
$('rules-close').addEventListener('click', () => $('rules-dialog').close());
function requestRestart(mode, nextOpponent = opponent) {
  if (busy) return;
  restartMode = mode;
  restartOpponent = nextOpponent;
  $('restart-description').textContent = `当前棋局将被清空，开始${nextOpponent === 'computer' ? '单人挑战（你执红）' : '双人同屏'}，使用 ${BOARDS[mode].cols}×${BOARDS[mode].rows} 棋盘。双方恢复各 16 枚棋子，红方先手。`;
  if (room) $('restart-description').textContent = '好友房间需双方同意重开。申请期间暂停走子，任一方可取消申请。';
  $('restart-dialog').showModal();
}
function resetGame(mode, nextOpponent = opponent) {
  cancelComputer(); opponent = nextOpponent; restored = false; threatPly = -1;
  state = newGame(mode); selected = null; moving = false;
  $('board-mode').value = mode;
  saveLocal(); buildBoard(); render();
}
$('play-mode').addEventListener('change', () => {
  const next = $('play-mode').value; $('play-mode').value = opponent;
  if (state.ply || state.pending) requestRestart(state.mode, next);
  else resetGame(state.mode, next);
});
$('difficulty').addEventListener('change', () => { difficulty = $('difficulty').value; saveLocal(); render(); });
$('computer-retry').addEventListener('click', () => { computerError = ''; render(); });
$('new-game').addEventListener('click', () => requestRestart(state.mode));
$('result-restart').addEventListener('click', () => {
  if (busy || networkBusy || !state.result) return;
  if (room) void sendAction({ type: 'restart' });
  else { resetGame(state.mode); cells[0].focus({ preventScroll: true }); }
});
$('board-mode').addEventListener('change', () => {
  const mode = $('board-mode').value;
  $('board-mode').value = state.mode;
  if (state.ply || state.pending) requestRestart(mode);
  else resetGame(mode);
});
$('restart-cancel').addEventListener('click', () => $('restart-dialog').close());
$('restart-confirm').addEventListener('click', () => {
  $('restart-dialog').close();
  if (room) void sendAction({ type: 'restart' });
  else resetGame(restartMode, restartOpponent);
});
$('history-open').addEventListener('click', () => $('history-dialog').showModal());
$('history-close').addEventListener('click', () => $('history-dialog').close());

document.addEventListener('contextmenu', (event) => event.preventDefault());
const mobile = matchMedia('(max-width: 760px), (max-width: 1100px) and (max-height: 500px)');
function arrangeControls() {
  const panel = document.querySelector('.action-panel');
  (focused ? document.querySelector('.header-actions') : document.body).append($('history-open'));
  if (mobile.matches || focused) {
    document.querySelector('.board-section').insertBefore(panel, document.querySelector('.board-topline'));
    document.querySelector('.board-settings').append($('new-game'));
  } else {
    document.querySelector('.right-rail').prepend(panel);
    document.querySelector('.left-rail').append($('new-game'));
  }
}
function setFocus(value) {
  if (focused === value) return;
  focused = value;
  document.body.classList.toggle('play-focus', focused);
  $('focus-toggle').textContent = focused ? '设置' : '开始';
  $('focus-toggle').setAttribute('aria-pressed', String(focused));
  $('focus-toggle').setAttribute('aria-label', focused ? '返回设置，保留当前棋局' : '开始专注游玩');
  arrangeControls(); resetBoardZoom();
}
$('focus-toggle').addEventListener('click', () => setFocus(!focused));
mobile.addEventListener('change', arrangeControls);
arrangeControls(); $('board-mode').value = state.mode; buildBoard();
setFocus(Boolean(state.ply || state.pending));

// Room requests are serialized with animations; polling never races a local action.
function validSnapshot(data) {
  const s = data?.state, config = BOARDS[s?.mode];
  const validPiece = (p) => p && ['red', 'black'].includes(p.side) && TYPES.includes(p.type);
  const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < s.board.length;
  return config && s.cols === config.cols && s.rows === config.rows &&
    Array.isArray(s.board) && s.board.length === s.cols*s.rows && s.board.every((p) => p === null || validPiece(p)) &&
    ['red', 'black'].includes(s.turn) && (s.pending === null || validPiece(s.pending)) &&
    [null, 'red', 'black', 'draw'].includes(s.result) && Number.isInteger(s.ply) && s.ply >= 0 &&
    ['red', 'black'].every((side) => Array.isArray(s.pools?.[side]) && s.pools[side].length <= 16 && s.pools[side].every((type) => TYPES.includes(type))) &&
    Array.isArray(s.winningLine) && s.winningLine.every(validIndex) &&
    Array.isArray(s.history) && s.history.every((e) => ['deploy', 'move'].includes(e.action) && validPiece(e.piece) && ['red', 'black'].includes(e.side) && validIndex(e.to) && (e.action === 'deploy' || validIndex(e.from)) && (!e.captured || validPiece(e.captured)) && Number.isInteger(e.ply)) &&
    Number.isInteger(data.version) && typeof data.joined === 'boolean' && Array.isArray(data.restartVotes) && data.restartVotes.every((side) => ['red', 'black'].includes(side));
}
async function roomRequest(server, path, body, token) {
  const response = await fetch(`${server}/api/rooms${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  }).catch(() => {
    throw new Error(room ? '连接中断，正在重试同步。' : '暂时无法连接房间服务，请检查网络后重试。');
  });
  const data = await response.json().catch(() => { throw new Error('该地址没有运行房间 API；GitHub Pages 本身不能提供房间服务。'); });
  if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : '房间请求失败'), { status: response.status });
  if (!validSnapshot(data)) throw new Error('房间返回了无效棋局');
  return data;
}
async function applySnapshot(data) {
  if (!room) return;
  const animate = state.mode === data.state.mode && data.state.ply === state.ply + 1;
  const rebuild = state.mode !== data.state.mode;
  state = data.state; room.version = data.version; room.joined = data.joined; room.restartVotes = data.restartVotes;
  if (data.joined) setFocus(true);
  threatPly = -1;
  selected = null; moving = false;
  $('board-mode').value = state.mode;
  if (rebuild) buildBoard();
  busy = animate; render();
  try { if (animate) await animateTurn($('board'), cells, state.history.at(-1), pieceMarkup); }
  finally { busy = false; render(); }
}
async function sendAction(action) {
  if (!room || busy || networkBusy) return;
  roomError = '';
  networkBusy = true; render();
  try {
    if (pollTask) await pollTask;
    const data = await roomRequest(room.server, `/${room.code}/action`, { ...action, version: room.version }, room.token);
    networkHealthy = true;
    await applySnapshot(data);
  } catch (error) { if (!error.status) networkHealthy = false; roomError = error.message; $('room-message').textContent = error.message; }
  finally { networkBusy = false; render(); }
}
function renderRoom() {
  $('room-strip').hidden = !room;
  $('room-connected').hidden = !room;
  $('room-server').disabled = Boolean(room) || networkBusy;
  $('room-code').disabled = Boolean(room) || networkBusy;
  $('room-create').disabled = Boolean(room) || networkBusy || busy || !roomServiceReady;
  $('room-join').disabled = Boolean(room) || networkBusy || busy || !roomServiceReady;
  $('room-leave').disabled = networkBusy || busy;
  $('room-local').hidden = Boolean(room);
  $('cancel-restart').hidden = !room?.restartVotes.length;
  $('cancel-restart').disabled = busy || networkBusy;
  if (!room) return;
  const status = roomError || (!networkHealthy ? '连接中断，正在重试同步' : !room.joined ? '等待好友加入' : room.restartVotes.length ? `${sideName(room.restartVotes[0])}申请重开，点击重新开局同意` : '已连接');
  $('room-status').textContent = `${room.code} · 你执${room.side === 'red' ? '红' : '黑'} · ${status}`;
  if (roomError || !networkHealthy || !room.joined || room.restartVotes.length) hint(status);
  else if (room.side !== state.turn && !state.result) hint(`等待${sideName(state.turn)}行动，你可以查看对局记录。`);
}
function endpoint() {
  const url = new URL($('room-server').value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入 http 或 https 服务地址，不要包含账号密码');
  return url.origin;
}
async function connectRoom(join) {
  if (room || networkBusy || busy || !roomServiceReady) return;
  cancelComputer(); roomError = '';
  networkBusy = true; render();
  try {
    const server = endpoint();
    const code = $('room-code').value.trim().toUpperCase();
    if (join && !/^[A-F0-9]{8}$/.test(code)) throw new Error('请输入 8 位有效房间码');
    const data = await roomRequest(server, join ? `/${code}/join` : '', join ? {} : { mode: state.mode });
    if (!/^[A-F0-9]{8}$/.test(data.code) || !/^[a-f0-9]{48}$/.test(data.token) || !['red', 'black'].includes(data.side)) throw new Error('房间身份格式无效');
    cancelComputer(); saveLocal();
    room = { server, code: data.code, token: data.token, side: data.side, version: -1, joined: false, restartVotes: [] };
    try { sessionStorage.setItem('xiangqi-room', JSON.stringify(room)); } catch { /* Private browser storage can be unavailable. */ }
    networkHealthy = true;
    await applySnapshot(data);
    prepareInvite();
    $('room-message').textContent = `你执${sideName(room.side)}。${join ? '加入成功，可以开始对弈。' : '把邀请链接发给好友，等待对方加入。'}`;
  } catch (error) { $('room-message').textContent = error.message; }
  finally { networkBusy = false; render(); }
}
function prepareInvite() {
  $('room-server').value = room.server; $('room-code').value = room.code;
  const link = new URL(location.href);
  link.hash = new URLSearchParams({ room: room.code, server: room.server }).toString();
  $('room-invite').value = link.href;
}
let roomServiceReady = false;
$('room-server').value = new URLSearchParams(location.search).get('server') || location.origin;
const invitation = new URLSearchParams(location.hash.slice(1));
if (invitation.has('room')) {
  $('room-code').value = invitation.get('room');
  $('room-server').value = invitation.get('server') || location.origin;
}
async function checkRoomService() {
  if (room) return;
  roomServiceReady = false; renderRoom();
  $('room-message').textContent = '正在检查好友对弈是否可用…';
  try {
    const response = await fetch(`${endpoint()}/api/rooms/health`, { signal: AbortSignal.timeout(4000) });
    const data = await response.json();
    roomServiceReady = response.ok && data.service === 'xiangqi-five';
  } catch { /* Static hosting remains fully playable without a room service. */ }
  $('room-message').textContent = roomServiceReady ? '好友对弈可用。选择棋盘后创建房间，或输入好友发来的房间码。' : '此版本暂未开放在线房间。你可以继续单人挑战，或与身边的朋友双人同屏。';
  renderRoom();
}
$('room-open').addEventListener('click', () => { $('room-dialog').showModal(); void checkRoomService(); });
$('room-server').addEventListener('change', () => void checkRoomService());
$('room-local').addEventListener('click', () => {
  $('room-dialog').close();
  if (state.ply || state.pending) requestRestart(state.mode, 'local');
  else resetGame(state.mode, 'local');
});
$('room-close').addEventListener('click', () => $('room-dialog').close());
$('room-create').addEventListener('click', () => connectRoom(false));
$('room-join').addEventListener('click', () => connectRoom(true));
$('cancel-restart').addEventListener('click', () => sendAction({ type: 'cancel-restart' }));
$('room-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('room-invite').value); $('room-message').textContent = '邀请链接已复制。'; }
  catch { $('room-invite').select(); $('room-message').textContent = '请长按或使用 Ctrl+C 复制选中的邀请链接。'; }
});
$('room-leave').addEventListener('click', () => {
  if (busy || networkBusy) return;
  room = null; networkHealthy = true; roomError = '';
  const localUrl = new URL(location.href); localUrl.hash = ''; history.replaceState(null, '', localUrl);
  try { sessionStorage.removeItem('xiangqi-room'); } catch { /* Storage may be disabled. */ }
  $('room-dialog').close();
  let saved;
  try { saved = decodeGame(localStorage.getItem(SAVE_KEY)); } catch { /* Storage may be disabled. */ }
  if (saved) {
    ({ state, opponent, difficulty } = saved); selected = null; moving = false; restored = true; threatPly = -1;
    $('board-mode').value = state.mode; buildBoard(); render();
  } else resetGame(state.mode);
});
async function pollRoom() {
  if (!room || busy || networkBusy || pollTask) return;
  const currentRoom = room;
  pollTask = (async () => {
    let changed = false;
    try {
      const data = await roomRequest(currentRoom.server, `/${currentRoom.code}`, null, currentRoom.token);
      if (room !== currentRoom) return;
      changed = !networkHealthy || data.version !== room.version;
      if (!networkHealthy) {
        roomError = '';
        $('room-message').textContent = '连接已恢复，棋局已同步。';
      }
      networkHealthy = true;
      if (changed) await applySnapshot(data);
    } catch (error) {
      if (room !== currentRoom) return;
      changed = networkHealthy; networkHealthy = false;
      roomError = error.message; $('room-message').textContent = error.message;
    } finally { if (changed && room === currentRoom) render(); }
  })();
  try { await pollTask; } finally { pollTask = null; }
}
setInterval(pollRoom, 1000);
try {
  const saved = JSON.parse(sessionStorage.getItem('xiangqi-room') || 'null');
  if (saved && /^[A-F0-9]{8}$/.test(saved.code) && /^[a-f0-9]{48}$/.test(saved.token) && ['red', 'black'].includes(saved.side) && (!invitation.has('room') || invitation.get('room') === saved.code)) {
    const url = new URL(saved.server);
    if (['http:', 'https:'].includes(url.protocol) && url.origin === saved.server) {
      room = { ...saved, version: -1, joined: false, restartVotes: [] };
      networkHealthy = false; prepareInvite(); render(); void pollRoom();
    }
  }
} catch { /* Invalid or inaccessible saved room: remain in local mode. */ }
render();
if (invitation.has('room') && !room) { $('room-dialog').showModal(); void checkRoomService(); }

