import { decodeGame, encodeGame, SAVE_KEY } from './local-game.js';
import { decodeChallengeProgress, CHALLENGE_SAVE_KEY } from './challenges.js';
export function validateTapProgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的棋局存档');
  const local = value.local ? decodeGame(value.local) : null;
  if (value.local && !local) throw new Error('云档棋局无法通过规则重放');
  return { version: 1, local: local ? encodeGame(local.state, local.opponent, local.difficulty) : null,
    progress: decodeChallengeProgress(JSON.stringify({ version: 1, progress: value.progress })) };
}
export function mergeTapProgress(local, incoming) {
  const result = validateTapProgress(incoming), before = validateTapProgress(local);
  for (const [id, record] of Object.entries(before.progress)) {
    const other = result.progress[id];
    result.progress[id] = { stars: Math.max(record.stars, other?.stars || 0), attempts: Math.max(record.attempts, other?.attempts || 0) };
  }
  return result;
}
export const tapProgressScore = value => Object.values(validateTapProgress(value).progress).filter(record => record.stars === 2).length;
export const tapProgressSummary = value => `独立解题 ${tapProgressScore(value)} 题${value.local ? ' · 含本地棋局' : ''}`;

// Both keys describe one local snapshot. Roll back earlier writes if storage fails midway.
export function writeTapProgress(storage, value) {
  const writes = [[CHALLENGE_SAVE_KEY, JSON.stringify({version:1,progress:value.progress})], ...(value.local ? [[SAVE_KEY,value.local]] : [])];
  const before = writes.map(([key]) => [key,storage.getItem(key)]), applied = [];
  try { for (const [key,text] of writes) { storage.setItem(key,text); applied.push(key); } }
  catch (error) {
    for (const key of applied.reverse()) { const previous = before.find(([name])=>name===key)[1]; try { if(previous == null && storage.removeItem)storage.removeItem(key);else storage.setItem(key,previous || ''); } catch { /* The service-level backup remains available. */ } }
    throw error;
  }
}
