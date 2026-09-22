import { canMove, label, sideName } from './game.js';

// Selection is local; drawing, moving, captures and the result only come from the server.
export function createRenderer() {
  let selected = null, lastPly = -1, hits = [], note = '';
  const ownTurn = state => state && !state.result && state.turn === (state.seat === 0 ? 'red' : 'black');
  return {
    draw(ctx, width, height, state) {
      hits = [];
      ctx.fillStyle = '#f3efe5'; ctx.fillRect(0, 0, width, height);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      const text = (value, x, y, size = 14, color = '#263d34') => {
        ctx.font = `${size}px sans-serif`; ctx.fillStyle = color; ctx.fillText(value, x, y);
      };
      if (!state?.board) { text('等待双方准备…', width / 2, 30); return hits; }
      if (state.ply !== lastPly || !ownTurn(state)) { selected = null; note = ''; lastPly = state.ply; }
      const unit = Math.max(8, Math.min((width - 12) / 9, (height - 104) / 10, 56));
      const left = (width - unit * 9) / 2, top = 36;
      const me = state.seat === 0 ? '红' : '黑';
      const seconds = Math.max(0, Math.ceil((900000 - state.elapsedMs) / 1000));
      const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      text(state.result ? state.result === 'draw' ? '和棋' : `${sideName(state.result)}获胜` : `你执${me} · ${ownTurn(state) ? '轮到你' : '等待对手'} · ${time}`, width / 2, 16);
      ctx.fillStyle = '#e8dcc2'; ctx.fillRect(left, top, unit * 9, unit * 10);
      ctx.strokeStyle = '#aea087'; ctx.lineWidth = 1;
      for (let x = 0; x < 9; x++) { ctx.beginPath(); ctx.moveTo(left + (x + .5) * unit, top + .5 * unit); ctx.lineTo(left + (x + .5) * unit, top + 9.5 * unit); ctx.stroke(); }
      for (let y = 0; y < 10; y++) { ctx.beginPath(); ctx.moveTo(left + .5 * unit, top + (y + .5) * unit); ctx.lineTo(left + 8.5 * unit, top + (y + .5) * unit); ctx.stroke(); }
      state.board.forEach((piece, index) => {
        const x = left + (index % 9 + .5) * unit, y = top + (Math.floor(index / 9) + .5) * unit;
        if (piece) {
          ctx.beginPath(); ctx.arc(x, y, unit * .39, 0, Math.PI * 2);
          ctx.fillStyle = state.winningLine.includes(index) ? '#ffe7a6' : '#fff6df'; ctx.fill();
          ctx.strokeStyle = selected === index ? '#2d8968' : piece.side === 'red' ? '#b23d32' : '#334237'; ctx.lineWidth = selected === index ? 3 : 1.5; ctx.stroke();
          text(label(piece), x, y, Math.max(10, unit * .55), piece.side === 'red' ? '#b23d32' : '#334237');
        }
        const legal = selected !== null && canMove(state.board, selected, index, 9);
        if (legal) { ctx.beginPath(); ctx.arc(x, y, unit * (piece ? .46 : .1), 0, Math.PI * 2); ctx.strokeStyle = '#278362'; ctx.lineWidth = 2; ctx.stroke(); }
        hits.push({ label: `${String.fromCharCode(65 + index % 9)}${Math.floor(index / 9) + 1}${piece ? sideName(piece.side) + label(piece) : '空位'}`, x: x - unit / 2, y: y - unit / 2, w: unit, h: unit, index });
      });
      const bottom = top + unit * 10;
      text(note || (state.pending ? `已抽到「${label(state.pending)}」，请选择空位` : selected !== null ? '点绿圈移动 / 吃子；再点己方棋子取消' : '点空位随机部署；点己方棋子再移动'), width / 2, bottom + 15, Math.min(12, width / 25));
      const count = Object.values(state.poolCounts?.[state.turn] || {}).reduce((sum, n) => sum + n, 0);
      const canDraw = ownTurn(state) && !state.pending && count > 0;
      const buttonWidth = Math.min(width - 16, 220), x = (width - buttonWidth) / 2;
      ctx.fillStyle = canDraw ? '#9a4335' : '#a8a899'; ctx.fillRect(x, bottom + 28, buttonWidth, 42);
      text(state.result ? '本局已结束' : state.pending ? `已抽到${label(state.pending)} · 须部署` : `先抽子查看 · 剩余 ${count} 枚`, width / 2, bottom + 49, 14, '#fffaf0');
      if (canDraw) hits.push({ label: '先抽子查看', x, y: bottom + 28, w: buttonWidth, h: 42, action: { type: 'draw' } });
      return hits;
    },
    tap(x, y, state) {
      if (!ownTurn(state)) return null;
      const hit = hits.find(item => x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h);
      if (!hit) return null;
      if (hit.action) { selected = null; note = ''; return hit.action; }
      const index = hit.index, piece = state.board[index];
      if (state.pending) return piece ? null : { type: 'deploy', to: index };
      if (piece?.side === state.turn) { selected = selected === index ? null : index; note = ''; return null; }
      if (selected !== null) {
        if (canMove(state.board, selected, index, 9)) return { type: 'move', from: selected, to: index };
        note = '不能走到这里，点绿圈或重新选子'; return null;
      }
      if (!piece && Object.values(state.poolCounts?.[state.turn] || {}).some(n => n > 0)) return { type: 'deploy-directly', to: index };
      return null;
    },
  };
}
