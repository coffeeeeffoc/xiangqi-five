import { undoComputerTurn } from './local-game.js';

export const UNDO_FAILED = '未成功获得悔棋次数，悔棋失败';

export function createComputerUndo(access) {
  let game, ply, pending, request = null, message = '';
  function cancel() {
    if (!request) return;
    request = null;
    message = UNDO_FAILED;
    access.cancel();
  }
  function sync(state) {
    if (game !== state || ply !== state.ply || pending !== state.pending?.type) {
      cancel(); game = state; ply = state.ply; pending = state.pending?.type; message = '';
    }
    return { pending: Boolean(request), message };
  }
  return { sync, cancel, clearMessage() { message = ''; },
    async request(state, apply, changed = () => {}) {
      sync(state);
      if (request) return;
      const next = undoComputerTurn(state);
      if (!next) return;
      const current = {};
      request = current;
      try {
        if (state.freeUndoUsed) {
          message = '正在准备广告，观看完成后获得一次悔棋…'; changed();
          const outcome = await access.request('xiangqi-five:computer-undo', { undo: 1 });
          if (request !== current) return;
          sync(state);
          if (request !== current) return;
          if (outcome.status !== 'completed') { message = UNDO_FAILED; return; }
        }
        request = null;
        game = next; ply = next.ply; pending = next.pending?.type;
        message = '已悔棋，请重新落子。';
        apply(next);
      } catch { if (request === current) message = UNDO_FAILED; }
      finally { if (request === current) request = null; changed(); }
    },
  };
}
