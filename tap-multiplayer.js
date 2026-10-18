import { newGame, draw, deploy, deployDirectly, move, TYPES } from './game.js';
import { createRenderer } from './competition-renderer.js';

const sides = ['red', 'black'];
export const tapMultiplayer = {
  id: 'xiangqi-five',
  title: '象五子棋',
  version: 1,
  durationTicks: 108000,
  modes: [{ id: 'xiangqi', title: '象棋走法 · 同色连五' }],
  seats: ['红方', '黑方'],
  createRenderer: () => createRenderer({ touchViewport: true }),
  initial({ seed, mode }) {
    if (mode !== 'xiangqi' || !Number.isSafeInteger(seed) || seed < 0) throw new Error('无效棋局');
    return { ...newGame('xiangqi'), rng: seed >>> 0, tick: 0 };
  },
  advance(state, tick) {
    if (!Number.isSafeInteger(tick) || tick < state.tick || tick > this.durationTicks)
      throw new Error('无效时钟');
    state.tick = tick;
    if (!state.result && (tick === this.durationTicks || state.ply >= 600)) state.result = 'draw';
  },
  apply(state, action, seat) {
    const keys = {
      draw: ['type'],
      deploy: ['type', 'to'],
      'deploy-directly': ['type', 'to'],
      move: ['type', 'from', 'to'],
    };
    if (
      !sides[seat] ||
      !action ||
      Array.isArray(action) ||
      !Object.hasOwn(keys, action.type) ||
      Object.keys(action).some((key) => !keys[action.type].includes(key)) ||
      keys[action.type].some((key) => key !== 'type' && !Number.isInteger(action[key])) ||
      state.result ||
      state.turn !== sides[seat]
    )
      throw new Error('尚未轮到这步行动');
    // The core validates before requesting randomness; rejected actions cannot consume RNG state.
    const random = () =>
      (state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0) / 4294967296;
    if (action.type === 'draw') draw(state, random);
    else if (action.type === 'deploy-directly') deployDirectly(state, action.to, random);
    else if (action.type === 'deploy') deploy(state, action.to);
    else move(state, action.from, action.to);
    this.advance(state, state.tick);
  },
  view(state, seat) {
    const { mode, cols, rows, board, turn, pending, ply, result, winningLine } = state;
    return {
      mode,
      cols,
      rows,
      board,
      turn,
      pending,
      ply,
      result,
      winningLine,
      seat,
      elapsedMs: (state.tick * 1000) / 120,
      poolCounts: Object.fromEntries(
        sides.map((side) => [
          side,
          Object.fromEntries(
            TYPES.map((type) => [type, state.pools[side].filter((piece) => piece === type).length]),
          ),
        ]),
      ),
    };
  },
  outcome: (state) =>
    state.result
      ? state.result === 'draw'
        ? '本局和棋'
        : `${state.result === 'red' ? '红方' : '黑方'}获胜`
      : null,
};
