import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://local').pathname.slice(1) || 'index.html';
  if (!/^(?:assets\/)?[\w.-]+$/.test(name)) return res.writeHead(404).end();
  try {
    const data = await readFile(new URL(`dist/${name}`, import.meta.url));
    res
      .writeHead(200, {
        'Content-Type':
          { js: 'text/javascript', html: 'text/html', css: 'text/css', svg: 'image/svg+xml' }[
            name.split('.').at(-1)
          ] || 'text/plain',
      })
      .end(data);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: ['--no-sandbox'],
});
try {
  await mkdir(new URL('.turbo/competition/', import.meta.url), { recursive: true });
  for (const [width, height] of [
    [305, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#home-start').tap();
    await page.locator('#mode-local').tap();
    await page.locator('#setup-start').tap();
    await page.locator('[data-screen="game"]:not(body)').waitFor({ state: 'visible' });
    await page.locator('.cell').first().tap();
    assert.equal(
      await page.locator('body').evaluate((el) => el.classList.contains('play-focus')),
      true,
    );
    assert.equal(await page.locator('[data-screen="home"]:not(body)').isVisible(), false);
    assert.equal(await page.locator('[data-screen="setup"]:not(body)').isVisible(), false);
    assert.equal(await page.locator('[data-screen="tools"]:not(body)').isVisible(), false);
    for (const id of [
      'board',
      'draw-button',
      'move-button',
      'game-more',
      'game-back',
      'game-zoom',
    ]) {
      const box = await page.locator(`#${id}`).boundingBox();
      assert.ok(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width &&
          box.y + box.height <= height,
        `${width}x${height}/${id} ${JSON.stringify(box)}`,
      );
    }
    const saved = await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1'));
    await page.locator('#game-more').tap();
    await page.locator('#tools-settings').tap();
    assert.equal(await page.locator('[data-screen="setup"]:not(body)').isVisible(), true);
    assert.equal(await page.locator('#board').isVisible(), false);
    await page.locator('#setup-start').tap();
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1')), saved);
    await page.locator('.cell').last().tap();
    assert.equal(await page.locator('#history-count').textContent(), '2');
    await page.reload();
    assert.equal(await page.locator('[data-screen="home"]:not(body)').isVisible(), true);
    await page.locator('#home-continue').tap();
    assert.equal(
      await page.locator('body').evaluate((el) => el.classList.contains('play-focus')),
      true,
    );
    assert.equal(await page.locator('#history-count').textContent(), '2');
    await page.screenshot({
      path: fileURLToPath(new URL(`.turbo/competition/focus-${width}.png`, import.meta.url)),
    });
    await page.close();
    console.log(
      `PASS ${width}x${height}: focus, visible core controls, settings roundtrip, real moves, reload`,
    );
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
