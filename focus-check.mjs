import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://local').pathname.slice(1) || 'index.html';
  if (!/^[\w.-]+$/.test(name)) return res.writeHead(404).end();
  try {
    const data = await readFile(new URL(`dist/${name}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': ({ js: 'text/javascript', html: 'text/html', css: 'text/css' })[name.split('.').at(-1)] || 'text/plain' }).end(data);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch();
try {
  await mkdir(new URL('.turbo/competition/', import.meta.url), { recursive: true });
  for (const [width, height] of [[305, 568], [390, 844], [844, 390], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.selectOption('#play-mode', 'local');
    await page.locator('.cell').first().tap();
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('play-focus')), true);
    assert.equal(await page.locator('.brand').isVisible(), false);
    assert.equal(await page.locator('.play-settings').isVisible(), false);
    assert.equal(await page.locator('.board-settings').isVisible(), false);
    for (const id of ['board', 'draw-button', 'move-button', 'focus-toggle', 'rules-open']) {
      const box = await page.locator(`#${id}`).boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `${width}x${height}/${id} ${JSON.stringify(box)}`);
    }
    const saved = await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1'));
    await page.locator('#focus-toggle').tap();
    assert.equal(await page.locator('.play-settings').isVisible(), true);
    await page.locator('#focus-toggle').tap();
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1')), saved);
    await page.locator('.cell').last().tap();
    assert.equal(await page.locator('#history-count').textContent(), '2');
    await page.reload();
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('play-focus')), true);
    assert.equal(await page.locator('#history-count').textContent(), '2');
    await page.screenshot({ path: fileURLToPath(new URL(`.turbo/competition/focus-${width}.png`, import.meta.url)) });
    await page.close();
    console.log(`PASS ${width}x${height}: focus, visible core controls, settings roundtrip, real moves, reload`);
  }
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
