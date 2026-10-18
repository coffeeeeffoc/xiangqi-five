import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { newGame, findFive } from './game.js';
import { searchPosition, applyComputerAction, legalActions, winningActions } from './computer.js';
import { CHALLENGES, createChallengeState } from './challenges.js';

// Compare the exact previous revision with the same node budget, without network or randomness.
const baseline = process.argv[2] || '0e617c39fc7ce46ec09e99e3bd92591118031517';
assert.match(baseline, /^[0-9a-f]{40}$/);
const source = execFileSync('git', ['show', `${baseline}:computer.js`], { cwd: new URL('.', import.meta.url), encoding: 'utf8' })
  .replace("'./game.js'", JSON.stringify(new URL('./game.js', import.meta.url).href));
const previous = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const setup = newGame(); setup.turn = 'black'; setup.pools = { red: ['elephant'], black: ['elephant', 'elephant'] };
for (const [i, side] of [[20, 'red'], [21, 'red'], [22, 'red'], [23, 'black'], [24, 'black'], [31, 'black'], [33, 'black'], [38, 'red'], [41, 'black'], [51, 'black'], [58, 'red'], [60, 'red']]) setup.board[i] = { side, type: i === 20 || i === 23 ? 'king' : 'pawn' };
const fixtures = CHALLENGES.map(c => ({ id: c.id, state: createChallengeState(c.id), goal: c.goal }));
for (const mirrorX of [false, true]) for (const mirrorY of [false, true]) for (const swap of [false, true]) {
  const state = structuredClone(setup); state.board.fill(null);
  setup.board.forEach((p, i) => {
    const x = i % 9, y = Math.floor(i / 9), to = (mirrorY ? 9 - y : y) * 9 + (mirrorX ? 8 - x : x);
    if (p) state.board[to] = { ...p, side: swap ? (p.side === 'red' ? 'black' : 'red') : p.side };
  });
  if (swap) { state.turn = 'red'; [state.pools.red, state.pools.black] = [state.pools.black, state.pools.red]; }
  fixtures.push({ id: `forcing-${+mirrorX}${+mirrorY}${+swap}`, state, goal: 'three-turn' });
}

function forcesWin(position, side, remaining) {
  if (position.result) return position.result === side;
  if (!remaining) return false;
  if (winningActions(position).length) return position.turn === side;
  if (remaining === 1) return false;
  const check = action => {
    const types = action.type === 'deploy' ? [...new Set(position.pools[position.turn])] : [null];
    return types.every(type => {
      const next = structuredClone(position);
      applyComputerAction(next, action, () => type ? (next.pools[next.turn].indexOf(type) + .5) / next.pools[next.turn].length : 0);
      return forcesWin(next, side, remaining - 1);
    });
  };
  const actions = legalActions(position);
  return actions.length > 0 && (position.turn === side ? actions.some(check) : actions.every(check));
}

// Actual rule transitions, all legal replies and every reserve type; no search scores.
function verify(state, action, goal) {
  if (!action || action.type === 'resign') return false;
  const side = state.turn;
  const types = action.type === 'deploy' && !state.pending ? [...new Set(state.pools[side])] : [null];
  return types.every(type => {
    const next = structuredClone(state);
    applyComputerAction(next, action, () => type ? (next.pools[side].indexOf(type) + .5) / next.pools[side].length : 0);
    if (goal === 'five') return next.result === side;
    if (goal === 'defend') return !winningActions(next).length;
    if (goal === 'three-turn') return forcesWin(next, side, 5);
    if (next.result === side) return true;
    return legalActions(next).every(reply => {
      const replyTypes = reply.type === 'deploy' ? [...new Set(next.pools[next.turn])] : [null];
      return replyTypes.every(replyType => {
        const last = structuredClone(next);
        applyComputerAction(last, reply, () => replyType ? (last.pools[last.turn].indexOf(replyType) + .5) / last.pools[last.turn].length : 0);
        if (last.result && last.result !== side) return false;
        return legalActions(last).some(finish => {
          const end = structuredClone(last);
          applyComputerAction(end, finish, () => 0);
          return findFive(end.board, side, end.cols).length > 0;
        });
      });
    });
  });
}
const results = [];
for (const f of fixtures) {
  const row = { id: f.id };
  for (const [name, search, difficulty] of [['before', previous.searchPosition, 'practice'], ['after', searchPosition, 'practice'], ['hint', searchPosition, 'hint']]) {
    const before = structuredClone(f.state);
    const r = search(f.state, difficulty, { timeMs: Infinity, nodes: 4000 });
    assert.deepEqual(f.state, before);
    row[name] = { pass: verify(f.state, r.action, f.goal), action: r.action, depth: r.depth, nodes: r.nodes, elapsedMs: Math.round(r.elapsedMs), forcedWin: Boolean(r.forcedWin) };
  }
  results.push(row);
  console.log(JSON.stringify(row));
}
const totals = Object.fromEntries(['before', 'after', 'hint'].map(name => [name, results.filter(r => r[name].pass).length]));
assert.equal(totals.hint, results.length, 'paid hints must solve every tactical acceptance fixture');
assert(totals.after > totals.before, 'strength must improve at equal node budget');
await writeFile(new URL('./docs/design/computer-hints-2026-10-18/strength-validation.json', import.meta.url), JSON.stringify({ baseline, comparison: 'old practice / new practice / new hint, same 4000-node cap', nodeBudget: 4000, timeLimit: 'none (deterministic node budget)', fixtureNote: '8 authored challenges + 8 symmetries/color swaps of one forcing position; not an Elo or general win-rate benchmark', totals, results }, null, 2) + '\n');
console.log(JSON.stringify({ totals, total: results.length }));
