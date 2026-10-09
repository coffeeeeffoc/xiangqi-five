import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, canMove, move } from './game.js';
import { chooseAction, applyComputerAction, searchPosition, winningActions, legalActions, isForcedLoss } from './computer.js';
import { encodeGame, decodeGame } from './local-game.js';

const deterministic = { timeMs: Infinity };

test('all difficulties stop feeding a rook, including after it has already captured', () => {
  for (const mode of ['xiangqi', 'gomoku']) for (const difficulty of ['practice', 'standard', 'hard']) {
    const s = newGame(mode), rook = 4 * s.cols + 4;
    s.board[rook] = { side: 'red', type: 'rook' };
    s.board[rook + 1] = { side: 'black', type: 'advisor' };
    move(s, rook, rook + 1);
    const before = structuredClone(s);
    const action = chooseAction(s, difficulty);
    assert.deepEqual(s, before, 'thinking must leave the board, pools, pending draw and history intact');
    applyComputerAction(s, action, () => .99);
    assert.equal(canMove(s.board, rook + 1, action.to, s.cols), false, `${mode}/${difficulty} feeds another piece to the rook`);
  }
});

test('every difficulty takes an immediate five even on a rook attack line, and blocks enemy five', () => {
  for (const mode of ['xiangqi', 'gomoku']) for (const difficulty of ['practice', 'standard', 'hard']) {
    const s = newGame(mode); s.turn = 'black';
    for (let i = 0; i < 4; i++) s.board[i] = { side: 'black', type: 'pawn' };
    s.board[s.cols + 4] = { side: 'red', type: 'rook' };
    applyComputerAction(s, chooseAction(s, difficulty), () => .99);
    assert.equal(s.result, 'black', 'winning now is worth being on an attacked square');
    const defense = newGame(mode); defense.turn = 'black';
    for (let i = 0; i < 4; i++) defense.board[i] = { side: 'red', type: 'pawn' };
    applyComputerAction(defense, chooseAction(defense, difficulty), () => .99);
    assert.equal(winningActions(defense).length, 0);
  }
});

test('forced defense can capture a line piece instead of occupying the winning square', () => {
  const s = newGame(); s.turn = 'black'; s.pools.black = [];
  for (let i = 1; i <= 4; i++) s.board[i] = { side: 'red', type: 'pawn' };
  s.board[20] = { side: 'black', type: 'rook' };
  for (const difficulty of ['practice', 'standard', 'hard']) {
    const next = structuredClone(s);
    const action = chooseAction(next, difficulty);
    assert.deepEqual(action, { type: 'move', from: 20, to: 2 });
    applyComputerAction(next, action);
    assert.equal(winningActions(next).length, 0);
  }
});

test('quiescence sees a cannon screen being eaten and saves the undefended pawn', () => {
  const s = newGame(); s.turn = 'black'; s.pools = { red: [], black: [] };
  for (const [i, side, type] of [[11, 'red', 'pawn'], [19, 'red', 'rook'], [36, 'black', 'rook'],
    [64, 'black', 'pawn'], [81, 'black', 'cannon'], [89, 'red', 'cannon']]) s.board[i] = { side, type };
  const shallow = searchPosition(s, 'hard', { ...deterministic, depth: 1, quiescence: 0 });
  const extended = searchPosition(s, 'hard', { ...deterministic, depth: 1 });
  assert.deepEqual(shallow.action, { type: 'move', from: 81, to: 82 });
  const trap = structuredClone(s);
  applyComputerAction(trap, shallow.action); move(trap, 19, 64);
  assert.equal(canMove(trap.board, 82, 64), false, 'the cannon has lost its screen, so cannot recapture');
  assert.deepEqual(extended.action, { type: 'move', from: 64, to: 63 });
  applyComputerAction(s, extended.action);
  assert.equal(canMove(s.board, 19, 63), false, 'the pawn was rescued');
  assert.ok(extended.qnodes > shallow.qnodes);
});

