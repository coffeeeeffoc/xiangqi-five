import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRoomService } from './rooms.js';

test('real room HTTP: seats, authentication, authoritative draw, stale actions and mutual restart', async () => {
  const handle = createRoomService();
  const server = createServer(async (req, res) => { if (!await handle(req, res)) res.writeHead(404).end(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/rooms`;
  const request = async (path = '', body, token, expected = 200, headers = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, expected, data.error);
    return data;
  };
  try {
    assert.deepEqual(await request('/health'), { service: 'xiangqi-five' });
    const red = await request('', { mode: 'gomoku' }, null, 201);
    assert.equal(red.state.board.length, 225);
    const path = `/${red.code}`;
    await request(path, undefined, null, 401);
    await request(path, undefined, 'é'.repeat(48), 401);
    await request(path + '/action', { type: 'draw', version: 0 }, red.token, 409);
    const black = await request(path + '/join', {});
    assert.equal(black.side, 'black');
    await request(path + '/join', {}, null, 409);
    await request(path + '/action', { type: 'draw', version: 1 }, black.token, 403);
    let result = await request(path + '/action', { type: 'draw', version: 1 }, red.token);
    assert.equal(result.state.pools.red.length, 15);
    assert.ok(result.state.pending);
    assert.equal(result.token, undefined);
    assert.equal(result.tokens, undefined);
    await request(path + '/action', { type: 'draw', version: 1 }, red.token, 409);
    await request(path + '/action', { type: 'draw', version: 2 }, red.token, 400);
    await request(path + '/action', { type: 'deploy', to: 225, version: 2 }, red.token, 400);
    const same = await request(path, undefined, black.token);
    assert.deepEqual(same.state, result.state);
    result = await request(path + '/action', { type: 'deploy', to: 224, version: 2 }, red.token);
    assert.equal(result.state.turn, 'black');
    assert.equal(result.state.board[224].side, 'red');
    result = await request(path + '/action', { type: 'restart', version: 3 }, red.token);
    assert.deepEqual(result.restartVotes, ['red']);
    await request(path + '/action', { type: 'draw', version: 4 }, black.token, 409);
    result = await request(path + '/action', { type: 'cancel-restart', version: 4 }, black.token);
    assert.deepEqual(result.restartVotes, []);
    await request(path + '/action', { type: 'restart', version: 5 }, black.token);
    result = await request(path + '/action', { type: 'restart', version: 6 }, red.token);
    assert.equal(result.state.ply, 0);
    assert.equal(result.state.mode, 'gomoku');
    assert.equal(result.state.pools.red.length, 16);
    assert.equal(result.state.board.filter(Boolean).length, 0);
    result = await request(path + '/action', { type: 'deploy-directly', to: 0, version: 7 }, red.token);
    assert.equal(result.state.ply, 1);
    assert.equal(result.state.pending, null);
    assert.equal(result.state.pools.red.length, 15);
    await request(path + '/action', { type: 'deploy-directly', to: 0, version: 8 }, black.token, 400);
    result = await request(path + '/action', { type: 'deploy-directly', to: 224, version: 8 }, black.token);
    assert.equal(result.state.ply, 2);
    assert.equal(result.state.pools.black.length, 15);
    result = await request(path + '/action', { type: 'deploy-directly', to: 1, version: 9 }, red.token);
    assert.equal(result.state.board[1].side, 'red');
    assert.equal(result.state.pools.red.length, 14);
    assert.equal(result.state.ply, 3);
    assert.equal(result.state.turn, 'black');
    assert.equal(result.version, 10);
    await request('', { mode: '__proto__' }, null, 400);
    await request('', {}, null, 403, { Origin: 'https://untrusted.example' });
    const previousOrigin = process.env.FRONTEND_ORIGIN;
    try {
      process.env.FRONTEND_ORIGIN = 'https://example.github.io';
      const preflight = await fetch(base + path, { method: 'OPTIONS', headers: { Origin: process.env.FRONTEND_ORIGIN } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), process.env.FRONTEND_ORIGIN);
      const crossOrigin = await fetch(base + path, { headers: { Origin: process.env.FRONTEND_ORIGIN, Authorization: `Bearer ${red.token}` } });
      assert.equal(crossOrigin.status, 200);
      assert.equal(crossOrigin.headers.get('Access-Control-Allow-Origin'), process.env.FRONTEND_ORIGIN);
    } finally {
      if (previousOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
      else process.env.FRONTEND_ORIGIN = previousOrigin;
    }
    const malformed = await fetch(base, { method: 'POST', body: '{' });
    assert.equal(malformed.status, 400);
    const oversized = await fetch(base, { method: 'POST', body: 'x'.repeat(5000) });
    assert.equal(oversized.status, 413);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
