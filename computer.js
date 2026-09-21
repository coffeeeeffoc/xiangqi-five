import { canMove, deploy, move, deployDirectly, hasAction } from './game.js';

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
  if (state.result) return [];
  const wins = [], seen = new Set();
  for (const line of linesFor(state).lines) {
    let to = -1, gaps = 0;
    for (const i of line) if (state.board[i]?.side !== side) { to = i; if (++gaps > 1) break; }
    if (gaps !== 1) continue;
    if (!state.board[to] && (state.pending?.side === side || state.pools[side].length) && !seen.has(`d${to}`)) {
      wins.push({ type: 'deploy', to }); seen.add(`d${to}`);
    }
    if (state.pending) continue;
    state.board.forEach((piece, from) => {
      if (piece?.side !== side || line.includes(from) || seen.has(`${from}:${to}`)) return;
      if (canMove(state.board, from, to, state.cols)) {
        wins.push({ type: 'move', from, to }); seen.add(`${from}:${to}`);
      }
    });
  }
  return wins;
}

const opposite = (side) => side === 'red' ? 'black' : 'red';
const WIN = 1000000;
// Kings have no royal status in this game's rules; all pieces can make five.
const VALUES = { rook: 600, cannon: 400, horse: 340, elephant: 250, advisor: 220, king: 240, pawn: 240 };
const LINE_WEIGHTS = [0, 0, 12, 100, 1200, WIN];
export const DIFFICULTIES = {
  practice: { depth: 2, width: 4, rootWidth: 8, quiescence: 2, timeMs: 250, nodes: 4000 },
  standard: { depth: 3, width: 6, rootWidth: 12, quiescence: 3, timeMs: 900, nodes: 18000 },
  hard: { depth: 5, width: 8, rootWidth: 12, quiescence: 4, timeMs: 4000, nodes: 80000 },
};

// Optional captures on one square, with actual blockers updated after each exchange.
// ponytail: least valuable attacker, up to 6 captures; the tree search checks alternative attackers.
function exchangeGain(state, to, side, remaining = 6) {
  if (!remaining || !state.board[to] || state.board[to].side === side) return 0;
  let from = -1;
  state.board.forEach((piece, i) => {
    if (piece?.side === side && (from < 0 || VALUES[piece.type] < VALUES[state.board[from].type]) && canMove(state.board, i, to, state.cols)) from = i;
  });
  if (from < 0) return 0;
  const captured = VALUES[state.board[to].type];
  return Math.max(0, captured - withAction(state, { type: 'move', from, to }, side,
    () => exchangeGain(state, to, opposite(side), remaining - 1)));
}

function lineScore(state, line, side) {
  let own = 0, other = 0;
  for (const i of line) {
    const p = state.board[i];
    if (p) { if (p.side === side) own++; else other++; }
  }
  return (other ? 0 : LINE_WEIGHTS[own]) - (own ? 0 : LINE_WEIGHTS[other]);
}

function centerValue(state, i) {
  return -Math.abs(i % state.cols - (state.cols - 1) / 2) - Math.abs(Math.floor(i / state.cols) - (state.rows - 1) / 2);
}

function tacticalBalance(state, side) {
  let score = 0;
  for (const player of [side, opposite(side)]) {
    const sign = player === side ? 1 : -1;
    let risk = 0, largest = 0;
    state.board.forEach((piece, i) => {
      if (piece?.side !== player) return;
      const loss = exchangeGain(state, i, opposite(player));
      risk += loss; largest = Math.max(largest, loss);
    });
    score -= sign * (largest * .8 + risk * .15);
  }
  return score;
}

function positionScore(state, side) {
  let score = 0;
  for (const line of linesFor(state).lines) score += lineScore(state, line, side);
  state.board.forEach((piece, i) => {
    if (piece) score += (piece.side === side ? 1 : -1) * (VALUES[piece.type] + centerValue(state, i));
  });
  for (const player of [side, opposite(side)]) {
    const sign = player === side ? 1 : -1;
    // Reserves are useful, but an active, safe piece also develops the position.
    for (const type of state.pools[player]) score += sign * VALUES[type] * .65;
    if (state.pending?.side === player) score += sign * VALUES[state.pending.type] * .65;
  }
  return score;
}

function evaluate(state, side) {
  return positionScore(state, side) + tacticalBalance(state, side);
}

