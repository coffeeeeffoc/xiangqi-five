import { newGame, TYPES, COUNTS, findFive, move } from './game.js';
import { legalActions, winningActions } from './computer.js';

// Fixed, public training positions. Their remaining reserves have been exhausted.
// These are mixed-chess five-in-a-row exercises, not checkmate puzzles.
export const CHALLENGES = [
  {
    id: 'rook-bridge', title: '一车架桥', goal: 'five',
    description: '红方走一步，把不同棋种接成横向五连。',
    hint: '四枚红子已经在第五行。找一枚不在线上的车，补到 F5。',
    explanation: 'F2 → F5：车补进横线。五连只看颜色，不要求相同棋种。',
    red: [[37, 'pawn'], [38, 'horse'], [39, 'elephant'], [40, 'advisor'], [14, 'rook']],
    black: [[36, 'pawn'], [80, 'king']],
  },
  {
    id: 'horse-leg', title: '两马一条路', goal: 'five',
    description: '两匹马都看似能补缺口，找出真正能成五的那一步。',
    hint: '缺口在 E5。D3 的马腿是 D4；F3 的马腿是 F4。',
    explanation: 'D3 → E5：另一匹马被 F4 的黑卒蹩腿，不能跳进缺口。',
    red: [[37, 'pawn'], [38, 'advisor'], [39, 'elephant'], [41, 'king'], [21, 'horse'], [23, 'horse']],
    black: [[32, 'pawn'], [80, 'king']],
  },
  {
    id: 'elephant-eye', title: '斜线藏象眼', goal: 'five',
    description: '补上斜线断点；先检查两步之间的象眼。',
    hint: '缺口在 D5。B7 的象眼 C6 是空位，F3 的象眼 E4 被挡住。',
    explanation: 'B7 → D5：象走田、眼要通。不同棋种沿斜线也能连成五枚。',
    red: [[19, 'pawn'], [29, 'rook'], [49, 'advisor'], [59, 'king'], [55, 'elephant'], [23, 'elephant']],
    black: [[31, 'pawn'], [80, 'king']],
  },
  {
    id: 'cannon-link', title: '借卒为炮架', goal: 'five',
    description: '黑将占着断点。吃将本身不算赢，连五才算。',
    hint: 'C2 的炮与 C6 黑将之间只有 C3 一枚黑卒，恰好可作炮架。',
    explanation: 'C2 → C6：炮隔一子吃将，接成 A6–E6 五连。B6 兵吃将会留下 B6 的空缺，不能成五。',
    red: [[45, 'rook'], [46, 'pawn'], [48, 'advisor'], [49, 'horse'], [11, 'cannon'], [2, 'cannon']],
    black: [[47, 'king'], [20, 'pawn']],
  },
  {
    id: 'pawn-return', title: '兵退一步', goal: 'five',
    description: '舍近处的吃将机会，用兵接出一条斜线。',
    hint: 'C3 是斜线起点。C2 的兵可向下走一格；本游戏兵可向四个方向走。',
    explanation: 'C2 → C3：兵可以后退。C3–G7 连五获胜，吃掉 D2 的将不会直接获胜。',
    red: [[30, 'advisor'], [40, 'elephant'], [50, 'horse'], [60, 'king'], [11, 'pawn']],
    black: [[12, 'king']],
  },
  {
    id: 'break-threat', title: '堵点还是拆线', goal: 'defend',
    description: '红方走一步，让黑方下一手无论怎样走都不能立即连五。',
    hint: '直接堵 E6 会被黑车吃掉后连五。吃掉 E2 黑车，或在车路上游拦住它，都能防住。',
    explanation: '防守可以有多个答案：吃掉 E2 黑车，或挡在 E3 / E4 / E5。只堵 E6，黑车仍可吃掉堵子连五。',
    red: [[67, 'rook']],
    black: [[45, 'pawn'], [46, 'advisor'], [47, 'elephant'], [48, 'horse'], [13, 'rook']],
  },
  {
    id: 'crossroads', title: '十字路口，顾此失彼', goal: 'two-turn',
    description: '第一手造双威胁；黑方会拆线，第二手用另一条线成五。',
    hint: 'H5 车到 E5，横竖都接成四枚。F6 的车留着兑现下一手。',
    replyHint: '黑方只拆得掉一条线。看看 F6 的车能补 F5 还是 E6，按当前局面选择。',
    explanation: '填进交点，制造横、竖两条威胁。黑方无论怎样合法应对，红方仍有下一手成五；答案由局面决定。',
    red: [[37, 'pawn'], [38, 'advisor'], [39, 'elephant'], [13, 'pawn'], [22, 'horse'], [31, 'king'], [43, 'rook'], [50, 'rook']],
    black: [[4, 'rook'], [36, 'rook'], [80, 'king']],
  },
  {
    id: 'cannon-cross', title: '炮响之后，还差一手', goal: 'two-turn',
    description: '两手内连五。先吃将也不能庆祝，黑方还会合法应对。',
    hint: 'H5 炮隔着 F5 红相吃 E5 黑将，造出十字威胁。也可以找另一种先吃将的迫胜方案。',
    replyHint: '先看黑方刚拆了哪里，再用 G6 的车补 G5 或 E6。吃将只是第一步，连五才算赢。',
    explanation: '红相也能当炮架；炮吃将后继续接线。帅先吃将、再由车补横线也是有效解法，不限制为一个答案。',
    red: [[38, 'pawn'], [39, 'advisor'], [41, 'elephant'], [13, 'pawn'], [22, 'horse'], [31, 'king'], [43, 'cannon'], [51, 'rook']],
    black: [[40, 'king'], [4, 'rook'], [49, 'horse']],
  },
];

