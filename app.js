import { BOARDS, TYPES, NAMES, newGame, label, sideName, canMove, draw, deploy, move, hasMove, canDeployDirectly, deployDirectly } from './game.js';

import { silhouette, animateTurn } from './pieces.js';
import { setupBoardZoom } from './board-view.js';

let state = newGame();
let selected = null;
let moving = false;
let busy = false;
let restartMode = state.mode;
let cells = [];
let room = null;
let networkBusy = false;
let networkHealthy = true;
let roomError = '';
let pollTask = null;
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
  resetBoardZoom();
}

function hint(message) { $('action-hint').textContent = message; }

async function play(index) {
  if (state.result || inputLocked()) return;
  const previousPly = state.ply;
  try {
    if (state.pending) {
      if (room) { await sendAction({ type: 'deploy', to: index }); return; }
      deploy(state, index);
      selected = null; moving = false;
    } else if (!state.board[index] && canDeployDirectly(state)) {
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
      hint(selected !== null ? '不能走到这里，请选择标记位置。' : '请先抽子，或选择棋盘上自己的棋子。');
      return;
    }
    if (state.ply !== previousPly) {
      busy = true; render();
      try { await animateTurn($('board'), cells, state.history.at(-1), pieceMarkup); }
      finally { busy = false; render(); }
    } else render();
  } catch (error) { hint(error.message); }
}

function inputLocked() {
  return busy || networkBusy || Boolean(room && (!networkHealthy || !room.joined || room.side !== state.turn || room.restartVotes.length));
}

function render() {
  const ended = Boolean(state.result);
  const side = state.turn;
  const direct = canDeployDirectly(state);
  document.body.dataset.turn = side;
  const last = state.history.at(-1);
  $('board-mode').disabled = busy || Boolean(room);
  $('room-open').disabled = busy || networkBusy;
  $('new-game').disabled = busy || networkBusy || Boolean(room && (!room.joined || !networkHealthy));
  $('board').setAttribute('aria-busy', String(busy));
  cells.forEach((cell, i) => {
    const p = state.board[i];
    const legal = !ended && selected !== null && canMove(state.board, selected, i, state.cols);
    cell.className = ['cell', selected === i ? 'selected' : '', legal ? (p ? 'capture-target' : 'legal-target') : '', last?.to === i ? 'last-play' : '', state.winningLine.includes(i) ? 'winning' : '', (state.pending || direct) && !p ? 'deploy-target' : ''].filter(Boolean).join(' ');
    cell.innerHTML = p ? pieceMarkup(p, 'embodied') : '';
    cell.setAttribute('aria-label', `${coord(i)} ${p ? sideName(p.side) + label(p) : '空位'}${legal ? '，可' + (p ? '吃子' : '移动') : ''}`);
    cell.setAttribute('aria-pressed', String(selected === i));
    cell.disabled = ended || inputLocked();
  });
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
  $('turn-label').textContent = ended ? outcome : `${sideName(side)}${state.ply === 0 ? '先行' : '行棋'}`;
  $('turn-count').textContent = ended ? `共 ${state.ply} 手` : `第 ${String(state.ply + 1).padStart(2, '0')} 手`;
  $('action-side').textContent = ended ? 'MATCH COMPLETE' : `${side.toUpperCase()}'S TURN`;
  $('action-title').textContent = ended ? outcome : state.pending ? `${label(state.pending)}已入手，请落子` : selected !== null ? `移动「${label(state.board[selected])}」` : moving ? '选择一枚己方棋子' : direct ? '点击空位，直接上场' : '落子，或走子';
  $('action-description').textContent = ended ? (state.result === 'draw' ? '当前玩家没有可用行动。再来一局吧。' : '五枚相连，胜负已定。好棋，下一局见。') : state.pending ? '点击任意空点部署，落子后轮到对方。' : selected !== null ? '实心圆点可移动，红圈位置可吃子。' : direct ? '当前只能上场，直接点击空位即可随机抽子并部署。也可先抽子查看。' : '抽取一枚棋子入场，或移动棋盘上的己方棋子。';
  $('draw-preview').innerHTML = state.pending ? `${pieceMarkup(state.pending, 'drawn')}<div><strong>${sideName(side)} · ${label(state.pending)}</strong><small>已锁定部署 · 请选择空位</small></div>` : ended ? `<span class="mystery-piece result-symbol">${state.result === 'draw' ? '和' : '胜'}</span><div><strong>${outcome}</strong><small>共 ${state.ply} 手 · 本局结束</small></div>` : '<span class="mystery-piece">?</span><div><strong>下一枚，会是什么？</strong><small>从剩余棋池中随机抽取</small></div>';
  $('draw-button').disabled = inputLocked() || ended || Boolean(state.pending) || !state.pools[side].length || !state.board.some((p) => !p);
  $('draw-button').firstElementChild.textContent = state.pending ? '待部署 · 点击棋盘空位' : !state.pools[side].length ? '棋池已空' : '抽子入场';
  $('move-button').disabled = inputLocked() || ended || Boolean(state.pending) || !hasMove(state);
  $('move-button').classList.toggle('is-active', moving);
  hint(ended ? '点击「重新开局」开始下一场对弈。' : state.pending ? '本回合只能部署，落子后不能再移动。' : selected !== null ? '再次点击选中棋子可取消选择。' : moving ? '点击自己的棋子，查看可走的位置。' : direct ? '仅能上场：点空位直接落子，也可先抽子查看。' : '抽子后须完成部署，不能重抽。');
  const historyMarkup = (events) => events.slice().reverse().map((event) => `<li><span class="move-number">${String(event.ply).padStart(2, '0')}</span><span class="record-piece ${event.side}">${label(event.piece)}</span><span>${event.action === 'deploy' ? '部署' : event.captured ? `吃${label(event.captured)}` : '移动'} <small>${event.action === 'move' ? coord(event.from) + ' → ' : ''}${coord(event.to)}</small></span><span class="record-side">${sideName(event.side)}</span></li>`).join('');
  const empty = '<li class="empty-history">棋盘尚静，等你落下第一子。</li>';
  $('history').innerHTML = historyMarkup(state.history.slice(-5)) || empty;
  $('full-history').innerHTML = historyMarkup(state.history) || empty;
  $('history-count').textContent = state.ply;
  renderRoom();
  $('announcement').textContent = `${$('turn-label').textContent}。${$('action-title').textContent}。${last ? `上一手${sideName(last.side)}${label(last.piece)}到${coord(last.to)}。` : ''}`;
}

