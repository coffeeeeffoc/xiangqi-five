import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

if (process.argv.includes('--with-service') && process.argv.includes('--without-service'))
  throw new Error('Choose --with-service or --without-service');

await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
for (const file of [
  'index.html',
  'dev-mode.js',
  'style.css',
  'app.js',
  'rewarded-hints.js',
  'game.js',
  'pieces.js',
  'board-view.js',
  'computer.js',
  'computer-worker.js',
  'local-game.js',
  'challenges.js',
  'fullscreen.js',
  'safe-area.js',
]) {
  await copyFile(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url));
}
await mkdir(new URL('./dist/assets/', import.meta.url), { recursive: true });
const withService = process.argv.includes('--with-service');
const html = await readFile(new URL('index.html', import.meta.url), 'utf8');
if (!html.includes('<script type="module" src="./app.js"></script>')) throw new Error('缺少 app.js 入口，无法配置房间服务开关。');
await writeFile(new URL('dist/index.html', import.meta.url), html.replace(
  '<script type="module" src="./app.js"></script>',
  `<script>globalThis.__XIANGQI_ROOM_SERVICE__ = ${withService};</script>\n    <script type="module" src="./app.js"></script>`,
));
for (const asset of [
  'hero-paper.webp',
  'five-piece-logo.webp',
  'pavilion-background.png',
  'chess-glyphs.woff2',
  'chess-glyphs-LICENSE.txt',
]) {
  await copyFile(
    new URL(`./assets/${asset}`, import.meta.url),
    new URL(`./dist/assets/${asset}`, import.meta.url),
  );
}
await writeFile(new URL('dist/.nojekyll', import.meta.url), '');
console.log(withService ? '静态前端已生成到 dist/；好友房间需另行运行服务。' : '无服务前端已生成到 dist/；好友房间已关闭。');
