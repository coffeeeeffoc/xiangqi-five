export function createHintAccess(environment = globalThis, timeoutMs = 45000) {
  let finish;
  const adsEnabled = () =>
    ['host', 'mock'].includes(environment.SmallGamesPublishingConfig?.adMode);
  return {
    get adsEnabled() {
      return adsEnabled();
    },
    get pending() {
      return Boolean(finish);
    },
    async request() {
      if (finish) return { status: 'unavailable' };
      if (!adsEnabled()) return { status: 'free' };
      const provider = environment.SmallGamesRewardAds;
      if (typeof provider?.offer !== 'function') return { status: 'unavailable' };
      return new Promise((resolve) => {
        let timer;
        const settle = (status) => {
          if (finish !== settle) return;
          clearTimeout(timer);
          finish = undefined;
          resolve({ status });
        };
        finish = settle;
        timer = setTimeout(() => {
          settle('failed');
          try {
            provider.cancel?.();
          } catch {
            /* Optional host cleanup. */
          }
        }, timeoutMs);
        Promise.resolve()
          .then(() => provider.offer({ id: 'xiangqi-five:hint', reward: { hint: 1 } }))
          .then(
            (result) =>
              settle(
                ['completed', 'dismissed', 'failed', 'unavailable'].includes(result?.status)
                  ? result.status
                  : 'failed',
              ),
            () => settle('failed'),
          );
      });
    },
    cancel() {
      finish?.('dismissed');
      try {
        environment.SmallGamesRewardAds?.cancel?.();
      } catch {
        /* Optional host cleanup. */
      }
    },
  };
}
