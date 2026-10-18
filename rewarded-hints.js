export function createHintAccess(environment = globalThis, timeoutMs) {
  let finish, hidden = false, resume;
  const adsEnabled = () =>
    ['host', 'mock'].includes(environment.SmallGamesPublishingConfig?.adMode);
  return {
    get adsEnabled() {
      return adsEnabled();
    },
    get pending() {
      return Boolean(finish);
    },
    setHidden(value) {
      hidden = value;
      if (!hidden) resume?.();
    },
    async request(id = 'xiangqi-five:hint', reward = { hint: 1 }) {
      if (finish) return { status: 'unavailable' };
      if (!adsEnabled()) return { status: 'free' };
      const provider = environment.SmallGamesRewardAds;
      if (typeof provider?.offer !== 'function') return { status: 'unavailable' };
      const hostTimeout = provider.timeoutMs;
      const deadline = timeoutMs ?? (Number.isFinite(hostTimeout) && hostTimeout > 0 && hostTimeout <= 300000
        ? hostTimeout : 45000);
      return new Promise((resolve) => {
        let timer, outcomeReceived = false;
        const settle = (status) => {
          if (finish !== settle) return;
          clearTimeout(timer);
          finish = undefined;
          resume = undefined;
          resolve({ status });
        };
        finish = settle;
        const onShown = () => {
          if (finish === settle && !outcomeReceived) clearTimeout(timer);
        };
        const deliver = (status) => {
          if (finish !== settle || outcomeReceived) return;
          outcomeReceived = true;
          clearTimeout(timer);
          // Ad overlays can hide the game; deliver their result when the player returns.
          if (hidden) resume = () => settle(status);
          else settle(status);
        };
        timer = setTimeout(() => {
          deliver('failed');
          try {
            provider.cancel?.();
          } catch {
            /* Optional host cleanup. */
          }
        }, deadline);
        Promise.resolve()
          .then(() => finish === settle ? provider.offer({ id, reward, onShown }) : { status: 'dismissed' })
          .then(
            (result) =>
              deliver(
                ['completed', 'dismissed', 'failed', 'unavailable'].includes(result?.status)
                  ? result.status
                  : 'failed',
              ),
            () => deliver('failed'),
          );
      });
    },
    cancel() {
      if (!finish) return;
      finish?.('dismissed');
      try {
        environment.SmallGamesRewardAds?.cancel?.();
      } catch {
        /* Optional host cleanup. */
      }
    },
  };
}
