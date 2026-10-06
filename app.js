import {
  BOARDS,
  TYPES,
  NAMES,
  newGame,
  label,
  sideName,
  canMove,
  draw,
  deploy,
  move,
  hasMove,
  canDeployDirectly,
  deployDirectly,
} from './game.js';

import { animateTurn } from './pieces.js';
import { setupBoardZoom } from './board-view.js';
import { applyComputerAction, winningActions } from './computer.js';
import { SAVE_KEY, encodeGame, decodeGame } from './local-game.js';
import {
  CHALLENGES,
  CHALLENGE_SAVE_KEY,
  getChallenge,
  createChallengeState,
  challengeOutcome,
  challengeReply,
  challengeMilestones,
  recommendedChallenge,
  challengeInvitation,
  challengeFromUrl,
  challengeLink,
  decodeChallengeProgress,
} from './challenges.js';

let state = newGame();
let opponent = 'computer';
let difficulty = 'standard';
let storageAvailable = true;
let restored = false;
try {
  const saved = decodeGame(localStorage.getItem(SAVE_KEY));
  if (saved) {
    ({ state, opponent, difficulty } = saved);
    restored = true;
  }
} catch {
  storageAvailable = false;
}
let computerWorker = null;
let computerTimer = null;
let thinking = false;
let computerError = '';
let restartOpponent = opponent;
let restartDifficulty = difficulty;
let threatPly = -1,
  threats = [];
let selected = null;
let moving = false;
let busy = false;
let resultAnnounced = false;
let resultDismissed = false;
let restartMode = state.mode;
let cells = [];
let boardFocusIndex = 0;
let resumeBoardFocus = false;
let room = null;
let networkBusy = false;
let networkHealthy = true;
let roomError = '';
let pollTask = null;
let focused = false;
let currentScreen = 'home';
let setupDraft = null;
let onlineActive = false;
let challenge = null;
let challengeSharing = false;
let challengeReturn = null;
let challengeProgress = {};
let challengeStorageAvailable = true;
try {
  challengeProgress = decodeChallengeProgress(localStorage.getItem(CHALLENGE_SAVE_KEY));
} catch {
  challengeStorageAvailable = false;
}
const $ = (id) => document.getElementById(id);
function setChevronLabel(id, text) {
  const button = $(id);
  button.textContent = text;
  button.insertAdjacentHTML(
    'beforeend',
    '<svg class="button-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>',
  );
}
const resetBoardZoom = setupBoardZoom(
  $('board-scroll'),
  $('zoom-board'),
  $('zoom-out'),
  $('zoom-reset'),
  $('zoom-value'),
);
const coord = (i) =>
  `${String.fromCharCode(65 + (i % state.cols))}${Math.floor(i / state.cols) + 1}`;
const pieceMarkup = (p, extra = '') =>
  `<span class="piece ${p.side} ${extra}"><span class="piece-label">${label(p)}</span></span>`;

function notifyDisplayState(name = currentScreen) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage(
      {
        type: 'small-games:display-state',
        gameId: 'xiangqi-five',
        screen: name === 'home' ? 'home' : 'playing',
      },
      location.origin,
    );
  } catch {
    /* Standalone play and unrelated embeds need no host navigation. */
  }
}

// Navigation changes the visible page only; game state stays in memory.
function showScreen(name, { replace = false, push = true } = {}) {
  if (name === 'result' && challenge) name = 'game';
  if (name === 'result' && !state.result && (!challenge || challenge.status === 'playing'))
    name = 'game';
  if (name === 'challenge-help' && !challenge) name = 'game';
  if (name === 'setup' && (room || challenge)) name = room ? 'room' : 'tools';
  if (name === 'setup' && !setupDraft) {
    setupDraft = { mode: state.mode, opponent, difficulty };
  }
  if (!document.querySelector(`[data-screen="${name}"]:not(body)`)) return;
  const leavingGame = currentScreen === 'game' && name !== 'game';
  currentScreen = name;
  document.body.dataset.screen = name;
  document.querySelectorAll('.screen[data-screen]').forEach((page) => {
    page.hidden = page.dataset.screen !== name;
  });
  notifyDisplayState(name);
  if (push)
    history[replace ? 'replaceState' : 'pushState'](
      { ...history.state, xqScreen: name },
      '',
      location.href,
    );
  if (leavingGame) resumeBoardFocus = false;
  window.scrollTo(0, 0);
  if (name === 'setup') renderSetup();
  if (name === 'game') {
    setFocus(true);
    resetBoardZoom();
    requestAnimationFrame(() => {
      if (currentScreen === 'game') render();
    });
  } else {
    const title = document.querySelector(`[data-screen="${name}"]:not(body) h1`);
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
  }
}
function goBack() {
  if (history.state?.xqScreen && currentScreen !== 'home') history.back();
  else showScreen('home', { replace: true });
}
window.addEventListener('popstate', (event) => {
  if (onlineActive) window.dispatchEvent(new Event('xiangqi-online-exit'));
  showScreen(event.state?.xqScreen || 'home', { push: false });
});
document
  .querySelectorAll('[data-back]')
  .forEach((button) => button.addEventListener('click', goBack));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !['home', 'game'].includes(currentScreen) && !onlineActive) {
    event.preventDefault();
    goBack();
  }
});
function openSetup(nextOpponent = opponent) {
  if (busy || networkBusy) return;
  if (room) {
    showScreen('room');
    return;
  }
  if (challenge) exitChallenge();
  setupDraft = { mode: state.mode, opponent: nextOpponent, difficulty };
  showScreen('setup');
  renderSetup();
}
function renderSetup() {
  const computer = (setupDraft?.opponent || opponent) === 'computer';
  $('setup-title').textContent = computer ? '单人挑战' : '双人同屏';
  $('setup-subtitle').textContent = computer ? '你执红，电脑执黑。' : '红方先手，双方轮流落子。';
  $('difficulty').hidden = $('difficulty-hint').hidden = !computer;
  $('board-mode').disabled = busy || networkBusy;
  $('difficulty').disabled = busy || thinking;
  document.querySelectorAll('[data-board]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.board === setupDraft?.mode));
  });
  document.querySelectorAll('[data-difficulty]').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.difficulty === setupDraft?.difficulty),
    );
  });
  $('difficulty-hint').textContent = {
    practice: '适合熟悉走子与连五。',
    standard: '兼顾连线与防守。',
    hard: '深入计算攻防，可能需要稍等。',
  }[setupDraft?.difficulty || difficulty];
  setChevronLabel(
    'setup-start',
    setupDraft?.mode === state.mode &&
      setupDraft?.opponent === opponent &&
      (state.ply || state.pending)
      ? '继续这一局'
      : '开始对弈',
  );
}
$('home-start').addEventListener('click', () => showScreen('modes'));
$('home-continue').addEventListener('click', () => {
  showScreen('game');
  render();
});
$('home-settings').addEventListener('click', () => {
  if (room || challenge) {
    showScreen('tools');
    render();
  } else openSetup();
});
$('mode-computer').addEventListener('click', () => openSetup('computer'));
$('mode-local').addEventListener('click', () => openSetup('local'));
function arrangeOnlineEntry() {
  if ($('mode-online').hidden) return;
  $('mode-extras').hidden = false;
  const legacy = $('room-open');
  legacy.className = 'text-button';
  legacy.textContent = '临时好友房间 ›';
  $('mode-extras').append(legacy);
}
new MutationObserver(arrangeOnlineEntry).observe($('mode-online'), {
  attributes: true,
  attributeFilter: ['hidden'],
});
arrangeOnlineEntry();
$('game-back').addEventListener('click', () => {
  showScreen('home');
  render();
});
$('game-more').addEventListener('click', () => {
  showScreen('tools');
  render();
});
$('tools-rules').addEventListener('click', () => showScreen('rules'));
$('tools-pool').addEventListener('click', () => showScreen('pool'));
$('tools-settings').addEventListener('click', () => openSetup());
$('pieces-open').addEventListener('click', () => showScreen('pieces'));
$('rules-play').addEventListener('click', () => {
  showScreen('game');
  render();
});
$('training-help-open').addEventListener('click', () => showScreen('challenge-help'));
$('training-topics-open').addEventListener('click', openChallenges);
$('result-home').addEventListener('click', () => {
  showScreen('home');
  render();
});
$('result-board').addEventListener('click', () => {
  if (challenge) {
    resultDismissed = true;
    render();
    $('training-next').focus({ preventScroll: true });
  } else showScreen('game');
});
for (const id of ['zoom-board', 'zoom-out', 'zoom-reset'])
  $(id).addEventListener(
    'click',
    () => {
      if (currentScreen !== 'game') {
        showScreen('game');
        resetBoardZoom();
      }
    },
    { capture: true },
  );
