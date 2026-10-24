import { mkdir, copyFile, readFile, writeFile, lstat, rm } from 'node:fs/promises';

if (process.argv.includes('--with-service') && process.argv.includes('--without-service'))
  throw new Error('Choose --with-service or --without-service');

const output = new URL('./dist', import.meta.url);
const previous = await lstat(output).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
// Never follow a redirected output directory. rm unlinks nested symlinks rather than
// following them, so only this game's own build output is replaced.
if (previous && (!previous.isDirectory() || previous.isSymbolicLink()))
  throw new Error('dist must be a real directory, not a file or symbolic link');
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const file of [
  'index.html',
  'dev-mode.js',
  'style.css',
  'app.js',
  'loading.js',
  'rewarded-hints.js',
  'game.js',
  'pieces.js',
  'board-view.js',
  'computer.js',
  'computer-hints.js',
  'computer-undo.js',
  'computer-worker.js',
  'local-game.js', 'tap-save.js',
  'challenges.js',
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
