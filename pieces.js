// Tiny faces keep the Chinese piece names easy to read, even on a phone.
const accents = {
  rook: '<path d="M12 21V9h9v5h10V7h10v7h10V9h9v12"/>',
  horse: '<path d="M15 23 12 5c9 0 14 8 17 18M35 23C38 13 43 5 52 5l-3 18"/>',
  elephant: '<path d="M10 23C5 10 12 3 23 9M41 9c11-6 18 1 13 14"/>',
  advisor: '<path d="m25 11 7-7 7 7-7 7z"/>',
  king: '<path d="m14 21-3-14 12 8L32 3l9 12 12-8-3 14z"/>',
  cannon: '<path d="M16 21h32M20 21V12h24v9M29 12V6h10"/>',
  pawn: '<path d="M24 20c-1-9 5-13 15-12-1 8-6 12-15 12"/>',
};

export function silhouette(type) {
  return `<svg class="piece-accent" viewBox="0 0 64 28" aria-hidden="true" fill="var(--piece-light, #fff8e9)" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${accents[type] || accents.pawn}</svg><svg class="piece-face" viewBox="0 0 64 24" aria-hidden="true"><ellipse cx="10" cy="15" rx="7" ry="4" fill="#ed7867" opacity=".42"/><ellipse cx="54" cy="15" rx="7" ry="4" fill="#ed7867" opacity=".42"/><ellipse cx="20" cy="9" rx="3.7" ry="4.6" fill="#503b32"/><ellipse cx="44" cy="9" rx="3.7" ry="4.6" fill="#503b32"/><path d="M27 13q5 8 10 0" fill="#ed7867" stroke="#503b32" stroke-width="2.8" stroke-linecap="round"/></svg>`;
}

// Distinct little hops make movement readable without slowing the next touch.
const motions = {
  rook: { lift: 0.08, tilt: 0, duration: 360 },
  horse: { lift: 0.9, tilt: -11, duration: 520 },
  elephant: { lift: 0.38, tilt: 7, duration: 490 },
  advisor: { lift: 0.3, tilt: -8, duration: 410 },
  king: { lift: 0.45, tilt: 0, duration: 460 },
  cannon: { lift: 0.65, tilt: 8, duration: 470 },
  pawn: { lift: 0.22, tilt: -5, duration: 350 },
};

const star =
  '<svg viewBox="0 0 24 24" aria-hidden="true" width="100%" height="100%"><path d="m12 2 2.7 6.3 6.8.6-5.1 4.5 1.6 6.6-6-3.5-6 3.5 1.6-6.6-5.1-4.5 6.8-.6z" fill="#efc77a" stroke="#fff8e9" stroke-width="1.5" stroke-linejoin="round"/></svg>';