$('game-zoom').addEventListener('click', () => $('zoom-board').click());
$('game-zoom-reset').addEventListener('click', () => $('zoom-reset').click());
new MutationObserver(() => {
  $('game-zoom-reset').hidden = $('board-scroll').dataset.scale === '1.00';
}).observe($('board-scroll'), { attributes: true, attributeFilter: ['data-scale'] });
window.addEventListener('xiangqi-online-open', () => {
  onlineActive = true;
  cancelComputer();
});
window.addEventListener('xiangqi-online-close', () => {
  onlineActive = false;
  render();
});
const guide = [
  ['rook', '车 · 横竖直走', '沿横线或竖线走任意距离，不能越过棋子。'],
  ['horse', '马 · 走日字', '先直一格再斜一格；直行邻格有子时不能走。'],
  ['elephant', '相 / 象 · 走田字', '斜走两格，中间有子时不能走；不受河界限制。'],
  ['advisor', '仕 / 士 · 斜走一格', '斜走一格，不受九宫限制。'],
  ['king', '帅 / 将 · 横竖一格', '上下左右走一格，不受九宫限制；被吃不直接判负。'],
  ['cannon', '炮 · 隔子吃子', '沿横线或竖线移动时不能越子；吃子须恰好隔一枚棋子。'],
  ['pawn', '兵 / 卒 · 四向一格', '上下左右走一格，可以后退。'],
];
$('piece-guide').innerHTML = guide
  .map(
    ([type, title, text]) =>
      `<article>${pieceMarkup({ side: 'red', type })}<div><h2>${title}</h2><p>${text}</p></div></article>`,
  )
  .join('');

function buildBoard() {
  const { cols, rows } = state;
  boardFocusIndex = 0;
  resumeBoardFocus = false;
  const board = $('board');
  board.style.setProperty('--cols', cols);
  board.style.aspectRatio = `${cols}/${rows}`;
  board.dataset.mode = state.mode;
  board.setAttribute('aria-label', `${cols}列${rows}行棋盘`);
  const lines = [];
  for (let x = 0; x < cols; x++) lines.push(`M${x * 100 + 50} 50V${rows * 100 - 50}`);
  for (let y = 0; y < rows; y++) lines.push(`M50 ${y * 100 + 50}H${cols * 100 - 50}`);
  const river =
    state.mode === 'xiangqi'
      ? '<rect class="river-bg" x="52" y="453" width="796" height="94"/><text x="250" y="513" text-anchor="middle">楚河</text><text x="650" y="513" text-anchor="middle">汉界</text>'
      : '';
  board.innerHTML = `<svg class="board-lines" viewBox="0 0 ${cols * 100} ${rows * 100}" preserveAspectRatio="none" aria-hidden="true"><path d="${lines.join(' ')}"/>${river}</svg>`;
  cells = Array.from({ length: cols * rows }, (_, index) => {
    const button = document.createElement('button');
    button.className = 'cell';
    button.type = 'button';
    button.tabIndex = index === boardFocusIndex ? 0 : -1;
    button.addEventListener('focus', () => {
      boardFocusIndex = index;
      cells.forEach((cell, i) => {
        cell.tabIndex = i === index ? 0 : -1;
      });
    });
    button.addEventListener('click', () => play(index));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && (selected !== null || moving)) {
        event.preventDefault();
        selected = null;
        moving = false;
        render();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const rowStart = Math.floor(index / cols) * cols;
        const next =
          event.key === 'Home'
            ? event.ctrlKey
              ? 0
              : rowStart
            : event.ctrlKey
              ? cells.length - 1
              : rowStart + cols - 1;
        cells[next].focus();
        return;
      }
      const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
      if (!(event.key in shifts)) return;
      event.preventDefault();
      const next = index + shifts[event.key];
      if (
        next >= 0 &&
        next < cells.length &&
        (Math.abs(shifts[event.key]) === cols ||
          Math.floor(next / cols) === Math.floor(index / cols))
      )
        cells[next].focus();
    });
    board.append(button);
    return button;
  });
  board.insertAdjacentHTML(
    'beforeend',
    `<svg class="winning-connection" viewBox="0 0 ${cols * 100} ${rows * 100}" preserveAspectRatio="none" aria-hidden="true"><line id="winning-connection" /></svg>`,
  );
  resetBoardZoom();
}

function hint(message) {
  $('action-hint').textContent = message;
  if (challenge) $('challenge-move-message').textContent = message;
}