$('draw-button').addEventListener('click', () => {
  if (inputLocked()) return;
  if (room) { void sendAction({ type: 'draw' }); return; }
  try { draw(state); selected = null; moving = false; render(); }
  catch (error) { hint(error.message); }
});
$('move-button').addEventListener('click', () => { if (inputLocked()) return; moving = !moving; selected = null; render(); });
$('rules-open').addEventListener('click', () => $('rules-dialog').showModal());
$('rules-close').addEventListener('click', () => $('rules-dialog').close());
function requestRestart(mode) {
  if (busy) return;
  restartMode = mode;
  $('restart-description').textContent = `当前棋局将被清空，改用 ${BOARDS[mode].cols}×${BOARDS[mode].rows} 棋盘。双方恢复各 16 枚棋子，红方先手。`;
  if (room) $('restart-description').textContent = '好友房间需双方同意重开。申请期间暂停走子，任一方可取消申请。';
  $('restart-dialog').showModal();
}
function resetGame(mode) {
  state = newGame(mode); selected = null; moving = false;
  $('board-mode').value = mode;
  buildBoard(); render();
}
$('new-game').addEventListener('click', () => requestRestart(state.mode));
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
  else resetGame(restartMode);
});
$('history-open').addEventListener('click', () => $('history-dialog').showModal());
$('history-close').addEventListener('click', () => $('history-dialog').close());

document.addEventListener('contextmenu', (event) => event.preventDefault());
const mobile = matchMedia('(max-width: 760px), (max-width: 1100px) and (max-height: 500px)');
function arrangeControls() {
  const panel = document.querySelector('.action-panel');
  if (mobile.matches) {
    document.querySelector('.board-section').insertBefore(panel, document.querySelector('.board-topline'));
    document.querySelector('.board-settings').append($('new-game'));
  } else {
    document.querySelector('.right-rail').prepend(panel);
    document.querySelector('.left-rail').append($('new-game'));
  }
}
mobile.addEventListener('change', arrangeControls);
arrangeControls(); buildBoard(); render();

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
  $('room-create').disabled = Boolean(room) || networkBusy || busy;
  $('room-join').disabled = Boolean(room) || networkBusy || busy;
  $('room-leave').disabled = networkBusy || busy;
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
  if (room || networkBusy || busy) return;
  networkBusy = true; render();
  try {
    const server = endpoint();
    const code = $('room-code').value.trim().toUpperCase();
    if (join && !/^[A-F0-9]{8}$/.test(code)) throw new Error('请输入 8 位有效房间码');
    const data = await roomRequest(server, join ? `/${code}/join` : '', join ? {} : { mode: state.mode });
    if (!/^[A-F0-9]{8}$/.test(data.code) || !/^[a-f0-9]{48}$/.test(data.token) || !['red', 'black'].includes(data.side)) throw new Error('房间身份格式无效');
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
$('room-server').value = location.origin;
const invitation = new URLSearchParams(location.hash.slice(1));
if (invitation.has('room')) {
  $('room-code').value = invitation.get('room');
  $('room-server').value = invitation.get('server') || location.origin;
}
$('room-open').addEventListener('click', () => $('room-dialog').showModal());
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
  room = null; networkHealthy = true;
  try { sessionStorage.removeItem('xiangqi-room'); } catch { /* Storage may be disabled. */ }
  $('room-dialog').close(); resetGame(state.mode);
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
      if (!networkHealthy) roomError = '';
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