export async function animateTurn(board, cells, event, markup) {
  if (!event || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const destination = cells[event.to];
  const target = destination?.querySelector('.piece');
  if (!target || typeof target.animate !== 'function') return;
  const { lift, tilt, duration } = motions[event.piece.type] || motions.pawn;
  const ghosts = [];
  const animations = [];
  let deadline;
  const ghostAt = (piece) => {
    const ghost = document.createElement('span');
    ghost.className = 'motion-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = markup(piece, 'embodied');
    Object.assign(ghost.style, {
      left: `${destination.offsetLeft}px`,
      top: `${destination.offsetTop}px`,
      width: `${destination.offsetWidth}px`,
      height: `${destination.offsetHeight}px`,
      position: 'absolute',
      display: 'grid',
      placeItems: 'center',
      pointerEvents: 'none',
      zIndex: '12',
    });
    const face = ghost.querySelector('.piece');
    if (face) face.style.fontSize = getComputedStyle(target).fontSize;
    board.append(ghost);
    ghosts.push(ghost);
    return ghost;
  };
  const sparkle = (count, delay) => {
    const size = Math.max(7, Math.min(13, destination.offsetWidth * 0.25));
    const radius = destination.offsetWidth * (count > 3 ? 0.75 : 0.55);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const particle = document.createElement('span');
      particle.className = 'capture-sparkle';
      particle.setAttribute('aria-hidden', 'true');
      particle.innerHTML = star;
      Object.assign(particle.style, {
        position: 'absolute',
        width: `${size}px`,
        height: `${size}px`,
        left: `${destination.offsetLeft + destination.offsetWidth / 2 - size / 2}px`,
        top: `${destination.offsetTop + destination.offsetHeight / 2 - size / 2}px`,
        pointerEvents: 'none',
        zIndex: '14',
      });
      board.append(particle);
      ghosts.push(particle);
      animations.push(
        particle.animate(
          [
            { opacity: 0, transform: 'translate(0,0) scale(.3)' },
            {
              opacity: 1,
              transform: `translate(${Math.cos(angle) * radius * 0.7}px,${Math.sin(angle) * radius * 0.7}px) scale(1)`,
              offset: 0.32,
            },
            {
              opacity: 0,
              transform: `translate(${Math.cos(angle) * radius}px,${Math.sin(angle) * radius - 6}px) rotate(${i % 2 ? 35 : -35}deg) scale(.45)`,
            },
          ],
          { delay, duration: 290, fill: 'both', easing: 'ease-out' },
        ),
      );
    }
  };
  target.style.visibility = 'hidden';
  try {
    const attacker = ghostAt(event.piece);
    let frames;
    if (event.action === 'deploy') {
      const drop = Math.max(30, destination.offsetHeight * 1.15);
      frames = [
        { transform: `translateY(-${drop}px) rotate(-9deg) scale(.6)`, opacity: 0 },
        { transform: 'translateY(2px) scale(1.15,.84)', opacity: 1, offset: 0.62 },
        { transform: 'translateY(-6px) scale(.97,1.04)', opacity: 1, offset: 0.82 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ];
      sparkle(3, duration * 0.66);
    } else {
      const origin = cells[event.from];
      if (!origin) return;
      const dx = origin.offsetLeft - destination.offsetLeft;
      const dy = origin.offsetTop - destination.offsetTop;
      const height = destination.offsetHeight * lift;
      const lean = dx > 0 ? -tilt : tilt;
      frames = [
        { transform: `translate(${dx}px,${dy}px) scale(1)` },
        {
          transform: `translate(${dx * 0.52}px,${dy * 0.52 - height}px) rotate(${lean}deg) scale(1.04)`,
          offset: 0.45,
        },
        { transform: 'translate(0,2px) rotate(0) scale(1.09,.9)', offset: 0.83 },
        { transform: 'translate(0,0) scale(1)' },
      ];
    }
    animations.push(
      attacker.animate(frames, { duration, easing: 'cubic-bezier(.22,.7,.28,1)', fill: 'both' }),
    );
    if (event.captured) {
      const victim = ghostAt(event.captured);
      victim.style.zIndex = '11';
      animations.push(
        victim.animate(
          [
            { opacity: 1, transform: 'scale(1)' },
            {
              opacity: 0.75,
              transform: 'translateY(-8px) rotate(12deg) scale(1.05)',
              offset: 0.35,
            },
            { opacity: 0, transform: 'translateY(-22px) rotate(22deg) scale(.45)' },
          ],
          { delay: duration * 0.62, duration: 280, fill: 'both', easing: 'ease-out' },
        ),
      );
      sparkle(7, duration * 0.67);
    }
    // A canceled or detached animation must never leave touch input waiting.
    await Promise.race([
      Promise.allSettled(animations.map((animation) => animation.finished)),
      new Promise((resolve) => {
        deadline = setTimeout(resolve, duration + 450);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    animations.forEach((animation) => animation.cancel());
    ghosts.forEach((ghost) => ghost.remove());
    target.style.visibility = '';
  }
}