function saveLocal() {
  if (room || challenge) return;
  try {
    localStorage.setItem(SAVE_KEY, encodeGame(state, opponent, difficulty));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}
function cancelComputer() {
  clearTimeout(computerTimer);
  computerTimer = null;
  computerWorker?.terminate();
  computerWorker = null;
  thinking = false;
  computerError = '';
}
function scheduleComputer() {
  if (
    onlineActive ||
    room ||
    challenge ||
    opponent !== 'computer' ||
    state.turn !== 'black' ||
    state.result ||
    busy ||
    networkBusy ||
    thinking ||
    computerError
  )
    return;
  thinking = true;
  const currentState = state,
    ply = state.ply;
  computerTimer = setTimeout(() => {
    const fail = () => {
      cancelComputer();
      computerError = '电脑暂时未能落子，点击重试继续，棋局已保留。';
      render();
    };
    try {
      computerWorker = new Worker(new URL('./computer-worker.js', import.meta.url), {
        type: 'module',
      });
      computerWorker.onerror = fail;
      computerWorker.onmessage = async ({ data }) => {
        if (state !== currentState || state.ply !== ply || room || opponent !== 'computer') return;
        if (data.error || !data.action) {
          fail();
          return;
        }
        cancelComputer();
        try {
          applyComputerAction(state, data.action);
          saveLocal();
          busy = true;
          render();
          await animateTurn($('board'), cells, state.history.at(-1), pieceMarkup);
        } catch {
          computerError = '电脑暂时未能落子，点击重试继续，棋局已保留。';
        } finally {
          busy = false;
          render();
        }
      };
      computerWorker.postMessage({ state, difficulty });
    } catch {
      fail();
    }
  }, 350);
}

async function play(index) {
  if (state.result || inputLocked()) return;
  setFocus(true);
  const previousPly = state.ply;
  try {
    if (state.pending) {
      if (room) {
        await sendAction({ type: 'deploy', to: index });
        return;
      }
      deploy(state, index);
      selected = null;
      moving = false;
    } else if (!moving && selected === null && !state.board[index] && canDeployDirectly(state)) {
      if (room) {
        await sendAction({ type: 'deploy-directly', to: index });
        return;
      }
      deployDirectly(state, index);
      selected = null;
      moving = false;
    } else if (selected !== null && canMove(state.board, selected, index, state.cols)) {
      if (room) {
        await sendAction({ type: 'move', from: selected, to: index });
        return;
      }
      move(state, selected, index);
      selected = null;
      moving = false;
    } else if (state.board[index]?.side === state.turn) {
      selected = selected === index ? null : index;
      moving = selected !== null;
    } else {
      hint(
        selected !== null
          ? '不能走到这里，请选择标记位置。'
          : moving
            ? '先点己方棋子，再点标记位置移动；点「取消移动」可退出。'
            : '请先抽取棋子，或选择己方棋子移动。',
      );
      return;
    }
    if (state.ply !== previousPly) {
      finishChallengeTurn();
      saveLocal();
      busy = true;
      render();
      try {
        await animateTurn($('board'), cells, state.history.at(-1), pieceMarkup);
        if (
          challenge?.definition.goal === 'two-turn' &&
          challenge.status === 'playing' &&
          state.turn === 'black'
        ) {
          const action = challengeReply(challenge.definition.id, state);
          if (action) {
            move(state, action.from, action.to);
            finishChallengeTurn();
            render();
            await animateTurn($('board'), cells, state.history.at(-1), pieceMarkup);
          }
        }
      } finally {
        busy = false;
        render();
      }
    } else render();
  } catch (error) {
    hint(error.message);
  }
}

function inputLocked() {
  return (
    busy ||
    networkBusy ||
    Boolean(challenge && (challenge.status !== 'playing' || state.turn === 'black')) ||
    Boolean(!room && !challenge && opponent === 'computer' && state.turn === 'black') ||
    Boolean(
      room &&
        (!networkHealthy || !room.joined || room.side !== state.turn || room.restartVotes.length),
    )
  );
}

function render() {
  scheduleComputer();
  const ended = Boolean(state.result) || Boolean(challenge && challenge.status !== 'playing');
  if (currentScreen === 'result' && !ended) showScreen('game', { replace: true });
  const side = state.turn;
  const direct = !moving && selected === null && canDeployDirectly(state);
  document.body.dataset.turn = side;
  document.body.dataset.result = state.result || '';
  document.body.classList.toggle('practice-finished', Boolean(challenge && ended));
  const last = state.history.at(-1);
  $('match-label').textContent = challenge
    ? '战术练习'
    : room
      ? '好友对弈'
      : opponent === 'computer'
        ? '单人挑战'
        : '双人同屏';
  $('opponent-name').textContent = room
    ? '好友'
    : challenge
      ? '电脑'
      : opponent === 'computer'
        ? '电脑'
        : '黑方玩家';
  $('opponent-status').textContent = thinking ? '思考中…' : '同色连五获胜';
  $('home-continue').hidden = !(state.ply || state.pending || room || challenge);
  setChevronLabel('home-continue', challenge ? '继续战术练习' : room ? '返回好友对弈' : '继续棋局');
  $('training-dock').hidden = !challenge;
  $('tools-settings').hidden = Boolean(room || challenge);
  $('tools-room').hidden = !room;
  $('challenge-select').hidden = $('challenge-exit').hidden = !challenge;
  $('draw-button').setAttribute(
    'aria-label',
    state.pending
      ? `已抽到「${label(state.pending)}」，点棋盘空位放置，不能重抽或改为移动`
      : '抽取棋子，随机获得一枚，再点空位放置',
  );
  $('save-status').textContent = challenge
    ? challengeStorageAvailable
      ? '战术练习 · 原棋局已保留'
      : '练习进度暂不能保存 · 原棋局已保留'
    : room
      ? '好友房间 · 自动同步'
      : !storageAvailable
        ? '浏览器未允许保存，请勿关闭本页'
        : `${restored ? '已恢复棋局 · ' : ''}本机自动保存`;
  $('computer-retry').hidden = !computerError;
  if (threatPly !== state.ply) {
    threatPly = state.ply;
    const enemy = side === 'red' ? 'black' : 'red';
    threats = ended ? [] : winningActions({ ...state, pending: null, turn: enemy }, enemy);
  }
  $('room-open').disabled = busy || networkBusy || Boolean(challenge);
  $('challenge-open').disabled = busy || networkBusy || Boolean(room);
  $('challenge-quick-start').disabled = busy || networkBusy || Boolean(room);
  $('new-game').disabled =
    busy || networkBusy || Boolean(room && (!room.joined || !networkHealthy));
  $('board').setAttribute('aria-busy', String(busy || thinking));
  const boardLocked = ended || inputLocked();
  document.querySelector('.action-panel').dataset.state = boardLocked
    ? 'waiting'
    : state.pending
      ? 'pending'
      : moving || selected !== null
        ? 'moving'
        : 'ready';
  if (currentScreen === 'game' && !ended && boardLocked && cells.includes(document.activeElement))
    resumeBoardFocus = true;
  cells.forEach((cell, i) => {
    const p = state.board[i];
    const legal = !ended && selected !== null && canMove(state.board, selected, i, state.cols);
    const threat = threats.some((action) => action.to === i);
    cell.className = [
      'cell',
      selected === i ? 'selected' : '',
      legal ? (p ? 'capture-target' : 'legal-target') : '',
      last?.to === i ? 'last-play' : '',
      state.winningLine.includes(i) ? 'winning' : '',
      threat ? 'threat-target' : '',
      (state.pending || direct) && !p ? 'deploy-target' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const coordinate =
      challenge && (i < state.cols || i % state.cols === 0)
        ? `<span class="challenge-coordinate" aria-hidden="true">${i < state.cols ? String.fromCharCode(65 + i) : Math.floor(i / state.cols) + 1}${i === 0 ? ' · 1' : ''}</span>`
        : '';
    cell.innerHTML = (p ? pieceMarkup(p, 'embodied') : '') + coordinate;
    cell.setAttribute(
      'aria-label',
      `${coord(i)} ${p ? sideName(p.side) + label(p) : '空位'}${legal ? '，可' + (p ? '吃子' : '移动') : ''}${threat ? '，对方下一手可在此成五' : ''}`,
    );
    cell.setAttribute('aria-pressed', String(selected === i));
    cell.disabled = boardLocked;
  });
  if (currentScreen === 'game' && !boardLocked && resumeBoardFocus) {
    // Native disabled buttons lose focus during animations and computer turns.
    // Resume only if the player has not moved to another control while waiting.
    const active = document.activeElement;
    if (active === document.body || cells.includes(active))
      cells[boardFocusIndex].focus({ preventScroll: true });
    resumeBoardFocus = false;
  }
  if (ended) resumeBoardFocus = false;
  const connection = $('winning-connection');
  connection.parentElement.style.display = state.winningLine.length ? '' : 'none';
  if (state.winningLine.length) {
    for (const [n, index] of [
      [1, state.winningLine[0]],
      [2, state.winningLine.at(-1)],
    ]) {
      connection.setAttribute(`x${n}`, (index % state.cols) * 100 + 50);
      connection.setAttribute(`y${n}`, Math.floor(index / state.cols) * 100 + 50);
    }
  }
  for (const player of ['red', 'black']) {
    const pool = state.pools[player];
    const onBoard = state.board.filter((p) => p?.side === player).length;
    const captured = 16 - pool.length - onBoard - (state.pending?.side === player ? 1 : 0);
    const card = $(`${player}-player`);
    card.classList.toggle('active', side === player && !ended);
    card.innerHTML = `<div class="player-heading">${pieceMarkup({ side: player, type: 'king' })}<div><h3>${sideName(player)}<span>${player === 'red' ? '先手' : '后手'}</span></h3><p>场上 ${onBoard} <span>·</span> 被吃 ${captured}</p></div><span class="turn-badge">${ended ? '已结束' : side === player ? '当前回合' : '等待中'}</span></div><div class="pool">${TYPES.map(
      (type, index) => {
        const count = pool.filter((p) => p === type).length;
        return `<div class="pool-piece ${count ? '' : 'depleted'}" aria-label="${NAMES[player][index]}剩余${count}枚"><span>${NAMES[player][index]}</span><small>${count}</small></div>`;
      },
    ).join('')}</div><div class="pool-total">剩余 <b>${pool.length}</b> 枚</div>`;
  }
  const outcome =
    challenge && ended
      ? challenge.status === 'solved'
        ? challenge.definition.goal === 'defend'
          ? '防守成功'
          : challenge.definition.goal === 'two-turn'
            ? '连招成五！'
            : '一手成五！'
        : '未达成目标'
      : state.result === 'draw'
        ? '本局和棋'
        : `${sideName(side)}连五获胜`;
  const computerTurn = !room && !challenge && opponent === 'computer' && side === 'black';
  $('turn-label').textContent = ended
    ? outcome
    : challenge && side === 'black'
      ? '电脑应对中…'
      : computerTurn
        ? '电脑思考中…'
        : room
          ? room.side === side
            ? '轮到你落子'
            : '等待好友落子'
          : opponent === 'computer' || challenge
            ? '轮到你落子'
            : `${sideName(side)}回合`;
  $('turn-count').textContent = challenge
    ? challenge.definition.goal === 'two-turn'
      ? `第 ${state.ply < 2 ? 1 : 2}/2 手`
      : '红方走一手'
    : ended
      ? `共 ${state.ply} 手`
      : `第 ${String(state.ply + 1).padStart(2, '0')} 手`;
  $('action-side').textContent = ended ? '本局结束' : `${sideName(side)}回合`;
  $('action-title').textContent = ended
    ? outcome
    : state.pending
      ? `已抽到「${label(state.pending)}」，点棋盘空位放置`
      : selected !== null
        ? `移动「${label(state.board[selected])}」`
        : moving
          ? '选择一枚己方棋子'
          : direct
            ? '抽取棋子或移动棋子'
            : '移动棋子';
  $('action-description').textContent = ended
    ? state.result === 'draw'
      ? '当前玩家无合法行动，本局和棋。'
      : '同色五子连成一线，本局结束。'
    : state.pending
      ? '点棋盘空位放置，不能重抽或改为移动。'
      : selected !== null
        ? '实心圆点可移动，红圈位置可吃子。'
        : direct
          ? '可先抽取棋子再放置，也可点空位随机落子，或点己方棋子移动。'
          : '选择己方棋子，再点标记位置移动。';
  $('draw-preview').innerHTML = state.pending
    ? `${pieceMarkup(state.pending, 'drawn')}<div><strong>已抽到「${label(state.pending)}」</strong><small>点棋盘空位放置</small></div>`
    : ended
      ? `<span class="mystery-piece result-symbol">${state.result === 'draw' ? '和' : '胜'}</span><div><strong>${outcome}</strong><small>共 ${state.ply} 手 · 本局结束</small></div>`
      : '<span class="mystery-piece">?</span><div><strong>落子或移动</strong><small>也可直接点空位随机落子</small></div>';
  $('draw-button').disabled =
    inputLocked() ||
    ended ||
    Boolean(state.pending) ||
    !state.pools[side].length ||
    !state.board.some((p) => !p);
  $('draw-button').firstElementChild.textContent = state.pending
    ? `已抽到「${label(state.pending)}」`
    : !state.pools[side].length
      ? '无剩余棋子'
      : '抽取棋子';
  $('move-button').disabled = inputLocked() || ended || Boolean(state.pending) || !hasMove(state);
  $('move-button').classList.toggle('is-active', moving);
  $('move-button').textContent = moving ? '取消移动' : '移动棋子';
  $('move-button').setAttribute('aria-pressed', String(moving));
  hint(
    ended
      ? '点击「重新开局」开始下一场对弈。'
      : state.pending
        ? '点棋盘空位放置，不能重抽或改为移动。'
        : selected !== null
          ? '再次点击选中棋子可取消选择。'
          : moving
            ? '点击自己的棋子，查看可走的位置。'
            : direct
              ? '随机获得一枚，再点空位放置。'
              : '点己方棋子，再点标记位置移动。',
  );
  const movement = {
    rook: '车：横竖直走，不能越子。',
    horse: '马：走日字，直行邻格有子时不能走。',
    elephant: '象：斜走两格，中间有子不能走。',
    advisor: '士：斜走一格，不限九宫。',
    king: '将帅：横竖一格，被吃不直接判负。',
    cannon: '炮：直走，吃子须恰好隔一子。',
    pawn: '兵卒：上下左右一格，可以后退。',
  };
  $('coach-hint').textContent =
    computerError ||
    (ended
      ? '可重新开局，或调整棋盘与难度。'
      : computerTurn
        ? '电脑与你使用相同的棋池与走子规则。'
        : selected !== null
          ? movement[state.board[selected].type]
          : threats.length
            ? '金圈表示对方下一手可连五。堵住落点，或吃掉连线中的棋子。'
            : state.ply < 4
              ? '点空位随机落子，点己方棋子移动；同色横、竖、斜连五获胜。'
              : '连五才获胜，吃将不直接获胜。点己方棋子查看可走位置。');
  if (challenge) {
    $('coach-hint').textContent = ended
      ? '可重试本题，或分享给好友。'
      : selected !== null
        ? movement[state.board[selected].type]
        : '点红方棋子，再点标记位置移动；本题不能抽取棋子。';
    hint('');
  }
  if (!computerError && selected === null && !threats.length) $('coach-hint').textContent = '';
  const historyMarkup = (events) =>
    events
      .slice()
      .reverse()
      .map(
        (event) =>
          `<li><span class="move-number">${String(event.ply).padStart(2, '0')}</span><span class="record-piece ${event.side}">${label(event.piece)}</span><span>${event.action === 'deploy' ? '落子' : event.captured ? `吃${label(event.captured)}` : '移动'} <small>${event.action === 'move' ? coord(event.from) + ' → ' : ''}${coord(event.to)}</small></span><span class="record-side">${sideName(event.side)}</span></li>`,
      )
      .join('');
  const empty = '<li class="empty-history">暂无记录，落子后会显示在这里。</li>';
  $('history').innerHTML = historyMarkup(state.history.slice(-5)) || empty;
  $('full-history').innerHTML = historyMarkup(state.history) || empty;
  $('history-count').textContent = state.ply;
  renderRoom();
  const resultBanner = $('result-banner');
  const resultParent = challenge
    ? $('practice-result-slot')
    : document.querySelector('.result-screen');
  if (resultBanner.parentElement !== resultParent) resultParent.append(resultBanner);
  resultBanner.classList.toggle('practice-result', Boolean(challenge));
  resultBanner.classList.toggle('practice-failed', challenge?.status === 'failed');
  resultBanner.hidden = !ended || Boolean(challenge && (resultDismissed || busy));
  $('result-board').textContent = challenge ? '收起结果' : '查看棋盘';
  $('training-next').hidden = !challenge || !ended || busy;
  $('training-next').textContent = challenge?.status === 'solved' ? '下一题' : '再试一次';
  $('result-title').textContent = challenge
    ? outcome
    : state.result === 'draw'
      ? '本局和棋'
      : `${sideName(side)}获胜！`;
  $('result-description').textContent = room?.restartVotes.length
    ? `${sideName(room.restartVotes[0])}已申请重开，等待另一方同意。`
    : `共 ${state.ply} 手${state.result === 'draw' ? '，当前无合法行动。' : '，同色五子连成一线。'}${room ? '双方同意后开始下一局。' : ''}`;
  $('result-restart').disabled =
    busy ||
    networkBusy ||
    Boolean(room && (!room.joined || !networkHealthy || room.restartVotes.includes(room.side)));
  $('result-restart').textContent = !room
    ? '再来一局'
    : room.restartVotes.includes(room.side)
      ? '等待好友同意'
      : room.restartVotes.length
        ? '同意重开'
        : '申请再来一局';
  if (challenge) {
    $('result-restart').textContent = challenge.status === 'solved' ? '下一题' : '重试本题';
    const next = CHALLENGES[(CHALLENGES.indexOf(challenge.definition) + 1) % CHALLENGES.length];
    $('challenge-next-goal').textContent =
      challenge.status === 'solved'
        ? `下一目标：${next.title} · ${next.goal === 'two-turn' ? '两手连招' : next.goal === 'defend' ? '解除威胁' : '一手连五'}`
        : challenge.definition.goal === 'two-turn'
          ? '重试本题，考虑黑方回应后的连五路线。'
          : challenge.definition.goal === 'defend'
            ? '重试本题，消除黑方的全部连五威胁。'
            : '重试本题，找到连五的缺口。';
    $('challenge-result-share').textContent = '分享';
    $('challenge-result-share').setAttribute('aria-label', '邀请朋友解同一道题');
    const lastRed = state.history.filter((event) => event.side === 'red').at(-1);
    $('result-description').textContent =
      challenge.status === 'solved'
        ? `${lastRed ? `${coord(lastRed.from)} → ${coord(lastRed.to)} · ` : ''}${challenge.definition.goal === 'defend' ? '黑方已无法一手连五' : '同色五子已连成一线'}${challenge.hintShown ? ' · ★' : ' · ★★'}`
        : challenge.definition.goal === 'defend'
          ? '黑方仍能连五，请重试或查看提示。'
          : '尚未连成五子，请重试或查看提示。';
  }
  $('challenge-result-actions').hidden = !challenge || !ended;
  renderChallenge();
  if (!ended) resultAnnounced = false;
  else if (currentScreen === 'game' && !busy && !resultAnnounced) {
    if (!challenge) showScreen('result');
    resultAnnounced = true;
    $('result-banner').focus({ preventScroll: true });
    if (!challenge) $('result-banner').scrollIntoView({ block: 'nearest' });
  }
  if (currentScreen === 'setup') renderSetup();
  $('announcement').textContent =
    `${$('turn-label').textContent}。${$('action-title').textContent}。${last ? `上一手${sideName(last.side)}${label(last.piece)}到${coord(last.to)}。` : ''}`;
}

function renderChallenge() {
  const milestones = challengeMilestones(challengeProgress);
  $('challenge-summary').textContent =
    `已完成 ${milestones.basics + milestones.combos}/8 题　·　★ ${milestones.stars}/16`;
  $('challenge-start-next').textContent =
    `继续练习 · ${recommendedChallenge(challengeProgress).title}`;
  $('challenge-panel').hidden = !challenge;
  $('challenge-move-message').hidden = !challenge;
  if (!challenge) return;
  const definition = challenge.definition;
  $('challenge-title').textContent =
    `${String(CHALLENGES.indexOf(definition) + 1).padStart(2, '0')} · ${definition.title}`;
  const record = challengeProgress[definition.id];
  $('challenge-progress').textContent = record?.stars ? '★'.repeat(record.stars) : '';
  const reply = state.ply >= 2 && definition.goal === 'two-turn' ? state.history[1] : null;
  $('challenge-objective').textContent =
    definition.goal === 'two-turn'
      ? `连招 ${reply ? 2 : 1}/2`
      : definition.goal === 'defend'
        ? '解除威胁'
        : '一手连五';
  $('challenge-help-objective').textContent =
    reply && challenge.status === 'playing'
      ? `黑${label(reply.piece)} ${coord(reply.from)}→${coord(reply.to)}。找到下一手连五的路线。`
      : definition.description;
  const solved = challenge.status === 'solved';
  $('training-help-open').textContent = solved ? '看解法' : '提示';
  $('challenge-hint').hidden = $('challenge-hint-cost').hidden = solved;
  $('challenge-hint-text').hidden = !solved && !challenge.hintShown;
  $('challenge-hint-text').textContent = solved
    ? definition.explanation
    : reply
      ? definition.replyHint
      : definition.hint;
  $('challenge-hint').textContent = challenge.hintShown ? '提示已展开' : '提示';
  $('challenge-hint').disabled = busy || challenge.hintShown || challenge.status === 'solved';
  $('challenge-share').disabled = busy || networkBusy || challengeSharing;
  $('challenge-result-share').disabled = busy || networkBusy || challengeSharing;
  for (const id of ['challenge-select', 'challenge-exit']) $(id).disabled = busy || networkBusy;
}

function startChallenge(id) {
  const definition = getChallenge(id);
  if (!definition || room || busy || networkBusy) return;
  if (!challenge) {
    saveLocal();
    challengeReturn = { state, opponent, difficulty, restored };
  }
  cancelComputer();
  challenge = { definition, status: 'playing', hintShown: false };
  state = createChallengeState(id);
  selected = null;
  moving = false;
  threatPly = -1;
  resultAnnounced = false;
  resultDismissed = false;
  document.body.classList.add('challenge-active');
  $('challenge-share-fallback').hidden = true;
  $('challenge-share-message').textContent = '';
  $('challenge-result-message').textContent = '';
  const url = new URL(location.href);
  url.searchParams.set('challenge', id);
  history.replaceState(null, '', url);
  showScreen('game');
  buildBoard();
  setFocus(true);
  render();
  cells[definition.red[0][0]].focus({ preventScroll: true });
}

function finishChallengeTurn() {
  if (!challenge || challenge.status !== 'playing') return;
  challenge.status = challengeOutcome(challenge.definition.id, state);
  if (challenge.status === 'playing') return;
  const prior = challengeProgress[challenge.definition.id] || { stars: 0, attempts: 0 };
  const stars = challenge.status === 'solved' ? (challenge.hintShown ? 1 : 2) : 0;
  challengeProgress[challenge.definition.id] = {
    stars: Math.max(prior.stars, stars),
    attempts: Math.min(10000, prior.attempts + 1),
  };
  try {
    localStorage.setItem(
      CHALLENGE_SAVE_KEY,
      JSON.stringify({ version: 1, progress: challengeProgress }),
    );
    challengeStorageAvailable = true;
  } catch {
    challengeStorageAvailable = false;
  }
}

function exitChallenge() {
  if (!challenge || busy || networkBusy) return;
  cancelComputer();
  ({ state, opponent, difficulty, restored } = challengeReturn);
  challenge = null;
  challengeReturn = null;
  selected = null;
  moving = false;
  threatPly = -1;
  resultAnnounced = false;
  document.body.classList.remove('challenge-active');
  const url = new URL(location.href);
  url.searchParams.delete('challenge');
  history.replaceState(null, '', url);
  buildBoard();
  setFocus(true);
  showScreen('game');
  render();
}

function openChallenges() {
  if (room || busy || networkBusy) return;
  $('challenge-list').innerHTML = '';
  for (const [index, item] of CHALLENGES.entries()) {
    if (index === 0 || index === 6) {
      const heading = document.createElement('h3');
      heading.textContent = index === 0 ? '入门 · 单步练习' : '进阶 · 两手连招';
      $('challenge-list').append(heading);
    }
    const button = document.createElement('button');
    const stars = challengeProgress[item.id]?.stars || 0;
    button.type = 'button';
    button.className = 'challenge-card';
    button.dataset.challenge = item.id;
    button.classList.toggle('completed', stars > 0);
    button.innerHTML = `<span class="challenge-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${item.title}<span>${'★'.repeat(stars)}${'☆'.repeat(2 - stars)}</span></strong><small>${item.goal === 'two-turn' ? '两手连招' : item.goal === 'defend' ? '解除威胁' : '一手连五'}</small></div><span class="challenge-arrow" aria-hidden="true">›</span>`;
    button.addEventListener('click', () => startChallenge(item.id));
    $('challenge-list').append(button);
  }
  showScreen('challenges');
}
$('challenge-open').addEventListener('click', openChallenges);
$('challenge-quick-start').addEventListener('click', () =>
  startChallenge(recommendedChallenge(challengeProgress).id),
);
$('challenge-start-next').addEventListener('click', () =>
  startChallenge(recommendedChallenge(challengeProgress).id),
);
$('challenge-select').addEventListener('click', openChallenges);
$('challenge-exit').addEventListener('click', exitChallenge);
$('challenge-hint').addEventListener('click', () => {
  if (challenge && !busy && challenge.status !== 'solved') {
    challenge.hintShown = true;
    render();
  }
});
async function shareChallenge() {
  if (!challenge || busy || networkBusy || challengeSharing) return;
  const activeChallenge = challenge;
  const shareOrigin = currentScreen;
  const isCurrent = () => challenge === activeChallenge;
  const feedback = (message) => {
    if (isCurrent()) {
      $('challenge-share-message').textContent = message;
      $('challenge-result-message').textContent = message;
    }
  };
  challengeSharing = true;
  renderChallenge();
  try {
    const url = challengeLink(location.href, activeChallenge.definition.id);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `象五子棋 · ${activeChallenge.definition.title}`,
          text: challengeInvitation(
            activeChallenge.definition.id,
            activeChallenge.status === 'solved',
          ),
          url,
        });
        feedback('已打开分享，邀请好友解同一道题。');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          feedback('已取消分享。');
          return;
        }
      }
    }
    if (!isCurrent()) return;
    try {
      await navigator.clipboard.writeText(url);
      feedback('同题链接已复制。');
    } catch {
      if (!isCurrent()) return;
      $('challenge-share-link').value = url;
      $('challenge-share-fallback').hidden = false;
      if (currentScreen === shareOrigin) {
        if (currentScreen !== 'challenge-help') showScreen('challenge-help');
        $('challenge-share-link').focus();
        $('challenge-share-link').select();
        feedback('请长按或使用 Ctrl+C 复制下方链接。');
      } else feedback('同题链接已准备好，可在战术提示页长按复制。');
    }
  } finally {
    challengeSharing = false;
    renderChallenge();
  }
}
$('challenge-share').addEventListener('click', shareChallenge);
$('challenge-result-share').addEventListener('click', shareChallenge);