function outcomesFor(state, action) {
  if (action.type === 'move') return [[state.board[action.from].type, 1]];
  if (state.pending) return [[state.pending.type, 1]];
  const counts = new Map();
  for (const type of state.pools[state.turn]) counts.set(type, (counts.get(type) || 0) + 1);
  return [...counts].map(([type, count]) => [type, count / state.pools[state.turn].length]);
}

function withOutcome(state, action, type, inspect) {
  const side = state.turn, pending = state.pending, pool = state.pools[side];
  const target = state.board[action.to], piece = action.type === 'move' ? state.board[action.from] : { side, type };
  const index = action.type === 'deploy' && !pending ? pool.indexOf(type) : -1;
  if (index >= 0) pool.splice(index, 1);
  if (action.type === 'move') state.board[action.from] = null;
  state.board[action.to] = piece; state.pending = null; state.turn = opposite(side);
  try { return inspect(); }
  finally {
    state.turn = side; state.pending = pending; state.board[action.to] = target;
    if (action.type === 'move') state.board[action.from] = piece;
    if (index >= 0) pool.splice(index, 0, type);
  }
}

// Geometry of a five/defense does not depend on the deployed piece's type.
function candidates(state, width, capturesOnly = false) {
  const side = state.turn, enemy = opposite(side);
  const threatened = winningActions({ ...state, turn: enemy, pending: null }, enemy).length > 0;
  const actions = [];
  if (capturesOnly && !threatened) {
    state.board.forEach((piece, from) => {
      if (state.pending || piece?.side !== side) return;
      state.board.forEach((target, to) => {
        if (target?.side === enemy && canMove(state.board, from, to, state.cols)) actions.push({ type: 'move', from, to });
      });
    });
  } else actions.push(...legalActions(state));
  const ranked = [];
  const base = positionScore(state, side), { byCell } = linesFor(state);
  const risks = state.board.map((piece, i) => piece ? exchangeGain(state, i, opposite(piece.side)) : 0);
  for (const action of actions) {
    if (capturesOnly && !threatened && (action.type !== 'move' || !state.board[action.to])) continue;
    // Losing optional exchanges are left to the full search, not expanded forever at its leaves.
    if (capturesOnly && !threatened && VALUES[state.board[action.to].type] < withAction(state, action, side,
      () => exchangeGain(state, action.to, enemy))) continue;
    if (threatened && withAction(state, action, side, () => winningActions({ ...state, turn: enemy, pending: null }, enemy).length)) continue;
    // Only lines touching the source/destination can change; don't rescan the 15x15 board per draw outcome.
    const lines = new Set([...byCell[action.to], ...(action.type === 'move' ? byCell[action.from] : [])]);
    let before = 0;
    for (const line of lines) before += lineScore(state, line, side);
    const captured = state.board[action.to];
    const captureValue = captured ? VALUES[captured.type] + centerValue(state, action.to) : 0;
    let score = 0;
    for (const [type, probability] of outcomesFor(state, action)) {
      const material = action.type === 'move' ? captureValue + centerValue(state, action.to) - centerValue(state, action.from)
        : VALUES[type] * .35 + centerValue(state, action.to);
      score += probability * withOutcome(state, action, type, () => {
        let after = 0;
        for (const line of lines) after += lineScore(state, line, side);
        const rescued = action.type === 'move' ? risks[action.from] : 0;
        return base + material + after - before + .95 * (rescued - risks[action.to] - exchangeGain(state, action.to, enemy));
      });
    }
    ranked.push({ action, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  // ponytail: selective search keeps mobile turns bounded; widen only after profiling.
  // Forced defenses are checked across ALL legal moves before limiting quiet moves.
  return { ranked: threatened ? ranked : ranked.slice(0, width), threatened, hasActions: actions.length > 0 || (capturesOnly && hasAction(state)) };
}

export function searchPosition(input, difficulty = 'standard', limits = {}) {
  const config = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
  const state = structuredClone(input);
  const stats = { action: null, score: 0, depth: 0, nodes: 0, qnodes: 0, chanceOutcomes: 0, elapsedMs: 0 };
  const started = performance.now(), deadline = started + (limits.timeMs ?? config.timeMs);
  const maxNodes = limits.nodes ?? config.nodes, stopped = Symbol('search budget');
  const table = new Map();
  const checkBudget = () => {
    if (++stats.nodes > maxNodes || performance.now() >= deadline) throw stopped;
  };
  const wins = winningActions(state);
  if (wins.length) { stats.action = wins[0]; stats.score = WIN; return stats; }
  const root = candidates(state, config.rootWidth);
  if (!root.ranked.length) {
    stats.action = legalActions(state)[0] || null;
    stats.score = root.threatened ? -WIN : 0;
    stats.elapsedMs = performance.now() - started;
    return stats;
  }
  const previous = state.history.at(-2);
  const reversalCost = (action) => action.type === 'move' && previous?.from === action.to && previous?.to === action.from ? 12 : 0;
  for (const candidate of root.ranked) candidate.score -= reversalCost(candidate.action);
  root.ranked.sort((a, b) => b.score - a.score);
  stats.action = root.ranked[0].action; stats.score = root.ranked[0].score;

  function actionValue(action, depth, alpha, beta, qleft, ply) {
    const outcomes = outcomesFor(state, action);
    let value = 0;
    for (const [type, probability] of outcomes) {
      checkBudget();
      if (outcomes.length > 1) stats.chanceOutcomes++;
      // Alpha-beta bounds cannot be averaged as exact scores at a chance node.
      value += probability * withOutcome(state, action, type, () => -search(depth - 1,
        outcomes.length > 1 ? -Infinity : -beta, outcomes.length > 1 ? Infinity : -alpha, qleft, ply + 1));
    }
    return value;
  }

  function search(depth, alpha, beta, qleft, ply) {
    checkBudget();
    const key = `${state.turn}:${state.pending?.type || ''}:${state.pools.red.join(',')}:${state.pools.black.join(',')}:${depth}:${qleft}:${ply}:` + state.board.map((p) => p ? `${p.side[0]}${p.type}` : '').join('|');
    if (table.has(key)) return table.get(key);
    const initialAlpha = alpha;
    if (winningActions(state).length) return WIN - ply;
    if (!hasAction(state)) return 0;
    const quiet = depth <= 0;
    if (quiet) stats.qnodes++;
    if (quiet && qleft <= 0) {
      // Never call an immediately lost position "quiet", even at the extension cap.
      const enemy = opposite(state.turn);
      if (winningActions({ ...state, turn: enemy, pending: null }, enemy).length) {
        const defenses = candidates(state, config.width, true);
        if (!defenses.ranked.length) return -WIN + ply + 1;
      }
      return evaluate(state, state.turn);
    }
    const next = candidates(state, config.width, quiet);
    if (!next.hasActions) return 0;
    if (next.threatened && !next.ranked.length) return -WIN + ply + 1;
    let best = quiet && !next.threatened ? evaluate(state, state.turn) : -Infinity;
    // An imminent five requires a real evasion; standing pat is not legal then.
    if (best >= beta) return best;
    alpha = Math.max(alpha, best);
    for (const { action } of next.ranked) {
      const score = actionValue(action, depth, alpha, beta, quiet ? qleft - 1 : qleft, ply);
      best = Math.max(best, score); alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    // Only cache exact values; cutoff bounds must not become chance-node expectations.
    if (best > initialAlpha && best < beta && table.size < 20000) table.set(key, best);
    return best;
  }

  try {
    for (let depth = 1; depth <= (limits.depth ?? config.depth); depth++) {
      const completed = [];
      let alpha = -Infinity;
      for (const candidate of root.ranked) {
        const penalty = reversalCost(candidate.action);
        const score = actionValue(candidate.action, depth, alpha + penalty, Infinity, limits.quiescence ?? config.quiescence, 0) - penalty;
        completed.push({ action: candidate.action, score });
        alpha = Math.max(alpha, score);
      }
      completed.sort((a, b) => b.score - a.score);
      stats.action = completed[0].action; stats.score = completed[0].score; stats.depth = depth;
      root.ranked = completed;
      if (Math.abs(stats.score) > WIN / 2) break;
    }
  } catch (error) { if (error !== stopped) throw error; }
  stats.elapsedMs = performance.now() - started;
  return stats;
}

export function chooseAction(state, difficulty = 'standard') {
  return searchPosition(state, difficulty).action;
}

export function applyComputerAction(state, action, random = Math.random) {
  if (!action) return;
  if (action.type === 'move') move(state, action.from, action.to);
  else if (state.pending) deploy(state, action.to);
  else deployDirectly(state, action.to, random);
}
