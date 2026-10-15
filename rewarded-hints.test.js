import test from 'node:test';
import assert from 'node:assert/strict';
import { createHintAccess } from './rewarded-hints.js';

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
