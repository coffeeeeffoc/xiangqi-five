import { newGame, draw, deploy, move } from './game.js';

export const SAVE_KEY = 'xiangqi-five-local-v1';

export function encodeGame(state, opponent, difficulty) {
  return JSON.stringify({ version: 1, mode: state.mode, history: state.history, pending: state.pending, opponent, difficulty });
}

// Replaying through the real rules rejects malformed boards, impossible moves and duplicated pieces.
export function decodeGame(text) {
  if (!text || text.length > 2000000) return null;
  try {
    const saved = JSON.parse(text);
    if (saved.version !== 1 || !['computer', 'local'].includes(saved.opponent) || !['practice', 'standard', 'hard'].includes(saved.difficulty) || !Array.isArray(saved.history)) return null;
    const state = newGame(saved.mode);
    const drawPiece = (piece) => {
      if (piece?.side !== state.turn) throw new Error('Invalid side');
      const pool = state.pools[state.turn], index = pool.indexOf(piece.type);
      if (index < 0) throw new Error('Invalid piece');
      draw(state, () => (index + 0.5) / pool.length);
    };
    for (const event of saved.history) {
      if (event.action === 'deploy') { drawPiece(event.piece); deploy(state, event.to); }
      else if (event.action === 'move') move(state, event.from, event.to);
      else return null;
      if (JSON.stringify(state.history.at(-1)) !== JSON.stringify(event)) return null;
    }
    if (saved.pending) drawPiece(saved.pending);
    return { state, opponent: saved.opponent, difficulty: saved.difficulty };
  } catch { return null; }
}
