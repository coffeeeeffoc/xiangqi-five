import test from 'node:test';
import assert from 'node:assert/strict';
import { createHintAccess } from './rewarded-hints.js';

test('the game watchdog stops on confirmed display, without granting the reward', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, shown, settled = false;
  const access = createHintAccess({ SmallGamesPublishingConfig: { adMode: 'host' },
    SmallGamesRewardAds: { timeoutMs: 46000, offer: ({ onShown }) => new Promise(resolve => { finish = resolve; shown = onShown; }) } });
  const result = access.request().then(outcome => { settled = true; return outcome; }); await Promise.resolve();
  t.mock.timers.tick(12000); shown?.();
  t.mock.timers.tick(600000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  finish({ status: 'completed' });
  assert.equal((await result).status, 'completed');
});

test('invalid host deadlines fall back and idle navigation preserves a preloaded ad', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const timeoutMs of [undefined, -1, 0, NaN, Infinity, 300001, '226000']) {
    let cancelled = 0;
    const access = createHintAccess({ SmallGamesPublishingConfig: { adMode: 'host' },
      SmallGamesRewardAds: { timeoutMs, offer: () => new Promise(() => {}), cancel() { cancelled++; } } });
    access.cancel(); assert.equal(cancelled, 0);
    const pending = access.request(); await Promise.resolve();
    t.mock.timers.tick(45000);
    assert.equal((await pending).status, 'failed'); assert.equal(cancelled, 1);
  }
});

test('a retired display notification cannot disable a newer request deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  const access = createHintAccess({ SmallGamesPublishingConfig: { adMode: 'host' },
    SmallGamesRewardAds: { offer: request => { requests.push(request); return new Promise(() => {}); } } }, 20);
  const first = access.request(); await Promise.resolve(); access.cancel();
  assert.equal((await first).status, 'dismissed');
  const second = access.request(); await Promise.resolve(); requests[0].onShown();
  t.mock.timers.tick(20); assert.equal((await second).status, 'failed');
});

test('ad completion and dismissal wait for foreground; explicit cancel rejects late rewards', async () => {
  for (const status of ['completed', 'dismissed', 'failed']) {
    let finish, delivered = false;
    const access = createHintAccess({ SmallGamesPublishingConfig: { adMode: 'host' },
      SmallGamesRewardAds: { offer: () => new Promise(resolve => { finish = resolve; }) } });
    const result = access.request().then(outcome => { delivered = true; return outcome; });
    await Promise.resolve();
    access.setHidden(true); finish({ status });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delivered, false);
    assert.equal(access.pending, true);
    access.setHidden(false);
    assert.equal((await result).status, status);
    assert.equal(access.pending, false);
  }
  let finish;
  const access = createHintAccess({ SmallGamesPublishingConfig: { adMode: 'host' },
    SmallGamesRewardAds: { offer: () => new Promise(resolve => { finish = resolve; }) } });
  const result = access.request(); await Promise.resolve();
  access.setHidden(true); finish({ status: 'completed' });
  await new Promise(resolve => setImmediate(resolve));
  access.cancel(); access.setHidden(false);
  assert.equal((await result).status, 'dismissed');
});

test('free hints never invoke the advertisement provider', async () => {
  const access = createHintAccess({
    SmallGamesPublishingConfig: { adMode: 'off' },
    SmallGamesRewardAds: {
      offer() {
        throw new Error('must not show an ad');
      },
    },
  });
  assert.deepEqual(await access.request(), { status: 'free' });
});
test('a hidden timeout stays failed even if a late completion arrives before Show', async () => {
  let finish;
  const access = createHintAccess({ SmallGamesPublishingConfig: { adMode: 'host' },
    SmallGamesRewardAds: { offer: () => new Promise(resolve => { finish = resolve; }) } }, 5);
  const result = access.request(); await Promise.resolve(); access.setHidden(true);
  await new Promise(resolve => setTimeout(resolve, 20));
  finish({ status: 'completed' }); await new Promise(resolve => setImmediate(resolve));
  access.setHidden(false);
  assert.equal((await result).status, 'failed');
});
test('host completion, cancellation, failure and late callbacks remain distinct', async () => {
  for (const status of ['completed', 'dismissed', 'failed', 'unavailable', 'invalid']) {
    const access = createHintAccess({
      SmallGamesPublishingConfig: { adMode: 'host' },
      SmallGamesRewardAds: { offer: async () => ({ status }) },
    });
    assert.equal((await access.request()).status, status === 'invalid' ? 'failed' : status);
  }
  let complete;
  const access = createHintAccess(
    {
      SmallGamesPublishingConfig: { adMode: 'host' },
      SmallGamesRewardAds: {
        offer: () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      },
    },
    10,
  );
  const cancelled = access.request();
  await Promise.resolve();
  assert.equal((await access.request()).status, 'unavailable');
  access.cancel();
  assert.equal((await cancelled).status, 'dismissed');
  complete({ status: 'completed' });
  assert.equal((await access.request()).status, 'failed');
});
