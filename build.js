import { mkdir, copyFile, writeFile } from 'node:fs/promises';

await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'game.js', 'pieces.js', 'board-view.js', 'computer.js', 'computer-worker.js', 'local-game.js', 'fullscreen.js']) {
  await copyFile(new URL(file, import.meta.url), new URL(`dist/${file}`, import.meta.url));
}
await writeFile(new URL('dist/.nojekyll', import.meta.url), '');
console.log('静态前端已生成到 dist/；联机仍需运行房间服务。');