test('hard finds a forcing setup missed by easy; verify against every legal defense', () => {
  const s = newGame(); s.turn = 'black'; s.pools = { red: ['elephant'], black: ['elephant', 'elephant'] };
  for (const [i, side] of [[20, 'red'], [21, 'red'], [22, 'red'], [23, 'black'], [24, 'black'], [31, 'black'],
    [33, 'black'], [38, 'red'], [41, 'black'], [51, 'black'], [58, 'red'], [60, 'red']]) s.board[i] = { side, type: i === 20 || i === 23 ? 'king' : 'pawn' };
  const easy = searchPosition(s, 'practice', deterministic);
  const hard = searchPosition(s, 'hard', deterministic);
  assert.deepEqual(easy.action, { type: 'deploy', to: 32 });
  assert.deepEqual(hard.action, { type: 'deploy', to: 15 });
  assert.ok(hard.depth > easy.depth);
  assert.ok(hard.score > 900000);
  // Independent exhaustive verifier: no engine evaluation, move ordering or beam pruning.
  function forcesWin(position, remaining) {
    if (position.result) return position.result === 'black';
    if (!remaining) return false;
    if (winningActions(position).length) return position.turn === 'black';
    if (remaining === 1) return false;
    const actions = legalActions(position);
    if (!actions.length) return false;
    const check = (action) => {
      const next = structuredClone(position);
      applyComputerAction(next, action, () => 0);
      return forcesWin(next, remaining - 1);
    };
    return position.turn === 'black' ? actions.some(check) : actions.every(check);
  }
  applyComputerAction(s, hard.action, () => 0);
  assert.equal(forcesWin(s, 5), true);
});

test('random deployment weights actual remaining pieces; a pending draw is deterministic', () => {
  const s = newGame(); s.turn = 'black'; s.pools = { red: [], black: ['rook', 'pawn', 'pawn'] };
  s.board[0] = { side: 'red', type: 'pawn' };
  const before = structuredClone(s), limits = { ...deterministic, depth: 1, quiescence: 0 };
  const mixed = searchPosition(s, 'hard', limits);
  const known = ['rook', 'pawn'].map((type) => {
    const position = structuredClone(s); position.pending = { side: 'black', type };
    position.pools.black.splice(position.pools.black.indexOf(type), 1);
    const saved = structuredClone(position), result = searchPosition(position, 'hard', limits);
    assert.deepEqual(position, saved);
    assert.equal(result.chanceOutcomes, 0);
    assert.deepEqual(result.action, mixed.action);
    return result.score;
  });
  assert.ok(Math.abs(mixed.score - (known[0] + known[1] * 2) / 3) < 1e-8);
  assert.ok(mixed.chanceOutcomes > 0);
  s.pools.black.reverse();
  assert.equal(searchPosition(s, 'hard', limits).score, mixed.score, 'pool order must not reveal the draw');
  s.pools.black.reverse(); assert.deepEqual(s, before);
});

test('budget interruption retains a legal safe move; ended/no-action states and saves work', () => {
  const s = newGame(); s.turn = 'black'; s.board[40] = { side: 'red', type: 'rook' };
  const before = structuredClone(s);
  for (const limits of [{ timeMs: 0 }, { ...deterministic, nodes: 1 }]) {
    const result = searchPosition(s, 'hard', limits);
    assert.ok(legalActions(s).some((action) => JSON.stringify(action) === JSON.stringify(result.action)));
    const next = structuredClone(s); applyComputerAction(next, result.action, () => .99);
    assert.equal(canMove(next.board, 40, result.action.to), false);
    assert.equal(result.depth, 0);
    assert.deepEqual(s, before);
  }
  const exhausted = newGame(); exhausted.pools.red = [];
  assert.equal(chooseAction(exhausted), null);
  s.result = 'red'; assert.equal(chooseAction(s, 'hard'), null);
  for (const difficulty of ['practice', 'standard', 'hard']) {
    const game = newGame();
    assert.equal(decodeGame(encodeGame(game, 'computer', difficulty)).difficulty, difficulty);
  }
  assert.equal(decodeGame(encodeGame(newGame(), 'computer', 'unknown')), null);
});

