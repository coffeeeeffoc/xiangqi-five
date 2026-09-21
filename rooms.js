import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { newGame, draw, deploy, move, deployDirectly } from './game.js';

// ponytail: rooms live in one process and expire; use shared storage before running multiple instances.
export function createRoomService() {
  const rooms = new Map();
  const reply = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const snapshot = (room) => ({ state: room.state, version: room.version, joined: Boolean(room.tokens.black), restartVotes: room.restartVotes });
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const sameToken = (a, b) => typeof a === 'string' && /^[a-f0-9]{48}$/.test(a) && typeof b === 'string' && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  return async function handleRoom(req, res) {
    const path = (req.url || '').split('?')[0];
    if (!path.startsWith('/api/rooms')) return false;
    try {
      // A configured Pages origin may access the API; arbitrary websites cannot create rooms.
      const origin = req.headers.origin;
      const allowed = process.env.FRONTEND_ORIGIN;
      if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}` && origin !== allowed) {
        throw fail(403, '此站点未被房间服务允许，请配置 FRONTEND_ORIGIN');
      }
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }); res.end(); return true;
      }
      if (!['GET', 'POST'].includes(req.method)) throw fail(405, '不支持此请求方式');
      if (path === '/api/rooms/health' && req.method === 'GET') { reply(res, 200, { service: 'xiangqi-five' }); return true; }
      let body = {};
      if (req.method === 'POST') {
        let size = 0, chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4096) throw fail(413, '请求内容过大');
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
        catch { throw fail(400, '请求必须是有效 JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, '请求格式错误');
      }
      const now = Date.now();
      for (const [code, room] of rooms) if (now - room.touched > 3_600_000 || now - room.created > 86_400_000) rooms.delete(code);
      if (path === '/api/rooms' && req.method === 'POST') {
        if (rooms.size >= 100) throw fail(503, '房间已满，请稍后重试');
        const state = newGame(body.mode);
        let code;
        do { code = randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
        const token = randomBytes(24).toString('hex');
        const room = { state, version: 0, tokens: { red: token, black: null }, created: now, touched: now, restartVotes: [] };
        rooms.set(code, room);
        reply(res, 201, { code, token, side: 'red', ...snapshot(room) }); return true;
      }
      const match = /^\/api\/rooms\/([A-F0-9]{8})(?:\/(join|action))?$/.exec(path);
      if (!match) throw fail(404, '房间接口不存在');
      const room = rooms.get(match[1]);
      if (!room) throw fail(404, '房间不存在或已过期');
      if (match[2] === 'join' && req.method === 'POST') {
        if (room.tokens.black) throw fail(409, '房间已有两名玩家');
        const token = randomBytes(24).toString('hex');
        room.tokens.black = token; room.version++; room.touched = now;
        reply(res, 200, { code: match[1], token, side: 'black', ...snapshot(room) }); return true;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const side = ['red', 'black'].find((side) => sameToken(token, room.tokens[side]));
      if (!side) throw fail(401, '房间身份无效');
      room.touched = now;
      if (!match[2] && req.method === 'GET') { reply(res, 200, snapshot(room)); return true; }
      if (match[2] !== 'action' || req.method !== 'POST') throw fail(405, '不支持此请求方式');
      if (!room.tokens.black) throw fail(409, '等待另一名玩家加入');
      if (body.version !== room.version) throw fail(409, '棋局已更新，请同步后再操作');
      if (body.type === 'cancel-restart') {
        room.restartVotes = [];
      } else if (body.type === 'restart') {
        if (!room.restartVotes.includes(side)) room.restartVotes.push(side);
        if (room.restartVotes.length === 2) { room.state = newGame(room.state.mode); room.restartVotes = []; }
      } else {
        if (room.restartVotes.length) throw fail(409, '正在等待双方同意重开，可先取消申请');
        if (side !== room.state.turn) throw fail(403, '还没有轮到你');
        if (body.type === 'draw') draw(room.state, () => randomInt(0x1000000) / 0x1000000);
        else if (body.type === 'deploy-directly') deployDirectly(room.state, body.to, () => randomInt(0x1000000) / 0x1000000);
        else if (body.type === 'deploy') deploy(room.state, body.to);
        else if (body.type === 'move') move(room.state, body.from, body.to);
        else throw fail(400, '未知行动');
      }
      room.version++;
      reply(res, 200, snapshot(room));
    } catch (error) { reply(res, error.status || 400, { error: error.message }); }
    return true;
  };
}
