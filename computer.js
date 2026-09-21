import { canMove, deploy, move, deployDirectly } from './game.js';

const layouts = new Map();
function linesFor(state) {
  if (layouts.has(state.mode)) return layouts.get(state.mode);
  const lines = [], byCell = state.board.map(() => []);
  for (let y = 0; y < state.rows; y++) for (let x = 0; x < state.cols; x++) {
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
      if (x + 4 * dx < 0 || x + 4 * dx >= state.cols || y + 4 * dy >= state.rows) continue;
      const line = Array.from({ length: 5 }, (_, n) => (y + n * dy) * state.cols + x + n * dx);
      lines.push(line);
      for (const i of line) byCell[i].push(line);
    }
  }
  const layout = { lines, byCell };
  layouts.set(state.mode, layout);
  return layout;
}

export function legalActions(state, side = state.turn) {
  if (state.result) return [];
  const actions = [];
  for (let to = 0; to < state.board.length; to++) {
    if (!state.board[to] && (state.pending?.side === side || state.pools[side].length)) actions.push({ type: 'deploy', to });
  }
  if (state.pending) return actions;
  state.board.forEach((piece, from) => {
    if (piece?.side !== side) return;
    for (let to = 0; to < state.board.length; to++) if (canMove(state.board, from, to, state.cols)) actions.push({ type: 'move', from, to });
  });
  return actions;
}

function withAction(state, action, side, inspect) {
  const target = state.board[action.to];
  const piece = action.type === 'move' ? state.board[action.from] : state.pending || { side, type: 'pawn' };
  if (action.type === 'move') state.board[action.from] = null;
  state.board[action.to] = piece;
  try { return inspect(); }
  finally {
    state.board[action.to] = target;
    if (action.type === 'move') state.board[action.from] = piece;
  }
}

export function winningActions(state, side = state.turn) {
  const { byCell } = linesFor(state);
  return legalActions(state, side).filter((action) => withAction(state, action, side,
    () => byCell[action.to].some((line) => line.every((i) => state.board[i]?.side === side))));
}

export function chooseAction(state, difficulty = 'standard') {
  const actions = legalActions(state);
  if (!actions.length) return null;
  const side = state.turn, enemy = side === 'red' ? 'black' : 'red';
  const wins = winningActions(state);
  if (wins.length) return wins[0];
  const { lines } = linesFor(state);
  const weights = [0, 1, 8, 70, 900, 100000];
  const score = () => lines.reduce((total, line) => {
    let own = 0, other = 0;
    for (const i of line) { own += state.board[i]?.side === side; other += state.board[i]?.side === enemy; }
    return total + (other ? 0 : weights[own]) - (own ? 0 : weights[other] * 1.2);
  }, 0);
  const previous = state.history.at(-2);
  const ranked = actions.map((action) => ({ action, score: withAction(state, action, side, score)
    + (state.board[action.to] ? 5 : 0)
    - (action.type === 'move' && previous?.from === action.to && previous?.to === action.from ? 12 : 0)
  })).sort((a, b) => b.score - a.score);
  // ponytail: inspect the best 16 moves, not an unbounded game tree; deeper search belongs in this worker if playtests need it.
  if (difficulty === 'standard') {
    const threats = winningActions({ ...state, turn: enemy, pending: null }, enemy);
    for (const candidate of ranked.slice(0, 16)) {
      const danger = withAction(state, candidate.action, side, () => {
        const next = { ...state, turn: enemy, pending: null };
        return winningActions(next, enemy).length;
      });
      candidate.score -= danger * 1000000;
      if (threats.length && !danger) candidate.score += 10000;
    }
    // Unsearched moves cannot outrank a proven safe move or masquerade as safe.
    return ranked.slice(0, 16).sort((a, b) => b.score - a.score)[0].action;
  }
  return ranked[0].action;
}

export function applyComputerAction(state, action, random = Math.random) {
  if (!action) return;
  if (action.type === 'move') move(state, action.from, action.to);
  else if (state.pending) deploy(state, action.to);
  else deployDirectly(state, action.to, random);
}