export const CHALLENGE_SAVE_KEY = 'xiangqi-five-challenges-v1';
export const getChallenge = (id) => typeof id === 'string' && /^[a-z][a-z-]{2,30}$/.test(id) ? CHALLENGES.find((item) => item.id === id) : undefined;

export function createChallengeState(id) {
  const challenge = getChallenge(id);
  if (!challenge) throw new Error('未知战术挑战');
  const state = newGame();
  state.pools = { red: [], black: [] };
  for (const side of ['red', 'black']) {
    for (const [index, type] of challenge[side]) {
      if (!Number.isInteger(index) || index < 0 || index >= state.board.length || state.board[index] || !TYPES.includes(type)) throw new Error('无效练习局面');
      state.board[index] = { side, type };
    }
    if (TYPES.some((type, i) => state.board.filter((p) => p?.side === side && p.type === type).length > COUNTS[i]) || findFive(state.board, side).length) throw new Error('无效练习棋子');
  }
  return state;
}

export function challengeOutcome(id, state) {
  const challenge = getChallenge(id);
  if (!challenge) throw new Error('未知战术挑战');
  if (state.ply === 0) return 'playing';
  if (challenge.goal === 'two-turn') {
    if (state.ply > 3 || state.history.some((event, index) => event.side !== (index % 2 ? 'black' : 'red'))) return 'failed';
    if (state.result === 'red') return 'solved';
    return state.result || state.ply === 3 ? 'failed' : 'playing';
  }
  if (state.ply !== 1 || state.history[0]?.side !== 'red') return 'failed';
  if (challenge.goal === 'five') return state.result === 'red' ? 'solved' : 'failed';
  return state.result !== 'black' && winningActions({ ...state, turn: 'black', pending: null }, 'black').length === 0 ? 'solved' : 'failed';
}

/** A legal defender: minimize the player's next winning moves, then prefer a capture. */
export function challengeReply(id, state) {
  if (getChallenge(id)?.goal !== 'two-turn' || state.turn !== 'black' || state.result) return null;
  let best = null, bestScore = Infinity;
  for (const action of legalActions(state)) {
    const reply = structuredClone(state);
    move(reply, action.from, action.to);
    const score = reply.result === 'black' ? -1000 : reply.result === 'draw' ? -100 :
      winningActions(reply, 'red').length * 10 - Number(Boolean(state.board[action.to]));
    if (score < bestScore) { best = action; bestScore = score; }
  }
  return best;
}

export function challengeMilestones(progress) {
  const completed = (items) => items.filter((item) => progress[item.id]?.stars > 0).length;
  return { basics: completed(CHALLENGES.filter((item) => item.goal !== 'two-turn')),
    combos: completed(CHALLENGES.filter((item) => item.goal === 'two-turn')),
    stars: CHALLENGES.reduce((sum, item) => sum + (progress[item.id]?.stars || 0), 0) };
}

export function recommendedChallenge(progress) {
  return CHALLENGES.find((item) => !progress[item.id]?.stars) ||
    CHALLENGES.find((item) => progress[item.id]?.stars < 2) || CHALLENGES[0];
}

export function challengeInvitation(id, solved = false) {
  const item = getChallenge(id);
  if (!item) throw new Error('未知战术挑战');
  return `${solved ? '这题我解开了，你来试试' : '一起试试这题'}：「${item.title}」。${item.goal === 'two-turn' ? '黑方会反击，你能两手成五吗？' : item.goal === 'defend' ? '堵住落点就安全了吗？' : '吃将不算赢，你能一手连五吗？'}`;
}

export function challengeFromUrl(href) {
  const url = new URL(href);
  const ids = url.searchParams.getAll('challenge');
  return ids.length === 1 && getChallenge(ids[0]) ? ids[0] : null;
}

export function challengeLink(href, id) {
  if (!getChallenge(id)) throw new Error('未知战术挑战');
  const url = new URL(href);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请通过网页地址分享练习');
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  url.searchParams.set('challenge', id);
  return url.href;
}

export function decodeChallengeProgress(text) {
  if (!text || text.length > 4096) return {};
  try {
    const saved = JSON.parse(text);
    if (saved.version !== 1 || !saved.progress || typeof saved.progress !== 'object') return {};
    const result = {};
    for (const item of CHALLENGES) {
      const record = saved.progress[item.id];
      if (record && [0, 1, 2].includes(record.stars) && Number.isInteger(record.attempts) && record.attempts >= 0 && record.attempts <= 10000) result[item.id] = { stars: record.stars, attempts: record.attempts };
    }
    return result;
  } catch { return {}; }
}
