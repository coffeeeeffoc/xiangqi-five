export function setupBoardZoom(viewport, zoomIn, zoomOut, restore, output) {
  const frame = viewport.querySelector('.board-frame');
  let scale = 1;
  let baseWidth = viewport.clientWidth;
  let gesture = null;
  let suppressClickUntil = 0;
  const position = (touches) => {
    const [a, b] = touches;
    const rect = viewport.getBoundingClientRect();
    return { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top,
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  };
  function update(next, center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }, anchor) {
    anchor ||= { x: (viewport.scrollLeft + center.x) / scale, y: (viewport.scrollTop + center.y) / scale };
    scale = Math.max(1, Math.min(3, next));
    frame.style.width = scale === 1 ? '' : `${baseWidth * scale}px`;
    viewport.style.height = scale === 1 ? '' : `${Math.min(baseWidth * frame.offsetHeight / frame.offsetWidth + 14, innerHeight * .65)}px`;
    viewport.dataset.scale = scale.toFixed(2);
    viewport.classList.toggle('is-zoomed', scale > 1);
    output.textContent = `${Math.round(scale * 100)}%`;
    zoomIn.disabled = scale >= 3;
    zoomOut.disabled = restore.disabled = scale <= 1;
    viewport.scrollLeft = scale === 1 ? 0 : anchor.x * scale - center.x;
    viewport.scrollTop = scale === 1 ? 0 : anchor.y * scale - center.y;
  }
  const reset = () => {
    if (gesture || suppressClickUntil === Infinity) suppressClickUntil = Date.now() + 450;
    gesture = null; baseWidth = viewport.clientWidth; update(1);
  };
  zoomIn.addEventListener('click', () => update(scale + .5));
  zoomOut.addEventListener('click', () => update(scale - .5));
  restore.addEventListener('click', reset);

  viewport.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    const point = position(event.touches);
    gesture = { distance: Math.max(1, point.distance), scale,
      anchor: { x: (viewport.scrollLeft + point.x) / scale, y: (viewport.scrollTop + point.y) / scale } };
    suppressClickUntil = Infinity;
  }, { passive: false });
  viewport.addEventListener('touchmove', (event) => {
    if (!gesture) return;
    event.preventDefault();
    if (event.touches.length !== 2) return;
    const point = position(event.touches);
    update(gesture.scale * point.distance / gesture.distance, point, gesture.anchor);
  }, { passive: false });
  const finishGesture = (event) => {
    if (!gesture && suppressClickUntil !== Infinity) return;
    event.preventDefault();
    if (event.touches.length === 0 || event.type === 'touchcancel') {
      gesture = null;
      suppressClickUntil = Date.now() + 450;
    }
  };
  viewport.addEventListener('touchend', finishGesture, { passive: false });
  viewport.addEventListener('touchcancel', finishGesture, { passive: false });
  viewport.addEventListener('click', (event) => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  new ResizeObserver(() => { if (Math.abs(viewport.clientWidth - baseWidth) > 1) reset(); }).observe(viewport);
  document.addEventListener('game-displaychange', reset);
  return reset;
}
