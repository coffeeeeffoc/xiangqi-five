import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, draw, deploy } from './game.js';
import { createComputerHints } from './computer-hints.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const analysis = { action: { type: 'deploy', to: 40 }, score: 100, depth: 2 };
function fixture(status = 'completed') {
  const state = newGame();
  const calls = [];
  const controller = createComputerHints({
    analyze: async () => { calls.push('analyze'); return analysis; },
    access: { adsEnabled: true, request: async id => { calls.push(id); return { status }; }, cancel() {} },
  });
  return { state, calls, controller };
}
test('ads complete before analysis; same turn reuses reward, draw refreshes advice, move/new game invalidates', async () => {
  const { state, calls, controller } = fixture();
  const before = structuredClone(state);
  await controller.request(state);
  assert.deepEqual(state, before);
  assert.deepEqual(calls, ['xiangqi-five:computer-hint', 'analyze']);
  assert.deepEqual(controller.sync(state).result.action, analysis.action);
  await controller.request(state);
  assert.equal(calls.length, 2);
  draw(state, () => 0);
  assert.equal(controller.sync(state).result, null);
  assert.equal(controller.sync(state).earned, true);
  await controller.request(state);
  assert.deepEqual(calls, ['xiangqi-five:computer-hint', 'analyze', 'analyze']);
  assert.match(controller.sync(state).result.text, /车放到/);
  deploy(state, 40);
  assert.equal(controller.sync(state).result, null);
  assert.equal(controller.sync(state).earned, false);
  assert.equal(controller.sync(newGame()).earned, false);
});
test('cancellation, unavailable and failed ads never reveal the prepared move', async () => {
  for (const status of ['dismissed', 'unavailable', 'failed']) {
    const { state, controller, calls } = fixture(status);
    await controller.request(state);
    assert.equal(controller.sync(state).result, null);
    assert.equal(controller.sync(state).earned, false);
    assert(!calls.includes('analyze'));
    assert.match(controller.sync(state).message, /提示未成功生成/);
  }
});
test('duplicate requests, background and stale analysis/ad callbacks cannot grant a reward', async () => {
  for (const stage of ['analysis', 'ad']) {
    const waiting = deferred(), state = newGame();
    let ads = 0;
    const controller = createComputerHints({
      analyze: () => stage === 'analysis' ? waiting.promise : Promise.resolve(analysis),
      access: { adsEnabled: true, cancel() {}, request: () => { ads++; return stage === 'ad' ? waiting.promise : Promise.resolve({ status: 'completed' }); } },
    });
    const request = controller.request(state);
    await tick();
    await controller.request(state);
    assert.equal(ads, 1);
    controller.cancel();
    waiting.resolve(stage === 'analysis' ? analysis : { status: 'completed' });
    await request;
    assert.equal(controller.sync(state).result, null);
    assert.equal(controller.sync(state).earned, stage === 'analysis');
    assert.equal(controller.sync(state).phase, '');
    assert.match(controller.sync(state).message, /提示未成功生成/);
  }
});
test('unsuccessful analysis keeps earned access for retry; unexpected draw invalidates a pending request', async () => {
  for (const result of [{ action: null }, { action: { type: 'resign' } }, { ...analysis, depth: 0 }]) {
    const state = newGame(); let ads = 0;
    const controller = createComputerHints({ analyze: async () => result,
      access: { cancel() {}, request: async () => { ads++; return { status: 'completed' }; } } });
    await controller.request(state);
    assert.equal(ads, 1);
    assert.equal(controller.sync(state).earned, true);
    await controller.request(state);
    assert.equal(ads, 1);
  }
  const state = newGame(), waiting = deferred(); let ads = 0;
  const controller = createComputerHints({ analyze: () => waiting.promise,
    access: { cancel() {}, request: async () => { ads++; return { status: 'completed' }; } } });
  const request = controller.request(state);
  draw(state, () => 0);
  waiting.resolve(analysis);
  await request;
  assert.equal(ads, 1);
  assert.equal(controller.sync(state).result, null);
});

test('a retired analysis or ad must not cancel a newer request or erase its earned advice', async () => {
  for (const stage of ['analysis', 'ad']) {
    const old = deferred(), latest = deferred();
    let analyses = 0, ads = 0;
    const controller = createComputerHints({
      analyze: () => ++analyses === 1 && stage === 'analysis' ? old.promise : latest.promise,
      access: { cancel() {}, request: () => ++ads === 1 && stage === 'ad' ? old.promise : Promise.resolve({ status: 'completed' }) },
    });
    const a = controller.request(newGame());
    await tick();
    controller.cancel();
    const current = newGame();
    const b = controller.request(current);
    old.resolve(stage === 'analysis' ? analysis : { status: 'completed' });
    await a;
    latest.resolve(analysis);
    await b;
    assert.equal(controller.sync(current).earned, true);
    assert.deepEqual(controller.sync(current).result.action, analysis.action);
  }
});
