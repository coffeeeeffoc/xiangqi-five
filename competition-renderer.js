import { canMove, label, sideName } from './game.js';

const colors = {
  ink: '#573626',
  cream: '#fff8e8',
  coral: '#ef795f',
  red: '#b94d37',
  mint: '#b9d2ad',
  green: '#365f45',
  wood: '#d6a16a',
  board: '#f7dcaa',
};

function rounded(ctx, x, y, width, height, radius, fill, stroke) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

function token(ctx, x, y, radius, piece, text, winning = false, selected = false) {
  const red = piece.side === 'red',
    rim = red ? colors.red : colors.green;
  // The face sits entirely inside its own touch cell.
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 0.85, radius * 0.87, radius * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#70442225';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y + radius * 0.13, radius, 0, Math.PI * 2);
  ctx.fillStyle = red ? colors.coral : '#88a879';
  ctx.fill();
  ctx.strokeStyle = selected ? '#e7a927' : rim;
  ctx.lineWidth = selected ? 3 : 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - radius * 0.04, radius * 0.88, 0, Math.PI * 2);
  ctx.fillStyle = winning ? '#ffe89a' : red ? '#ffddae' : '#dce9bf';
  ctx.fill();
  ctx.strokeStyle = '#fff8e8';
  ctx.lineWidth = Math.max(1, radius * 0.08);
  ctx.stroke();
  text(label(piece), x, y - radius * 0.25, Math.max(10, radius * 1.02), rim, true);
  for (const dx of [-0.4, 0.4]) {
    ctx.beginPath();
    ctx.arc(x + radius * dx, y + radius * 0.3, Math.max(1, radius * 0.095), 0, Math.PI * 2);
    ctx.fillStyle = colors.ink;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      x + radius * dx * 1.42,
      y + radius * 0.47,
      radius * 0.12,
      radius * 0.09,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = '#ef947e';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y + radius * 0.31, radius * 0.16, 0.12, Math.PI - 0.12);
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = Math.max(1, radius * 0.075);
  ctx.stroke();
}

