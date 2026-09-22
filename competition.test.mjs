import test from 'node:test';
import assert from 'node:assert/strict';
import rule from '../../../services/runtime-api/rules/chess.mjs';
import { createRenderer } from './competition-renderer.js';
import { canMove } from './game.js';

test('real mixed-chess rules: seats, legal actions, hidden draws, win, invalid scores and timeout', () => {
  let state = rule.initial(1);
  const initial = structuredClone(state);
  for (const [action, seat] of [[{ type: 'draw' }, 1], [{ type: 'draw' }, 2], [{ type: 'deploy-directly', to: 90 }, 0], [{ type: 'draw', score: 999 }, 0]]) {
    assert.throws(() => rule.action(state, action, 0, seat));
    assert.deepEqual(state, initial);
  }
  assert.equal(rule.view(state, 1).seat, 1);
  assert.equal(rule.view(state).pools, undefined);
  assert.equal(rule.view(state).history, undefined);
  state = rule.action(state, { type: 'draw' }, 10, 0);
  assert.equal(state.ply, 0);
  assert.equal(state.pools.red.length, 15);
  assert.throws(() => rule.action(state, { type: 'draw' }, 20, 0));
  assert.throws(() => rule.action(state, { type: 'move', from: 0, to: 1 }, 20, 0));
  state = rule.action(state, { type: 'deploy', to: 0 }, 20, 0);
  assert.throws(() => rule.action(state, { type: 'deploy-directly', to: 0 }, 30, 1));
  for (const to of [89, 1, 87, 2, 85, 3, 83, 4]) {
    state = rule.action(state, { type: 'deploy-directly', to }, state.elapsedMs + 10, state.ply % 2);
  }
  assert.equal(state.result, 'red');
  assert.deepEqual(rule.result(state, 0), { finished: true, eligible: true, score: 3, secondary: 0 });
  assert.deepEqual(rule.result(state, 1), { finished: true, eligible: true, score: 0, secondary: 0 });
  assert.throws(() => rule.action(state, { type: 'draw' }, 120, 1));
  assert.equal(rule.result(rule.advance(rule.initial(), rule.durationMs), 0).eligible, false);
  assert.equal(rule.result(rule.action(rule.initial(), { type: 'resign' }, 0, 0), 1).eligible, false);
  state = rule.initial();
  for (const to of [0, 89, 2, 87, 4, 85, 6, 83, 8, 81]) state = rule.action(state, { type: 'deploy-directly', to }, state.ply * 10, state.ply % 2);
  state = rule.advance(state, rule.durationMs);
  assert.deepEqual(rule.result(state, 0), { finished: true, eligible: true, score: 1, secondary: 0 });
  assert.deepEqual(rule.result(state, 1), rule.result(state, 0));
});

test('Canvas surface maps actual board taps; selection never deploys on an illegal move', () => {
  const renderer = createRenderer();
  // Drawing calls are irrelevant to this check; the real Canvas path is exercised by browser acceptance.
  const ctx = new Proxy({}, { get: (_, key) => key === 'measureText' ? text => ({ width: text.length * 10 }) : () => {} });
  let state = rule.initial(), view = rule.view(state, 0);
  const tap = (name, input = view) => {
    const hit = renderer.draw(ctx, 390, 640, input).find(item => item.label === name);
    assert.ok(hit, name);
    return renderer.tap(hit.x + hit.w / 2, hit.y + hit.h / 2, input);
  };
  assert.deepEqual(tap('A1空位'), { type: 'deploy-directly', to: 0 });
  assert.equal(tap('A1空位', rule.view(state, 1)), null);
  state = rule.action(state, { type: 'deploy-directly', to: 40 }, 10, 0);
  state = rule.action(state, { type: 'deploy-directly', to: 89 }, 20, 1);
  view = rule.view(state, 0);
  const ownHit = renderer.draw(ctx, 390, 640, view).find(item => item.index === 40);
  assert.equal(renderer.tap(ownHit.x + ownHit.w / 2, ownHit.y + ownHit.h / 2, view), null);
  const before = structuredClone(view);
  const targets = renderer.draw(ctx, 390, 640, view);
  const illegal = targets.find(item => item.index !== undefined && !view.board[item.index] && !canMove(view.board, 40, item.index, 9));
  assert.equal(renderer.tap(illegal.x + illegal.w / 2, illegal.y + illegal.h / 2, view), null);
  assert.deepEqual(view, before);
  const legal = targets.find(item => item.index !== undefined && canMove(view.board, 40, item.index, 9));
  assert.deepEqual(renderer.tap(legal.x + legal.w / 2, legal.y + legal.h / 2, view), { type: 'move', from: 40, to: legal.index });
});