$('draw-button').addEventListener('click', () => {
  if (inputLocked()) return;
  setFocus(true);
  if (room) {
    void sendAction({ type: 'draw' });
    return;
  }
  try {
    draw(state);
    selected = null;
    moving = false;
    saveLocal();
    render();
  } catch (error) {
    hint(error.message);
  }
});
$('move-button').addEventListener('click', () => {
  if (inputLocked()) return;
  setFocus(true);
  moving = !moving;
  selected = null;
  render();
});
$('rules-open').addEventListener('click', () => showScreen('rules'));
function requestRestart(mode, nextOpponent = opponent) {
  if (busy) return;
  if (challenge) {
    startChallenge(challenge.definition.id);
    return;
  }
  restartMode = mode;
  restartOpponent = nextOpponent;
  restartDifficulty = currentScreen === 'setup' ? setupDraft.difficulty : difficulty;
  $('restart-description').textContent =
    `当前棋局将被清空，开始${nextOpponent === 'computer' ? '单人挑战（你执红）' : '双人同屏'}，使用 ${BOARDS[mode].cols}×${BOARDS[mode].rows} 棋盘。双方恢复各 16 枚棋子，红方先手。`;
  if (room)
    $('restart-description').textContent =
      '好友房间需双方同意重开。申请期间暂停走子，任一方可取消申请。';
  showScreen('restart');
}
function resetGame(mode, nextOpponent = opponent) {
  cancelComputer();
  opponent = nextOpponent;
  restored = false;
  threatPly = -1;
  state = newGame(mode);
  selected = null;
  moving = false;
  saveLocal();
  buildBoard();
  render();
}
document.querySelectorAll('[data-board], [data-difficulty]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!setupDraft || busy || networkBusy) return;
    if (button.dataset.board) setupDraft.mode = button.dataset.board;
    else setupDraft.difficulty = button.dataset.difficulty;
    renderSetup();
  });
});
$('setup-start').addEventListener('click', () => {
  if (busy || networkBusy || room || challenge || !setupDraft) return;
  const changed = setupDraft.mode !== state.mode || setupDraft.opponent !== opponent;
  if (changed && (state.ply || state.pending)) requestRestart(setupDraft.mode, setupDraft.opponent);
  else {
    difficulty = setupDraft.difficulty;
    if (changed) resetGame(setupDraft.mode, setupDraft.opponent);
    else saveLocal();
    showScreen('game');
    render();
  }
});
$('computer-retry').addEventListener('click', () => {
  computerError = '';
  render();
});
$('new-game').addEventListener('click', () => requestRestart(state.mode));
function restartResult() {
  if (busy || networkBusy || (!state.result && !challenge)) return;
  if (challenge) {
    const index = CHALLENGES.indexOf(challenge.definition);
    startChallenge(
      CHALLENGES[challenge.status === 'solved' ? (index + 1) % CHALLENGES.length : index].id,
    );
  } else if (room) {
    showScreen('game');
    void sendAction({ type: 'restart' });
  } else {
    resetGame(state.mode);
    showScreen('game');
    cells[0].focus({ preventScroll: true });
  }
}
$('result-restart').addEventListener('click', restartResult);
$('training-next').addEventListener('click', restartResult);
$('restart-confirm').addEventListener('click', () => {
  showScreen('game');
  if (room) void sendAction({ type: 'restart' });
  else {
    difficulty = restartDifficulty;
    resetGame(restartMode, restartOpponent);
  }
});
$('history-open').addEventListener('click', () => showScreen('history'));
document.addEventListener('contextmenu', (event) => event.preventDefault());
function setFocus(value) {
  focused = value;
  document.body.classList.toggle('play-focus', focused);
}
buildBoard();
showScreen('home', { replace: true });

