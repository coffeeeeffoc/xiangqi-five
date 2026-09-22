// Shared H5 control. Copies are checked by scripts/sync-h5-fullscreen.mjs.
// Independent Game repositories keep a copy so their standalone builds need no parent repo.
(() => {
  if (window.__gameFullscreenInstalled) return;
  window.__gameFullscreenInstalled = true;
  function install() {
    let host = document;
    try {
      if (window.parent !== window && window.parent.document.querySelector('[data-game-display-host]'))
        host = window.parent.document;
    } catch { /* Cross-origin embeds control their own complete game document. */ }
    const active = () => document.fullscreenElement || document.webkitFullscreenElement
      || host.fullscreenElement || host.webkitFullscreenElement;
    let pending = false, timer, noticeTimer;
    const style = document.createElement('style');
    style.textContent = `
      [data-game-fullscreen] { min-width: 60px; min-height: 44px; touch-action: manipulation; font-size: 13px; white-space: nowrap; }
      [data-game-fullscreen]:focus-visible { outline: 3px solid #478ef2; outline-offset: 2px; }
      .game-fullscreen-dialog { display: block; margin: 8px 0 8px auto; border: 1px solid currentColor; border-radius: 8px; padding: 6px 12px; background: transparent; color: inherit; }
      #game-display-notice { position: fixed; z-index: 2147483647; bottom: max(12px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 28px); padding: 10px 14px; border-radius: 10px; background: #172c35; color: white; font: 14px/1.5 system-ui, sans-serif; pointer-events: none; }
    `;
    document.head.append(style);
    const notice = document.createElement('div');
    notice.id = 'game-display-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.hidden = true;
    document.body.append(notice);
    function feedback(message) {
      clearTimeout(noticeTimer);
      // A native modal is in the top layer; keep feedback readable there too.
      (document.querySelector('dialog[open]') || document.body).append(notice);
      notice.textContent = message;
      notice.hidden = false;
      noticeTimer = setTimeout(() => { notice.hidden = true; }, 4000);
    }
    function sync() {
      const label = pending ? '正在切换…' : active() ? '退出全屏' : '全屏';
      for (const button of document.querySelectorAll('[data-game-fullscreen]')) {
        if (button.textContent !== label) button.textContent = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(!!active()));
        button.disabled = pending;
      }
    }
    function changed() {
      clearTimeout(timer);
      pending = false;
      sync();
      document.dispatchEvent(new Event('game-displaychange'));
    }
    async function toggle() {
      if (pending) return;
      const exiting = !!active();
      const owner = document.fullscreenElement || document.webkitFullscreenElement ? document : host;
      const target = owner.querySelector('[data-game-display-host]') || owner.documentElement;
      const method = exiting ? owner.exitFullscreen || owner.webkitExitFullscreen
        : target.requestFullscreen || target.webkitRequestFullscreen;
      if (!method) {
        feedback('此浏览器不支持网页全屏，仍可在当前页面正常游玩。');
        return;
      }
      pending = true;
      sync();
      timer = setTimeout(() => {
        changed();
        if (!!active() === exiting) feedback('浏览器未切换全屏，游戏可以继续。');
      }, 1800);
      try {
        // Invoke synchronously within the click: fullscreen needs user activation.
        await method.call(exiting ? owner : target);
        if (!!active() !== exiting) changed();
      } catch {
        changed();
        feedback(exiting ? '暂时无法退出全屏，可用浏览器的退出操作。' : '浏览器未允许全屏，仍可在当前页面正常游玩。');
      }
    }
    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-game-fullscreen]')) return;
      event.preventDefault();
      void toggle();
    });
    for (const owner of new Set([document, host])) {
      owner.addEventListener('fullscreenchange', changed);
      owner.addEventListener('webkitfullscreenchange', changed);
    }
    // History recreates its screens; native dialogs also need an accessible exit control.
    const observer = new MutationObserver(() => {
      for (const dialog of document.querySelectorAll('dialog[open]')) {
        if (!dialog.querySelector('[data-game-fullscreen]')) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'game-fullscreen-dialog';
          button.setAttribute('data-game-fullscreen', '');
          dialog.append(button);
        }
      }
      sync();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    sync();
    window.addEventListener('pagehide', () => {
      for (const owner of new Set([document, host])) {
        owner.removeEventListener('fullscreenchange', changed);
        owner.removeEventListener('webkitfullscreenchange', changed);
      }
    });
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      for (const owner of new Set([document, host])) {
        owner.addEventListener('fullscreenchange', changed);
        owner.addEventListener('webkitfullscreenchange', changed);
      }
      changed();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
