// Run after `pnpm build` from the small-games workspace (uses its existing Playwright).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { createRoomService } from './rooms.js';

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
const browser = await chromium.launch(process.env.XIANGQI_HEADED === '1' ? { channel: 'chrome', headless: false } : {});
const url = `http://127.0.0.1:${server.address().port}/`;
const zoomDevices = [{ isMobile: false, input: 'click' }, { isMobile: false, input: 'tap' }, { isMobile: true, input: 'tap' }];
async function checkZoom(page, game, input) {
  const cells = game.locator('.cell'), viewport = game.locator('#board-scroll');
  await cells.first()[input](); await cells.last()[input]();
  const width = await viewport.evaluate((element) => element.clientWidth);
  for (let i = 0; i < 4; i++) {
    await game.locator('#zoom-board')[input]();
    // Let ResizeObserver settle; checking immediately missed the 150% -> 100% regression.
    await viewport.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await game.locator('#zoom-value').textContent(), `${150 + 50 * i}%`, `${input}: zoom must survive scrollbar/ResizeObserver changes`);
    assert.equal(await viewport.evaluate((element) => element.clientWidth), width, 'scrollbar appearance must not shrink the reserved content width');
  }
  await cells.nth(Math.floor(await cells.count() / 2))[input]();
  assert.equal(await game.locator('#history-count').textContent(), '3');
  const box = await viewport.boundingBox(), y = Math.max(box.y + 20, Math.min(box.y + box.height / 2, 350));
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 60, y }, { x: box.x + 100, y }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 50, y }, { x: box.x + 110, y }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await touch.detach();
  assert.equal(await game.locator('#history-count').textContent(), '3', 'cancelled pinch must never play a move');
  await page.waitForTimeout(500);
  await cells.nth(2)[input]();
  assert.equal(await game.locator('#history-count').textContent(), '4');
  await page.setViewportSize({ width: 305, height: 740 });
  await viewport.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await game.locator('#zoom-value').textContent(), '100%', 'actual viewport resize still resets the board zoom');
  await game.locator('#zoom-board')[input]();
  const portraitSize = await viewport.evaluate((element) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ client: element.clientWidth, outer: element.offsetWidth, page: document.documentElement.clientWidth, window: innerWidth })))));
  assert.equal(await game.locator('#zoom-value').textContent(), '150%', `portrait zoom must also survive document scrollbars (${JSON.stringify(portraitSize)})`);
  await game.locator('#zoom-reset')[input]();
  assert.equal(await game.locator('#zoom-value').textContent(), '100%');
  await page.reload();
  await game.locator('.cell').first().waitFor({ state: 'visible' });
  assert.equal(await game.locator('#history-count').textContent(), '4');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}
