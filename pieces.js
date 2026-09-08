// Lightweight silhouettes stay sharp on phone screens without loading 3D assets.
const shapes = {
  rook: '<path d="M12 31h33l-3 16H15zM18 31V15h5v7h11v-7h5v16M45 32l10-9v6l-7 12"/><circle cx="20" cy="49" r="6"/><circle cx="39" cy="49" r="6"/>',
  horse: '<path d="M16 53c1-13 10-14 13-24l-9 3-7-8 9-6 6-12 7 7 7 1c15 11 13 25 6 39z"/><path d="M28 18l7 4-8 9M39 15c8 13 7 22 2 29" fill="none"/><circle cx="27" cy="23" r="1.5" fill="var(--paper)"/>',
  elephant: '<path d="M9 31c0-11 7-17 19-17h13c11 0 16 8 14 19l-1 14c0 9-12 10-15 3l5-3c1 4 4 2 4-1V33l-6 5v15h-9V40H22v13h-9V36z"/><path d="M39 20c-10-4-15 10-5 16l8-7z"/><path d="M48 35l-6 8" fill="none"/><circle cx="49" cy="26" r="1.5" fill="var(--paper)"/>',
  advisor: '<circle cx="31" cy="17" r="8"/><path d="M23 12l8-6 8 6M20 29l11-6 11 6 7 24H14zM31 26v25"/><path d="M40 29l13 5v12l-7 6-7-6V34z"/><path d="M46 37v9" fill="none"/>',
  king: '<path d="M21 10l5 6 6-10 6 10 5-6-3 13H24z"/><path d="M24 24h16v6l-8 6-8-6zM21 36l11-6 11 6 7 18H14z"/><path d="M32 37v14M24 43h16" fill="none"/>',
  cannon: '<path d="M12 27l38-13 5 12-38 13zM20 38h22l8 12H14z"/><circle cx="22" cy="49" r="7"/><circle cx="42" cy="49" r="7"/><path d="M49 16l4 9" fill="none"/>',
  pawn: '<path d="M22 19a10 10 0 0 1 20 0zM26 20v7l6 5 6-5v-7M23 32l9-5 9 5 4 21H19z"/><path d="M49 14v40M45 15l4-9 4 9z"/><path d="M14 35l12-3 3 12-8 9-8-8z"/>',
};

export function silhouette(type) {
  return `<svg class="piece-spirit" viewBox="0 0 64 64" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">${shapes[type]}</svg>`;
}

const motions = {
  rook: { lift: 0, tilt: 0, duration: 380 },
  horse: { lift: 36, tilt: -12, duration: 560 },
  elephant: { lift: 12, tilt: 5, duration: 580 },
  advisor: { lift: 10, tilt: -8, duration: 420 },
  king: { lift: 18, tilt: 0, duration: 500 },
  cannon: { lift: 8, tilt: 8, duration: 460 },
  pawn: { lift: 7, tilt: -5, duration: 340 },
};

export async function animateTurn(board, cells, event, markup) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const destination = cells[event.to];
  const target = destination.querySelector('.piece');
  if (!target) return;
  const { lift, tilt, duration } = motions[event.piece.type];
  const ghosts = [];
  const animations = [];
  const ghostAt = (piece) => {
    const ghost = document.createElement('span');
    ghost.className = 'motion-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = markup(piece, 'embodied');
    Object.assign(ghost.style, { left: `${destination.offsetLeft}px`, top: `${destination.offsetTop}px`, width: `${destination.offsetWidth}px`, height: `${destination.offsetHeight}px` });
    board.append(ghost); ghosts.push(ghost);
    return ghost;
  };
  target.style.visibility = 'hidden';
  try {
    const attacker = ghostAt(event.piece);
    let frames;
    if (event.action === 'deploy') {
      frames = [{ transform: 'translateY(-65px) scale(.45)', opacity: 0 }, { transform: 'translateY(3px) scale(1.08)', opacity: 1, offset: .8 }, { transform: 'none', opacity: 1 }];
    } else {
      const dx = cells[event.from].offsetLeft - destination.offsetLeft;
      const dy = cells[event.from].offsetTop - destination.offsetTop;
      frames = [{ transform: `translate(${dx}px,${dy}px)` }, { transform: `translate(${dx/2}px,${dy/2-lift}px) rotate(${tilt}deg)`, offset: .5 }, { transform: 'translate(0,0)' }];
    }
    animations.push(attacker.animate(frames, { duration, easing: 'ease-in-out', fill: 'both' }));
    if (event.captured) {
      const victim = ghostAt(event.captured);
      victim.style.zIndex = '11';
      animations.push(victim.animate([{ opacity: .85, transform: 'scale(1)' }, { opacity: 0, transform: 'translateY(-30px) rotate(25deg) scale(.25)' }], { delay: duration*.55, duration: 300, fill: 'both', easing: 'ease-out' }));
      const ring = document.createElement('span');
      ring.className = `capture-burst ${event.piece.type}`;
      destination.append(ring); ghosts.push(ring);
      animations.push(ring.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: .8, offset: .3 }, { opacity: 0, transform: 'scale(1.8)' }], { delay: duration*.6, duration: 330, fill: 'both' }));
    }
    await Promise.allSettled(animations.map((animation) => animation.finished));
  } finally {
    animations.forEach((animation) => animation.cancel());
    ghosts.forEach((ghost) => ghost.remove());
    target.style.visibility = '';
  }
}