// Room requests are serialized with animations; polling never races a local action.
function validSnapshot(data) {
  const s = data?.state,
    config = BOARDS[s?.mode];
  const validPiece = (p) => p && ['red', 'black'].includes(p.side) && TYPES.includes(p.type);
  const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < s.board.length;
  return (
    config &&
    s.cols === config.cols &&
    s.rows === config.rows &&
    Array.isArray(s.board) &&
    s.board.length === s.cols * s.rows &&
    s.board.every((p) => p === null || validPiece(p)) &&
    ['red', 'black'].includes(s.turn) &&
    (s.pending === null || validPiece(s.pending)) &&
    [null, 'red', 'black', 'draw'].includes(s.result) &&
    Number.isInteger(s.ply) &&
    s.ply >= 0 &&
    ['red', 'black'].every(
      (side) =>
        Array.isArray(s.pools?.[side]) &&
        s.pools[side].length <= 16 &&
        s.pools[side].every((type) => TYPES.includes(type)),
    ) &&
    Array.isArray(s.winningLine) &&
    s.winningLine.every(validIndex) &&
    Array.isArray(s.history) &&
    s.history.every(
      (e) =>
        ['deploy', 'move'].includes(e.action) &&
        validPiece(e.piece) &&
        ['red', 'black'].includes(e.side) &&
        validIndex(e.to) &&
        (e.action === 'deploy' || validIndex(e.from)) &&
        (!e.captured || validPiece(e.captured)) &&
        Number.isInteger(e.ply),
    ) &&
    Number.isInteger(data.version) &&
    typeof data.joined === 'boolean' &&
    Array.isArray(data.restartVotes) &&
    data.restartVotes.every((side) => ['red', 'black'].includes(side))
  );
}
async function roomRequest(server, path, body, token) {
  const response = await fetch(`${server}/api/rooms${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  }).catch(() => {
    throw new Error(room ? '连接中断，正在重试同步。' : '暂时无法连接房间服务，请检查网络后重试。');
  });
  const data = await response.json().catch(() => {
    throw new Error('该地址暂不支持好友房间，请检查服务地址。');
  });
  if (!response.ok)
    throw Object.assign(new Error(typeof data.error === 'string' ? data.error : '房间请求失败'), {
      status: response.status,
    });
  if (!validSnapshot(data)) throw new Error('房间返回了无效棋局');
  return data;
}
async function applySnapshot(data) {
  if (!room) return;
  const animate = state.mode === data.state.mode && data.state.ply === state.ply + 1;
  const rebuild = state.mode !== data.state.mode;
  state = data.state;
  room.version = data.version;
  room.joined = data.joined;
  room.restartVotes = data.restartVotes;
  if (data.joined) setFocus(true);
  threatPly = -1;
  selected = null;
  moving = false;
  if (rebuild) buildBoard();
  busy = animate;
  render();
  try {
    if (animate) await animateTurn($('board'), cells, state.history.at(-1), pieceMarkup);
  } finally {
    busy = false;
    render();
  }
}
async function sendAction(action) {
  if (!room || busy || networkBusy) return;
  roomError = '';
  networkBusy = true;
  render();
  try {
    if (pollTask) await pollTask;
    const data = await roomRequest(
      room.server,
      `/${room.code}/action`,
      { ...action, version: room.version },
      room.token,
    );
    networkHealthy = true;
    await applySnapshot(data);
  } catch (error) {
    if (!error.status) networkHealthy = false;
    roomError = error.message;
    $('room-message').textContent = error.message;
  } finally {
    networkBusy = false;
    render();
  }
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
  const status =
    roomError ||
    (!networkHealthy
      ? '连接中断，正在重试同步'
      : !room.joined
        ? '等待好友加入'
        : room.restartVotes.length
          ? `${sideName(room.restartVotes[0])}申请重开，点击重新开局同意`
          : '已连接');
  $('room-status').textContent =
    `${room.code} · 你执${room.side === 'red' ? '红' : '黑'} · ${status}`;
  if (roomError || !networkHealthy || !room.joined || room.restartVotes.length) hint(status);
  else if (room.side !== state.turn && !state.result) hint(`等待${sideName(state.turn)}落子。`);
}
function endpoint() {
  const url = new URL($('room-server').value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('请输入 http 或 https 服务地址，不要包含账号密码');
  return url.origin;
}
async function connectRoom(join) {
  if (room || challenge || networkBusy || busy || !roomServiceReady) return;
  cancelComputer();
  roomError = '';
  networkBusy = true;
  render();
  try {
    const server = endpoint();
    const code = $('room-code').value.trim().toUpperCase();
    if (join && !/^[A-F0-9]{8}$/.test(code)) throw new Error('请输入 8 位有效房间码');
    const data = await roomRequest(
      server,
      join ? `/${code}/join` : '',
      join ? {} : { mode: state.mode },
    );
    if (
      !/^[A-F0-9]{8}$/.test(data.code) ||
      !/^[a-f0-9]{48}$/.test(data.token) ||
      !['red', 'black'].includes(data.side)
    )
      throw new Error('房间身份格式无效');
    cancelComputer();
    saveLocal();
    room = {
      server,
      code: data.code,
      token: data.token,
      side: data.side,
      version: -1,
      joined: false,
      restartVotes: [],
    };
    try {
      sessionStorage.setItem('xiangqi-room', JSON.stringify(room));
    } catch {
      /* Private browser storage can be unavailable. */
    }
    networkHealthy = true;
    await applySnapshot(data);
    prepareInvite();
    $('room-message').textContent =
      `你执${sideName(room.side)}。${join ? '加入成功，可以开始对弈。' : '把邀请链接发给好友，等待对方加入。'}`;
  } catch (error) {
    $('room-message').textContent = error.message;
  } finally {
    networkBusy = false;
    render();
  }
}
function prepareInvite() {
  $('room-server').value = room.server;
  $('room-code').value = room.code;
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
  roomServiceReady = false;
  renderRoom();
  $('room-message').textContent = '正在连接房间服务…';
  try {
    const response = await fetch(`${endpoint()}/api/rooms/health`, {
      signal: AbortSignal.timeout(4000),
    });
    const data = await response.json();
    roomServiceReady = response.ok && data.service === 'xiangqi-five';
  } catch {
    /* Static hosting remains fully playable without a room service. */
  }
  $('room-message').textContent = roomServiceReady
    ? '可创建房间，或输入好友发来的房间码。'
    : '暂未开放在线房间。可选择单人挑战或双人同屏。';
  renderRoom();
}
function openRoom() {
  showScreen('room');
  void checkRoomService();
}
$('room-open').addEventListener('click', openRoom);
$('tools-room').addEventListener('click', openRoom);
$('room-play').addEventListener('click', () => {
  showScreen('game');
  render();
});
$('room-server').addEventListener('change', () => void checkRoomService());
$('room-local').addEventListener('click', () => {
  showScreen('game');
  if (state.ply || state.pending) requestRestart(state.mode, 'local');
  else resetGame(state.mode, 'local');
});
$('room-create').addEventListener('click', () => connectRoom(false));
$('room-join').addEventListener('click', () => connectRoom(true));
$('cancel-restart').addEventListener('click', () => sendAction({ type: 'cancel-restart' }));
$('room-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('room-invite').value);
    $('room-message').textContent = '邀请链接已复制。';
  } catch {
    $('room-invite').select();
    $('room-message').textContent = '请长按或使用 Ctrl+C 复制选中的邀请链接。';
  }
});
$('room-leave').addEventListener('click', () => {
  if (busy || networkBusy) return;
  room = null;
  networkHealthy = true;
  roomError = '';
  const localUrl = new URL(location.href);
  localUrl.hash = '';
  history.replaceState(null, '', localUrl);
  try {
    sessionStorage.removeItem('xiangqi-room');
  } catch {
    /* Storage may be disabled. */
  }
  showScreen('game');
  let saved;
  try {
    saved = decodeGame(localStorage.getItem(SAVE_KEY));
  } catch {
    /* Storage may be disabled. */
  }
  if (saved) {
    ({ state, opponent, difficulty } = saved);
    selected = null;
    moving = false;
    restored = true;
    threatPly = -1;
    buildBoard();
    render();
  } else resetGame(state.mode);
});
async function pollRoom() {
  if (!room || busy || networkBusy || pollTask) return;
  const currentRoom = room;
  pollTask = (async () => {
    let changed = false;
    try {
      const data = await roomRequest(
        currentRoom.server,
        `/${currentRoom.code}`,
        null,
        currentRoom.token,
      );
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
      changed = networkHealthy;
      networkHealthy = false;
      roomError = error.message;
      $('room-message').textContent = error.message;
    } finally {
      if (changed && room === currentRoom) render();
    }
  })();
  try {
    await pollTask;
  } finally {
    pollTask = null;
  }
}
setInterval(pollRoom, 1000);
try {
  const saved = JSON.parse(sessionStorage.getItem('xiangqi-room') || 'null');
  if (
    saved &&
    /^[A-F0-9]{8}$/.test(saved.code) &&
    /^[a-f0-9]{48}$/.test(saved.token) &&
    ['red', 'black'].includes(saved.side) &&
    (!invitation.has('room') || invitation.get('room') === saved.code)
  ) {
    const url = new URL(saved.server);
    if (['http:', 'https:'].includes(url.protocol) && url.origin === saved.server) {
      room = { ...saved, version: -1, joined: false, restartVotes: [] };
      networkHealthy = false;
      prepareInvite();
      showScreen('room', { replace: true });
      render();
      void pollRoom();
    }
  }
} catch {
  /* Invalid or inaccessible saved room: remain in local mode. */
}
render();
if (invitation.has('room') && !room) {
  showScreen('room');
  void checkRoomService();
}
const initialChallenge = challengeFromUrl(location.href);
if (initialChallenge && !room && !invitation.has('room')) startChallenge(initialChallenge);

// The host resets its display state when the iframe finishes loading.
// Notify again on the next task so deep links retain the immersive game view.
const notifyAfterLoad = () => setTimeout(() => notifyDisplayState(), 0);
if (document.readyState === 'complete') notifyAfterLoad();
else window.addEventListener('load', notifyAfterLoad, { once: true });
