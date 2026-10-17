(() => {
  const loading = document.getElementById('loading-screen');
  const retry = document.getElementById('loading-retry');
  const entry = document.querySelector('script[src="./app.js"]');
  const failed = () => {
    if (loading.hidden) return;
    document.getElementById('loading-message').textContent = '加载失败，请重试';
    retry.hidden = false;
  };
  retry.addEventListener('click', () => location.reload());
  entry.addEventListener('error', failed);
  window.addEventListener('error', failed);
  document.addEventListener('xiangqi-ready', () => {
    entry.removeEventListener('error', failed);
    window.removeEventListener('error', failed);
  }, { once: true });
})();
