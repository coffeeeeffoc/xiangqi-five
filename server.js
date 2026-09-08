import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRoomService } from './rooms.js';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/board-view.js': ['board-view.js', 'text/javascript; charset=utf-8'],
  '/pieces.js': ['pieces.js', 'text/javascript; charset=utf-8'],
  '/game.js': ['game.js', 'text/javascript; charset=utf-8'],
};
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const handleRoom = createRoomService();
const server = createServer(async (req, res) => {
  if (await handleRoom(req, res)) return;
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const file = files[(req.url || '/').split('?')[0]];
  if (!file) { res.writeHead(404).end('Not found'); return; }
  try {
    const data = await readFile(new URL(file[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(500).end('Unable to load file');
  }
});
server.on('error', (error) => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
server.listen(port, host, () => console.log(`象五子棋：http://${host}:${port}`));