// Selection and animation are local; every game action remains server-authoritative.
export function createRenderer() {
  let selected = null,
    lastPly = -1,
    hits = [],
    note = '',
    lastMoveAt = 0,
    priorBoard = [],
    lastDestination = null;
  const ownTurn = (state) =>
    state && !state.result && state.turn === (state.seat === 0 ? 'red' : 'black');
  return {
    draw(ctx, width, height, state) {
      hits = [];
      ctx.fillStyle = colors.cream;
      ctx.fillRect(0, 0, width, height);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const text = (value, x, y, size = 14, color = colors.ink, bold = false) => {
        ctx.font = `${bold ? '800 ' : ''}${size}px "PingFang SC", sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(value, x, y);
      };
      if (!state?.board) {
        text('等好友一起下棋…', width / 2, 30);
        return hits;
      }
      if (state.ply !== lastPly) {
        lastDestination = state.board.findIndex(
          (piece, index) => piece && `${piece.side}:${piece.type}` !== priorBoard[index],
        );
        priorBoard = state.board.map((piece) => (piece ? `${piece.side}:${piece.type}` : ''));
        selected = null;
        note = '';
        lastPly = state.ply;
        lastMoveAt = Date.now();
      }
      if (!ownTurn(state)) selected = null;
      // Keep board geometry identical across native and H5 clients.
      const unit = Math.max(8, Math.min((width - 12) / 9, (height - 104) / 10, 56));
      const left = (width - unit * 9) / 2,
        top = 36;
      const me = state.seat === 0 ? '红' : '黑';
      const seconds = Math.max(0, Math.ceil((900000 - state.elapsedMs) / 1000));
      const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      rounded(ctx, left + 2, 4, unit * 9 - 4, 26, 13, '#eef2da');
      text(
        state.result
          ? state.result === 'draw'
            ? '平局啦，再玩一局！'
            : `${sideName(state.result)}连五获胜！`
          : `你执${me} · ${ownTurn(state) ? '轮到你啦' : '等好友落子'} · ${time}`,
        width / 2,
        17,
        Math.min(13, width / 24),
        colors.ink,
        true,
      );
      rounded(ctx, left - 4, top - 4, unit * 9 + 8, unit * 10 + 9, 13, '#b9814d', colors.ink);
      rounded(ctx, left - 2, top - 4, unit * 9 + 4, unit * 10 + 3, 11, colors.wood, '#aa7546');
      rounded(ctx, left + 1, top + 1, unit * 9 - 2, unit * 10 - 2, 7, colors.board, '#9c714a');
      ctx.strokeStyle = '#9b7a50';
      ctx.lineWidth = Math.max(0.7, unit / 38);
      for (let x = 0; x < 9; x++) {
        ctx.beginPath();
        ctx.moveTo(left + (x + 0.5) * unit, top + 0.5 * unit);
        ctx.lineTo(left + (x + 0.5) * unit, top + 9.5 * unit);
        ctx.stroke();
      }
      for (let y = 0; y < 10; y++) {
        ctx.beginPath();
        ctx.moveTo(left + 0.5 * unit, top + (y + 0.5) * unit);
        ctx.lineTo(left + 8.5 * unit, top + (y + 0.5) * unit);
        ctx.stroke();
      }
      ctx.fillStyle = '#f8ddb0';
      ctx.fillRect(left + unit * 0.52, top + unit * 4.6, unit * 7.96, unit * 0.8);
      text('楚 河', left + unit * 2.5, top + unit * 5, unit * 0.37, '#956f47', true);
      text('汉 界', left + unit * 6.5, top + unit * 5, unit * 0.37, '#956f47', true);
      const reduced =
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      state.board.forEach((piece, index) => {
        const x = left + ((index % 9) + 0.5) * unit,
          y = top + (Math.floor(index / 9) + 0.5) * unit;
        const winning = state.winningLine?.includes(index);
        if (piece) {
          const elapsed = Date.now() - lastMoveAt;
          const bounce =
            !reduced && index === lastDestination && elapsed < 350
              ? Math.sin((elapsed / 350) * Math.PI) * unit * 0.08
              : 0;
          token(ctx, x, y - bounce, unit * 0.38, piece, text, winning, selected === index);
        }
        const legal = selected !== null && canMove(state.board, selected, index, 9);
        if (legal) {
          ctx.beginPath();
          ctx.arc(x, y, unit * (piece ? 0.46 : 0.11), 0, Math.PI * 2);
          ctx.strokeStyle = piece ? colors.coral : '#689664';
          ctx.lineWidth = 2.2;
          ctx.stroke();
          if (!piece) {
            ctx.fillStyle = '#a7c699';
            ctx.fill();
          }
        }
        hits.push({
          label: `${String.fromCharCode(65 + (index % 9))}${Math.floor(index / 9) + 1}${piece ? sideName(piece.side) + label(piece) : '空位'}`,
          x: x - unit / 2,
          y: y - unit / 2,
          w: unit,
          h: unit,
          index,
        });
      });
      const bottom = top + unit * 10;
      text(
        note ||
          (!ownTurn(state)
            ? '好友正在想下一手，马上轮到你'
            : state.pending
              ? `抽到「${label(state.pending)}」！点空位放上场`
              : selected !== null
                ? '点绿点移动，点红圈吃子'
                : '点空位落子，点自己的棋子移动'),
        width / 2,
        bottom + 15,
        Math.min(12, width / 27),
        '#8e7056',
      );
      const count = Object.values(state.poolCounts?.[state.turn] || {}).reduce(
        (sum, n) => sum + n,
        0,
      );
      const canDraw = ownTurn(state) && !state.pending && count > 0;
      const buttonWidth = Math.min(width - 16, 240),
        x = (width - buttonWidth) / 2;
      rounded(
        ctx,
        x,
        bottom + 24,
        buttonWidth,
        44,
        18,
        canDraw ? colors.coral : '#dbe6c7',
        canDraw ? colors.red : '#94ad80',
      );
      text(
        state.result
          ? '五连达成！'
          : !ownTurn(state)
            ? '等朋友落子'
            : state.pending
              ? `已抽到「${label(state.pending)}」`
              : `抽一枚 · 还剩 ${count} 枚`,
        width / 2,
        bottom + 46,
        15,
        canDraw ? '#fffaf0' : colors.green,
        true,
      );
      if (canDraw)
        hits.push({
          label: '先抽子查看',
          x,
          y: bottom + 24,
          w: buttonWidth,
          h: 44,
          action: { type: 'draw' },
        });
      return hits;
    },
    tap(x, y, state) {
      if (!ownTurn(state)) return null;
      const hit = hits.find(
        (item) => x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h,
      );
      if (!hit) return null;
      if (hit.action) {
        selected = null;
        note = '';
        return hit.action;
      }
      const index = hit.index,
        piece = state.board[index];
      if (state.pending) return piece ? null : { type: 'deploy', to: index };
      if (piece?.side === state.turn) {
        selected = selected === index ? null : index;
        note = '';
        return null;
      }
      if (selected !== null) {
        if (canMove(state.board, selected, index, 9))
          return { type: 'move', from: selected, to: index };
        note = '这里走不到哦，试试绿点';
        return null;
      }
      if (!piece && Object.values(state.poolCounts?.[state.turn] || {}).some((n) => n > 0))
        return { type: 'deploy-directly', to: index };
      return null;
    },
  };
}
