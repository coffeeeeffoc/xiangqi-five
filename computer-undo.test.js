import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, deployDirectly, draw, deploy, move } from './game.js';
import { encodeGame, decodeGame, undoComputerTurn } from './local-game.js';
import { createComputerUndo, UNDO_FAILED } from './computer-undo.js';

function position(mode = 'xiangqi') {
  const state = newGame(mode);
  for (const to of [0, 18, 2, 20]) deployDirectly(state, to, () => 0);
  return state;
}
test('undo replays both players, restores captured pieces and commits the original draw', () => {
  for (const mode of ['xiangqi', 'gomoku']) {
    const state = position(mode), before = structuredClone(state);
    const next = undoComputerTurn(state);
    assert.deepEqual(state, before);
    assert.equal(next.ply, 2);
    assert.deepEqual(next.pending, before.history[2].piece);
    assert.equal(next.pools.red.length, before.pools.red.length);
    assert.equal(next.pools.black.length, before.pools.black.length + 1);
    assert.throws(() => draw(next));
    assert.throws(() => move(next, 0, 1));
    assert.equal(undoComputerTurn(next), null, 'a pending draw cannot be discarded');
    const captures = newGame(mode);
    deployDirectly(captures, 0, () => 0);
    deployDirectly(captures, mode === 'xiangqi' ? 9 : 15, () => 0);
    const original = structuredClone(captures);
    move(captures, 0, mode === 'xiangqi' ? 9 : 15);
    deployDirectly(captures, 8, () => 0);
    assert.deepEqual(undoComputerTurn(captures), { ...original, freeUndoUsed: true });
  }
  assert.equal(undoComputerTurn(newGame()), null);
});
test('free undo is persisted, legacy saves remain readable and malformed flags are rejected', () => {
  const state = undoComputerTurn(position());
  assert.equal(decodeGame(encodeGame(state, 'computer', 'hard')).state.freeUndoUsed, true);
  const saved = JSON.parse(encodeGame(position(), 'computer', 'standard'));
  delete saved.freeUndoUsed;
  assert.equal(decodeGame(JSON.stringify(saved)).state.freeUndoUsed, false);
  assert.equal(decodeGame(JSON.stringify({ ...saved, freeUndoUsed: 'false' })), null);
  assert.equal(newGame().freeUndoUsed, false);
});
test('first undo is free; later undo requires completed ads and failures preserve the whole state', async () => {
  let state = position(), offers = 0, status = 'completed';
  const undo = createComputerUndo({ cancel() {}, request: async (id, reward) => {
    offers++; assert.equal(id, 'xiangqi-five:computer-undo'); assert.deepEqual(reward, { undo: 1 }); return { status };
  } });
  const apply = next => { state = next; };
  await undo.request(state, apply);
  assert.equal(offers, 0); assert.equal(state.freeUndoUsed, true);
  deploy(state, 3); deployDirectly(state, 20, () => 0);
  for (status of ['dismissed', 'failed', 'unavailable', 'free']) {
    const before = structuredClone(state);
    await undo.request(state, apply);
    assert.deepEqual(state, before);
    assert.equal(undo.sync(state).message, UNDO_FAILED);
  }
  status = 'completed'; await undo.request(state, apply);
  assert.equal(state.ply, 2); assert.equal(state.freeUndoUsed, true);
});
test('undo double clicks, navigation and retired callbacks cannot grant or erase newer results', async () => {
  let complete, calls = 0;
  const undo = createComputerUndo({ cancel() {}, request: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  const old = position(); old.freeUndoUsed = true;
  const a = undo.request(old, () => assert.fail('cancelled undo applied'));
  await undo.request(old, () => assert.fail('duplicate undo applied'));
  assert.equal(calls, 1);
  undo.cancel();
  assert.equal(undo.sync(old).message, UNDO_FAILED);
  let current = position(); await undo.request(current, next => { current = next; });
  complete({ status: 'completed' }); await a;
  assert.equal(current.ply, 2);
  assert.equal(undo.sync(current).message, '已悔棋，请重新落子。');
});
