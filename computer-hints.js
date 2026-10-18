import { explainHint } from './computer.js';

// One earned hint belongs to one game/turn, including a subsequently revealed draw.
export function createComputerHints({ analyze, access, cancelAnalysis = () => {} }) {
  let game, ply, pending, result = null, earned = false, request = null;
  let phase = '', message = '';
  function cancel() {
    if (request && phase === 'advertising') access.cancel();
    if (request && phase === 'analyzing') cancelAnalysis();
    request = null;
    if (phase) message = '提示未成功生成，请重试。';
    phase = '';
  }
  function sync(state) {
    if (game !== state || ply !== state.ply || state.result) {
      cancel();
      game = state; ply = state.ply; earned = false; result = null; message = '';
    }
    if (pending !== state.pending?.type) {
      cancel(); pending = state.pending?.type; result = null; message = '';
    }
    return { result, earned, phase, message };
  }
  return {
    sync,
    cancel,
    async request(state, changed = () => {}) {
      sync(state);
      if (request || state.result || state.turn !== 'red') return;
      if (result) { message = result.text; changed(); return; }
      const current = {};
      request = current;
      try {
        if (!earned) {
          phase = 'advertising'; message = access.adsEnabled ? '正在准备广告，观看完成后开始分析…' : '正在准备提示…'; changed();
          const outcome = await access.request('xiangqi-five:computer-hint');
          if (request !== current) return;
          sync(state);
          if (request !== current) return;
          if (!['free', 'completed'].includes(outcome.status)) {
            message = outcome.status === 'dismissed' ? '广告未看完，提示未成功生成。' : '广告暂不可用，提示未成功生成，请重试。';
            return;
          }
          earned = true;
        }
        phase = 'analyzing'; message = '正在分析最佳应对…'; changed();
        const analysis = await analyze(state, () => request !== current);
        if (request !== current) return;
        sync(state);
        if (request !== current) return;
        const hint = explainHint(state, analysis);
        if (!hint) {
          message = analysis.action?.type === 'resign'
            ? '对方下一手连五已无法阻挡，建议重开一局。'
            : '提示未成功生成，可免费重试本回合。';
          return;
        }
        result = hint; message = hint.text;
      } catch {
        if (request === current) message = earned ? '提示未成功生成，可免费重试本回合。' : '提示未成功生成，请重试。';
      } finally {
        if (request === current) { request = null; phase = ''; changed(); }
      }
    },
  };
}