try {
  console.log(`Browser ${browser.version()}, headed=${process.env.XIANGQI_HEADED === '1'}`);
  for (const { isMobile, input } of zoomDevices) for (const height of [390, 334]) for (const mode of ['xiangqi', 'gomoku']) {
    const page = await browser.newPage({ viewport: { width: 844, height }, hasTouch: true, isMobile, reducedMotion: 'reduce' });
    await page.goto(url);
    await page.selectOption('#play-mode', 'local'); await page.selectOption('#board-mode', mode);
    const board = await page.locator('#board').boundingBox();
    assert.ok(board.y >= 44 && board.y + board.height <= height, `${mode}/${height}: complete board must be visible without scrolling (${JSON.stringify(board)})`);
    await checkZoom(page, page, input);
    await page.close();
    console.log(`PASS landscape 844x${height} ${mode} mobile=${isMobile}/${input}: overview, stable 300%, touch cancel, rotate/reload`);
  }
  for (const mode of ['xiangqi', 'gomoku']) {
    const page = await browser.newPage({ viewport: { width: 305, height: 740 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    await page.addInitScript(() => { Math.random = () => 0; });
    await page.goto(url);
    await page.selectOption('#play-mode', 'local');
    await page.selectOption('#board-mode', mode);
    const cells = page.locator('.cell'), cols = mode === 'xiangqi' ? 9 : 15;
    await cells.nth(0).tap(); await cells.last().tap();
    const saved = await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1'));
    await page.locator('#move-button').tap();
    await cells.nth(1).tap();
    assert.equal(await page.locator('#history-count').textContent(), '2', 'move mode must never deploy on an accidental empty-square tap');
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1')), saved, 'a rejected tap must not consume a random piece');
    await cells.nth(0).tap(); await cells.nth(cols).tap();
    assert.equal(await page.locator('#history-count').textContent(), '3', 'selecting the piece then its legal target moves normally');
    await page.locator('#draw-button').tap();
    assert.match(await page.locator('#draw-button').innerText(), /已抽到「车」/, 'the pending piece must be named in the visible mobile control');
    await page.reload();
    assert.match(await page.locator('#draw-button').innerText(), /已抽到「车」/, 'pending draw survives reload with visible identity');
    await cells.nth(1).tap();
    assert.equal(await page.locator('#history-count').textContent(), '4');
    const beforeDisplay = await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1'));
    const fullscreen = page.locator('.masthead [data-game-fullscreen]');
    await fullscreen.tap();
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    assert.equal(await fullscreen.getAttribute('aria-pressed'), 'true');
    const button = await fullscreen.boundingBox();
    assert.ok(button.width >= 44 && button.height >= 44 && button.x >= 0 && button.x + button.width <= 305);
    await page.locator('#rules-open').tap();
    await page.locator('#rules-dialog [data-game-fullscreen]').tap();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.locator('#rules-close').tap();
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1')), beforeDisplay);
    await fullscreen.tap();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.fullscreenElement);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => document.querySelector('.masthead [data-game-fullscreen]').getAttribute('aria-pressed') === 'false');
    await page.setViewportSize({ width: 305, height: 568 });
    await page.locator('#zoom-board').tap();
    await cells.nth(2).tap();
    assert.equal(await page.locator('#history-count').textContent(), '5', 'touch coordinates stay correct after fullscreen and orientation changes');
    await page.locator('#zoom-reset').tap();
    // Interrupt an active pinch without relying on a browser-generated touchend.
    await page.locator('#board-scroll').evaluate((viewport) => {
      const box = viewport.getBoundingClientRect();
      viewport.dispatchEvent(Object.assign(new Event('touchstart', { cancelable: true }), { touches: [
        { clientX: box.x + 40, clientY: box.y + 40 }, { clientX: box.x + 60, clientY: box.y + 60 },
      ] }));
    });
    await page.evaluate(() => document.dispatchEvent(new Event('game-displaychange')));
    await page.waitForTimeout(500);
    await cells.nth(3).tap();
    assert.equal(await page.locator('#history-count').textContent(), '6', 'display changes must clear a cancelled pinch click lock');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.close();
    console.log(`PASS 305px ${mode}: move intention, visible draw/reload, real fullscreen/dialog exit, rotation, interrupted pinch, no overflow`);
  }
  if (process.env.XIANGQI_SHELL_REVIEW_URL) {
    for (const { isMobile, input } of zoomDevices) for (const mode of ['xiangqi', 'gomoku']) {
      const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile, reducedMotion: 'reduce' });
      // Keep the review Shell immutable; replace only this game's assets in this test context.
      await page.route('**/games/xiangqi-five/*', async (route) => {
        const file = new URL(route.request().url()).pathname.split('/').at(-1) || 'index.html';
        if (!/^[\w.-]+$/.test(file)) return route.continue();
        try { await route.fulfill({ body: await readFile(new URL(`./dist/${file}`, import.meta.url)), contentType: mime[file.split('.').at(-1)] || 'application/octet-stream' }); }
        catch { await route.continue(); }
      });
      await page.goto(process.env.XIANGQI_SHELL_REVIEW_URL);
      const frame = page.frameLocator('iframe');
      await frame.locator('.cell').first().waitFor({ state: 'visible' });
      await frame.locator('#play-mode').selectOption('local'); await frame.locator('#board-mode').selectOption(mode);
      const rect = await frame.locator('#board').boundingBox();
      assert.ok(rect.y >= 56 && rect.y + rect.height <= 390, `embedded ${mode}: all board rows visible (${JSON.stringify(rect)})`);
      await checkZoom(page, frame, input);
      await page.close();
      console.log(`PASS actual review Shell/current assets: ${mode} mobile=${isMobile}/${input}, overview, stable 300%, touch cancel, rotate/reload`);
    }
  }
  for (const failure of ['unsupported', 'rejected']) {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    await page.addInitScript((failure) => { Element.prototype.requestFullscreen = failure === 'unsupported' ? undefined : () => Promise.reject(new Error('denied')); Element.prototype.webkitRequestFullscreen = undefined; }, failure);
    await page.goto(url);
    await page.selectOption('#play-mode', 'local');
    await page.locator('.masthead [data-game-fullscreen]').tap();
    await page.waitForFunction(() => !document.querySelector('#game-display-notice').hidden);
    assert.match(await page.locator('#game-display-notice').textContent(), failure === 'unsupported' ? /不支持/ : /未允许/);
    assert.equal(await page.locator('.masthead [data-game-fullscreen]').getAttribute('aria-pressed'), 'false');
    await page.locator('.cell').first().tap();
    assert.equal(await page.locator('#history-count').textContent(), '1');
    await page.close();
    console.log(`PASS fullscreen ${failure}: accurate feedback and playable fallback (API simulation)`);
  }
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
  await cancellation.locator('#focus-toggle').click();
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
  await page.locator('#focus-toggle').tap();
  await page.selectOption('#play-mode', 'local');
  await page.locator('#restart-confirm').tap();
  for (const index of [0, 89, 1, 79, 2, 69, 3, 59, 4]) { await cells.nth(index).tap(); await idle(); }
  assert.equal(await page.locator('#result-title').textContent(), '红方获胜！');
  assert.equal(await page.locator('.cell.winning').count(), 5);
  await page.locator('#result-restart').tap();
  assert.equal(await page.locator('#history-count').textContent(), '0');
  await page.locator('#focus-toggle').tap();
  await page.selectOption('#board-mode', 'gomoku');
  await page.locator('#focus-toggle').tap();
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
  // Black's visible winning/losing result follows the same real input path, in fullscreen.
  await page.locator('#focus-toggle').tap();
  await page.locator('#new-game').tap(); await page.locator('#restart-confirm').tap();
  await page.locator('.masthead [data-game-fullscreen]').tap();
  await page.waitForFunction(() => document.fullscreenElement);
  for (const index of [224, 0, 210, 1, 194, 2, 180, 3, 164, 4]) { await cells.nth(index).tap(); await idle(); }
  assert.equal(await page.locator('#result-title').textContent(), '黑方获胜！');
  await page.locator('#result-restart').tap();
  assert.equal(await page.locator('#history-count').textContent(), '0');
  await page.locator('.masthead [data-game-fullscreen]').tap();
  console.log('PASS 15x15 fullscreen: black wins, result retry resets, exit remains available');
  await page.close();
  const handleRoom = createRoomService();
  const online = createServer(async (request, response) => { if (!await handleRoom(request, response)) server.emit('request', request, response); });
  online.listen(0, '127.0.0.1'); await once(online, 'listening');
  const onlineUrl = `http://127.0.0.1:${online.address().port}/`;
  const red = await browser.newPage({ reducedMotion: 'reduce' }), black = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await red.goto(onlineUrl); await red.selectOption('#play-mode', 'local'); await red.locator('.cell').nth(40).click();
    await red.locator('#room-open').click(); await red.locator('#room-create').click();
    await red.waitForFunction(() => !document.querySelector('#room-connected').hidden);
    const code = await red.locator('#room-code').inputValue();
    await red.locator('#room-close').click();
    await black.goto(onlineUrl); await black.locator('#room-open').click();
    await black.locator('#room-code').fill(code); await black.locator('#room-join').click();
    await black.waitForFunction(() => !document.querySelector('#room-connected').hidden);
    await black.locator('#room-close').click();
    await red.locator('.cell').first().click();
    await black.waitForFunction(() => document.querySelector('#history-count').textContent === '1');
    await black.locator('.cell').last().click();
    await red.waitForFunction(() => document.querySelector('#history-count').textContent === '2');
    await red.context().setOffline(true);
    await red.waitForFunction(() => document.querySelector('#board .cell').disabled);
    assert.match(await red.locator('#room-status').textContent(), /连接中断，正在重试同步/);
    assert.match(await red.locator('#room-message').textContent(), /连接中断，正在重试同步/);
    await red.context().setOffline(false);
    await red.waitForFunction(() => !document.querySelector('#board .cell').disabled);
    assert.match(await red.locator('#room-message').textContent(), /连接已恢复，棋局已同步/);
    await red.reload();
    await red.waitForFunction(() => document.querySelector('#history-count').textContent === '2' && !document.querySelector('#board .cell').disabled);
    await red.locator('#focus-toggle').click();
    await red.locator('#new-game').click(); await red.locator('#restart-confirm').click();
    await black.waitForFunction(() => !document.querySelector('#cancel-restart').hidden);
    await black.locator('#cancel-restart').click();
    await red.waitForFunction(() => document.querySelector('#cancel-restart').hidden);
    assert.equal(await red.locator('#history-count').textContent(), '2');
    await red.locator('#room-open').click(); await red.locator('#room-leave').click();
    assert.equal(await red.locator('#history-count').textContent(), '1');
    assert.match(await red.locator('.cell').nth(40).getAttribute('aria-label'), /红方/);
    console.log('PASS two real browser rooms: join, synchronize, offline lock/recover, refresh, cancel restart, restore local game');
  } finally {
    await red.close(); await black.close(); online.closeAllConnections(); await new Promise((resolve) => online.close(resolve));
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
