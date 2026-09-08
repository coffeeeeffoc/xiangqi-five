export const COLS = 9;
export const ROWS = 10;
export const BOARDS = { xiangqi: { cols: 9, rows: 10 }, gomoku: { cols: 15, rows: 15 } };
export const TYPES = ['rook', 'horse', 'elephant', 'advisor', 'king', 'cannon', 'pawn'];
export const COUNTS = [2, 2, 2, 2, 1, 2, 5];
export const NAMES = {
  red: ['车', '马', '相', '士', '帅', '炮', '兵'],
  black: ['车', '马', '象', '士', '将', '炮', '卒'],
};
export const label = (piece) => NAMES[piece.side][TYPES.indexOf(piece.type)];
export const sideName = (side) => side === 'red' ? '红方' : '黑方';
const valid = (index, board) => Number.isInteger(index) && index >= 0 && index < board.length;

export function newGame(mode = 'xiangqi') {
  if (!Object.hasOwn(BOARDS, mode)) throw new Error('未知棋盘类型');
  const { cols, rows } = BOARDS[mode];
  const pool = () => TYPES.flatMap((type, i) => Array(COUNTS[i]).fill(type));
  return {
    mode, cols, rows, board: Array(cols * rows).fill(null),
    pools: { red: pool(), black: pool() },
    turn: 'red', ply: 0, pending: null, result: null, winningLine: [], history: [],
  };
}

export function canMove(board, from, to, cols = COLS) {
  if (!valid(from, board) || !valid(to, board) || from === to || !board[from]) return false;
  const piece = board[from];
  if (board[to]?.side === piece.side) return false;
  const x = from % cols, y = Math.floor(from / cols);
  const tx = to % cols, ty = Math.floor(to / cols);
  const dx = tx - x, dy = ty - y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  switch (piece.type) {
    case 'rook':
    case 'cannon': {
      if (dx !== 0 && dy !== 0) return false;
      const step = dx === 0 ? Math.sign(dy) * cols : Math.sign(dx);
      let blockers = 0;
      for (let i = from + step; i !== to; i += step) if (board[i]) blockers++;
      return blockers === (piece.type === 'cannon' && board[to] ? 1 : 0);
    }
    case 'horse':
      if (!((ax === 2 && ay === 1) || (ax === 1 && ay === 2))) return false;
      return !board[from + (ax === 2 ? Math.sign(dx) : Math.sign(dy) * cols)];
    case 'elephant':
      return ax === 2 && ay === 2 && !board[from + dy / 2 * cols + dx / 2];
    case 'advisor': return ax === 1 && ay === 1;
    case 'king':
    case 'pawn': return ax + ay === 1;
    default: return false;
  }
}

export function findFive(board, side, cols = COLS) {
  const rows = board.length / cols;
  for (let i = 0; i < board.length; i++) {
    if (board[i]?.side !== side) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
      const line = [];
      let x = i % cols, y = Math.floor(i / cols);
      while (x >= 0 && x < cols && y < rows && board[y * cols + x]?.side === side) {
        line.push(y * cols + x);
        x += dx; y += dy;
      }
      if (line.length >= 5) return line;
    }
  }
  return [];
}

export function hasAction(state) {
  if (state.pools[state.turn].length && state.board.some((p) => !p)) return true;
  return hasMove(state);
}

export function hasMove(state) {
  return state.board.some((p, from) => p?.side === state.turn &&
    state.board.some((_, to) => canMove(state.board, from, to, state.cols)));
}

export function canDeployDirectly(state) {
  return !state.result && !state.pending && state.pools[state.turn].length > 0 &&
    state.board.some((p) => !p) && !hasMove(state);
}

export function deployDirectly(state, to, random = Math.random) {
  // Check the destination before drawing: a failed click must never consume a piece.
  if (!valid(to, state.board) || state.board[to] || !canDeployDirectly(state)) throw new Error('当前不能直接上场，请选择行动与空位');
  draw(state, random);
  return deploy(state, to);
}

function finishTurn(state, event) {
  state.history.push({ ...event, side: state.turn, ply: ++state.ply });
  state.winningLine = findFive(state.board, state.turn, state.cols);
  if (state.winningLine.length) state.result = state.turn;
  else {
    state.turn = state.turn === 'red' ? 'black' : 'red';
    if (!hasAction(state)) state.result = 'draw';
  }
  return state;
}

// All actions validate before mutation; drawing commits the player to deploying.
export function draw(state, random = Math.random) {
  if (state.result || state.pending) throw new Error('当前不能抽子');
  const pool = state.pools[state.turn];
  if (!pool.length || !state.board.some((p) => !p)) throw new Error('没有可部署的棋子或空位');
  const value = random();
  if (!(value >= 0 && value < 1)) throw new Error('随机数必须位于 [0, 1)');
  const [type] = pool.splice(Math.floor(value * pool.length), 1);
  state.pending = { type, side: state.turn };
  return state.pending;
}

export function deploy(state, to) {
  if (state.result || !state.pending || !valid(to, state.board) || state.board[to]) throw new Error('请选择空位部署');
  const piece = state.pending;
  state.board[to] = piece;
  state.pending = null;
  return finishTurn(state, { action: 'deploy', piece, to });
}

export function move(state, from, to) {
  if (state.result || state.pending || state.board[from]?.side !== state.turn || !canMove(state.board, from, to, state.cols)) {
    throw new Error('这一步不符合走子规则');
  }
  const piece = state.board[from], captured = state.board[to];
  state.board[to] = piece;
  state.board[from] = null;
  return finishTurn(state, { action: 'move', piece, from, to, captured });
}
