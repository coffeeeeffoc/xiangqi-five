// Run after `pnpm build` from the small-games workspace (uses its existing Playwright).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from '@playwright/test';

const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
const server = createServer(async (request, response) => {
  const filename = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^[\w.-]+$/.test(filename)) return response.writeHead(404).end();
  try {
    const data = await readFile(new URL(`./dist/${filename}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': mime[filename.split('.').at(-1)] || 'application/octet-stream' }).end(data);
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch();
const url = `http://127.0.0.1:${server.address().port}/`;
try {
  for (const width of [320, 390, 1280]) for (const mode of ['xiangqi', 'gomoku']) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 760, reducedMotion: 'reduce' });
    await page.addInitScript(() => { Math.random = () => 0; });
    await page.goto(url);
    await page.selectOption('#play-mode', 'local');
    await page.selectOption('#board-mode', mode);
    const cols = mode === 'xiangqi' ? 9 : 15, source = cols * 4 + 4, above = source - cols;
    const cells = page.locator('.cell');
    await cells.nth(source).tap();
    await cells.last().tap();
    await cells.nth(above).scrollIntoViewIfNeeded();
    const box = await cells.nth(above).boundingBox();
    // The lower edge belongs to this empty square, even when the next row's art overlaps it.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 4);
    assert.equal(await page.locator('#history-count').textContent(), '3', `${width}/${mode}: adjacent art swallowed a tap`);
    assert.match(await cells.nth(above).getAttribute('aria-label'), /红方车/);
    await page.reload();
    assert.equal(await page.locator('#history-count').textContent(), '3');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.close();
    console.log(`PASS ${width}px ${mode}: neighboring-cell touch, save/reload, no overflow`);
  }
  for (const mode of ['xiangqi', 'gomoku']) for (const difficulty of ['practice', 'standard', 'hard']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => { Math.random = () => 0; });
    await page.goto(url);
    await page.selectOption('#board-mode', mode);
    await page.selectOption('#difficulty', difficulty);
    await page.reload();
    assert.equal(await page.locator('#difficulty').inputValue(), difficulty);
    assert.equal(await page.locator('#difficulty option').count(), 3);
    const cols = mode === 'xiangqi' ? 9 : 15, rook = 4 * cols + 4;
    await page.locator('.cell').nth(rook).tap();
    assert.equal(await page.locator('#difficulty').isDisabled(), true);
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '2', null, { timeout: 12000 });
    await page.waitForFunction(() => document.querySelector('#board').getAttribute('aria-busy') === 'false');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi-five-local-v1')));
    const to = saved.history[1].to;
    assert.ok(to % cols !== rook % cols && Math.floor(to / cols) !== Math.floor(rook / cols), 'real worker must not deploy on the rook file/rank');
    assert.equal(saved.difficulty, difficulty);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${mode}/${difficulty}: setting persists, worker avoids rook, input unlocks, no overflow`);
  }
  const cancellation = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await cancellation.goto(url);
  await cancellation.selectOption('#difficulty', 'hard');
  await cancellation.locator('.cell').nth(40).click();
  await cancellation.selectOption('#play-mode', 'local');
  await cancellation.locator('#restart-confirm').click();
  await cancellation.waitForTimeout(5000);
  assert.equal(await cancellation.locator('#history-count').textContent(), '0', 'cancelled worker cannot write into a new local game');
  assert.equal(await cancellation.locator('#difficulty').isVisible(), false);
  await cancellation.close();
  console.log('PASS switch mode while thinking: cancelled worker cannot play into the new game');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto(url);
  const cells = page.locator('.cell');
  const idle = () => page.waitForFunction(() => document.querySelector('#board').getAttribute('aria-busy') === 'false');
  await cells.nth(40).tap();
  assert.equal(await cells.nth(0).isDisabled(), true, 'input stays locked until the computer responds');
  await page.waitForFunction(() => document.querySelector('#history-count').textContent === '2');
  await idle();
  assert.match(await page.locator('#turn-label').textContent(), /轮到你/);
  await page.reload();
  assert.equal(await page.locator('#history-count').textContent(), '2');
  await page.locator('#room-open').tap();
  await page.waitForFunction(() => document.querySelector('#room-message').textContent.includes('暂未开放'));
  assert.equal(await page.locator('#room-create').isDisabled(), true);
  await page.locator('#room-close').tap();
  await page.selectOption('#play-mode', 'local');
  await page.locator('#restart-confirm').tap();
  for (const index of [0, 89, 1, 79, 2, 69, 3, 59, 4]) { await cells.nth(index).tap(); await idle(); }
  assert.equal(await page.locator('#result-title').textContent(), '红方获胜！');
  assert.equal(await page.locator('.cell.winning').count(), 5);
  await page.locator('#result-restart').tap();
  assert.equal(await page.locator('#history-count').textContent(), '0');
  await page.selectOption('#board-mode', 'gomoku');
  await page.locator('#zoom-board').tap();
  await page.locator('#zoom-board').tap();
  assert.equal(await page.locator('#zoom-value').textContent(), '200%');
  await cells.nth(64).tap();
  await idle();
  assert.equal(await page.locator('#history-count').textContent(), '1');
  await page.locator('#zoom-reset').tap();
  assert.equal(await page.locator('#zoom-value').textContent(), '100%');
  assert.deepEqual(errors, []);
  console.log('PASS 390px static build: computer turn, reload, unavailable rooms, five-in-a-row, restart, 15x15 zoom/touch');
  await page.close();
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
