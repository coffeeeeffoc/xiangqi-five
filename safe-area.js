/** Shared by standalone H5 games; keep packaged copies byte-identical. */
(function () {
  'use strict';
  const root = document.documentElement;
  const number = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
  const call = (sdk, method) => {
    try {
      return sdk?.[method]?.call(sdk);
    } catch {
      return undefined;
    }
  };
  function refresh() {
    const width = innerWidth;
    const height = innerHeight;
    const insets = { top: 0, right: 0, bottom: 0, left: 0 };
    let host = /MicroMessenger|TapTap|Bytedance|Toutiao|miniProgram/i.test(navigator.userAgent);
    host ||= globalThis.SmallGamesPublishingConfig?.platform === 'taptap-h5';
    for (const name of ['tap', 'wx', 'tt', 'bl', 'ks', 'my', 'swan']) {
      const sdk = globalThis[name];
      if (!sdk) continue;
      const windowInfo = call(sdk, 'getWindowInfo');
      const info =
        windowInfo && (windowInfo.safeArea || number(windowInfo.windowWidth))
          ? windowInfo
          : call(sdk, 'getSystemInfoSync');
      host ||= Boolean(
        name === 'tap' ||
          info ||
          typeof sdk.createCanvas === 'function' ||
          typeof sdk.getMenuButtonBoundingClientRect === 'function',
      );
      const sameWindow =
        !info ||
        ((!info.windowWidth || Math.abs(info.windowWidth - width) < 2) &&
          (!info.windowHeight || Math.abs(info.windowHeight - height) < 2));
      // Host coordinates are CSS pixels, never physical pixels multiplied by DPR.
      // Do not project full-window host geometry into a smaller embedded document.
      if (info && sameWindow) {
        const safe = info.safeArea || {};
        const left = safe.left ?? 0,
          right = safe.right ?? width;
        const top = safe.top ?? 0,
          bottom = safe.bottom ?? height;
        if (
          [left, right, top, bottom].every(Number.isFinite) &&
          left >= 0 &&
          right <= width &&
          left < right &&
          top >= 0 &&
          bottom <= height &&
          top < bottom
        ) {
          insets.top = Math.max(insets.top, top);
          insets.left = Math.max(insets.left, left);
          insets.right = Math.max(insets.right, width - right);
          insets.bottom = Math.max(insets.bottom, height - bottom);
        }
        if (number(info.statusBarHeight) < height / 2)
          insets.top = Math.max(insets.top, number(info.statusBarHeight));
      }
      const capsule = call(sdk, 'getMenuButtonBoundingClientRect');
      if (
        sameWindow &&
        number(capsule?.bottom) &&
        capsule.bottom < height / 2 &&
        (!capsule.top || capsule.bottom > capsule.top)
      )
        insets.top = Math.max(insets.top, capsule.bottom);
      if (typeof sdk.onWindowResize === 'function' && !subscribed.has(sdk)) {
        subscribed.add(sdk);
        try {
          sdk.onWindowResize(refresh);
        } catch {
          /* Browser resize remains available. */
        }
      }
    }
    // H5 hosts can expose only ads and omit window/capsule geometry. The preview
    // banner and capsule still occupy the top band (about 85px in portrait).
    if (host) insets.top = Math.max(insets.top, width <= height ? 92 : 64);
    for (const [edge, value] of Object.entries(insets)) {
      const limit = (edge === 'top' || edge === 'bottom' ? height : width) / 2;
      root.style.setProperty(`--game-host-${edge}`, `${Math.min(limit, value)}px`);
      root.style.setProperty(
        `--game-safe-area-${edge}`,
        `calc(max(env(safe-area-inset-${edge}, 0px), var(--game-host-${edge}, 0px))${edge === 'top' ? ' + 8px' : ''})`,
      );
    }
  }
  const subscribed = new WeakSet();
  addEventListener('resize', refresh);
  addEventListener('pageshow', refresh);
  addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  document.addEventListener('WeixinJSBridgeReady', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
  document.addEventListener('fullscreenchange', refresh);
  addEventListener('orientationchange', refresh);
  refresh();
})();