test('computer resigns only when every legal reply loses to an immediate five', () => {
  for (const mode of ['xiangqi', 'gomoku']) for (const difficulty of ['practice', 'standard', 'hard']) {
    const s = newGame(mode); s.turn = 'black';
    for (let i = 1; i <= 4; i++) s.board[i] = { side: 'red', type: 'pawn' };
    const before = structuredClone(s);
    assert.ok(isForcedLoss(s));
    const result = searchPosition(s, difficulty, { timeMs: 0, nodes: 0 });
    assert.deepEqual(result.action, { type: 'resign', reason: 'forced-loss' });
    assert.equal(result.depth, 0, 'a proved loss must not wait for the search budget');
    assert.deepEqual(s, before, 'proof and search must leave the real game unchanged');
    // Independent check using actual rule transitions and every possible drawn type.
    for (const action of legalActions(s)) for (const type of new Set(s.pools.black)) {
      const next = structuredClone(s);
      applyComputerAction(next, action, () => (next.pools.black.indexOf(type) + .5) / next.pools.black.length);
      assert.equal(next.result, null);
      assert.ok(winningActions(next).length > 0);
    }
    applyComputerAction(s, result.action);
    assert.equal(s.result, 'red');
    assert.equal(s.resigned, 'black');
    assert.equal(s.ply, before.ply);
    assert.deepEqual(s.history, before.history);
    assert.deepEqual(s.board, before.board);
    assert.deepEqual(s.pools, before.pools);
    assert.deepEqual(s.winningLine, []);
  }
});

test('auto-resignation preserves a pending draw and never replaces a win, defense or draw', () => {
  for (const mode of ['xiangqi', 'gomoku']) {
    const lost = newGame(mode); lost.turn = 'black';
    for (let i = 1; i <= 4; i++) lost.board[i] = { side: 'red', type: 'pawn' };
    lost.pending = { side: 'black', type: lost.pools.black.pop() };
    const pending = structuredClone(lost.pending);
    applyComputerAction(lost, chooseAction(lost));
    assert.deepEqual(lost.pending, pending);
    assert.equal(lost.resigned, 'black');

    const win = newGame(mode); win.turn = 'black';
    for (let i = 1; i <= 4; i++) win.board[i] = { side: 'red', type: 'pawn' };
    for (let i = 0; i < 4; i++) win.board[mode === 'xiangqi' ? 36 + i : 60 + i] = { side: 'black', type: 'pawn' };
    assert.equal(isForcedLoss(win), false, 'winning this turn has priority over an enemy threat');
    applyComputerAction(win, chooseAction(win));
    assert.equal(win.result, 'black');
    assert.equal(win.resigned, null);

    const blocked = newGame(mode); blocked.turn = 'black';
    for (let i = 0; i < 4; i++) blocked.board[i] = { side: 'red', type: 'pawn' };
    assert.equal(isForcedLoss(blocked), false);
    assert.equal(chooseAction(blocked).type, 'deploy');
    const before = structuredClone(blocked);
    assert.throws(() => applyComputerAction(blocked, { type: 'resign', reason: 'forced-loss' }));
    assert.deepEqual(blocked, before, 'an unproved resignation must not change the game');

    const captured = newGame(mode); captured.turn = 'black'; captured.pools.black = [];
    for (let i = 1; i <= 4; i++) captured.board[i] = { side: 'red', type: 'pawn' };
    captured.board[2 * captured.cols + 2] = { side: 'black', type: 'rook' };
    assert.equal(isForcedLoss(captured), false, 'a capture can dismantle both threats');
    applyComputerAction(captured, chooseAction(captured));
    assert.equal(captured.result, null);
    assert.equal(winningActions(captured).length, 0);

    const exhausted = newGame(mode); exhausted.turn = 'black'; exhausted.pools.black = [];
    for (let i = 1; i <= 4; i++) exhausted.board[i] = { side: 'red', type: 'pawn' };
    assert.equal(isForcedLoss(exhausted), false, 'no legal action is a draw under the game rules');
    assert.equal(chooseAction(exhausted), null);
    exhausted.result = 'draw';
    assert.equal(isForcedLoss(exhausted), false);
    assert.equal(chooseAction(exhausted), null);

    const materialLoss = newGame(mode); materialLoss.turn = 'black'; materialLoss.pools.black = [];
    materialLoss.board[materialLoss.board.length - 1] = { side: 'black', type: 'pawn' };
    materialLoss.board[0] = { side: 'red', type: 'rook' };
    assert.equal(isForcedLoss(materialLoss), false, 'too few pieces to win is not proof of losing');
    assert.equal(chooseAction(materialLoss, 'practice').type, 'move');
  }
});
