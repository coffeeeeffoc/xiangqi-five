import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { newGame, deployDirectly } from './game.js';
import { encodeGame } from './local-game.js';

const output = new URL('./docs/design/h5-ad-open-timeout-2026-10-19/', import.meta.url);
const sourceRoot = process.env.HINT_DIST_DIR || fileURLToPath(new URL('./dist/', import.meta.url));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^[\w./-]+$/.test(name) || name.split('/').includes('..')) return res.writeHead(404).end();
  try {
    const file = await readFile(path.join(sourceRoot, name));
    res.setHeader('Content-Type', { js: 'text/javascript', html: 'text/html', css: 'text/css', webp: 'image/webp', png: 'image/png', woff2: 'font/woff2' }[name.split('.').at(-1)] || 'application/octet-stream');
    res.end(file);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const base = `http://127.0.0.1:${server.address().port}/`;
const reports = [];
const position = newGame();
for (const to of [0, 9, 1, 20, 2, 32, 3, 60]) deployDirectly(position, to, () => .99);
const saved = encodeGame(position, 'computer', 'standard');
const withHost = process.env.HINT_AD_HOST_CHECK === '1';
const initialize = ({ saved, withHost, coldLoadMs = 0 }) => {
  if (!sessionStorage.keepSave) localStorage.setItem('xiangqi-five-local-v1', saved);
  window.adOffers = []; window.adInstances = []; window.adLoads = 0; window.workers = []; window.testHidden = false; window.visibilityEvents = 0;
  addEventListener('visibilitychange', () => { window.visibilityEvents++; });
  Object.defineProperty(document, 'hidden', { get: () => window.testHidden });
  const RealWorker = window.Worker;
  window.Worker = class extends RealWorker { constructor(...args) { super(...args); window.workers.push(String(args[0])); } };
  if (withHost) {
    window.tap = { createRewardedVideoAd(options) {
      window.adInstances.push(options);
      return { onClose(fn) { window.finishAd = outcome => fn({ isEnded: outcome.status === 'completed' }); },
        onError() {}, offClose() {}, offError() {}, destroy() {},
        load: async () => { window.adLoads++; if (coldLoadMs) await new Promise(resolve => setTimeout(resolve, coldLoadMs)); },
        show: async () => { window.adOffers.push(options); } };
    } };
  } else {
    window.SmallGamesPublishingConfig = { adMode: 'host' };
    window.SmallGamesRewardAds = {
      offer(opportunity) { window.adOffers.push(opportunity); return new Promise(resolve => { window.finishAd = resolve; }); },
      cancel() {},
    };
  }
};
const waitHint = page => page.waitForFunction(() => typeof window.finishAd === 'function', null, { timeout: 15000 });
try {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(initialize, { saved, withHost });
    await page.goto(base);
    if (withHost) {
      await page.waitForFunction(() => window.adLoads === 1);
      assert.equal(await page.evaluate(() => adOffers.length), 0, 'preload never opens an ad');
    }
    await page.locator('#home-continue').tap();
    await page.locator('#computer-hint').waitFor({ state: 'visible' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('#computer-hint').innerText(), '获取提示');
    const hit = await page.locator('#computer-hint').boundingBox();
    await page.screenshot({ path: new URL(`h5-ready-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    assert(hit.height >= 43.9 && hit.y + hit.height <= height, `hint reachable ${width}: ${JSON.stringify(hit)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: new URL(`h5-ready-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    await page.locator('.cell').nth(0).tap();
    await page.locator('#computer-hint').tap();
    await waitHint(page);
    if (withHost) assert.equal(await page.evaluate(() => adOffers[0].adUnitId), '1054324');
    assert.equal(await page.locator('.hint-destination').count(), 0);
    assert.equal(await page.evaluate(() => workers.length), 0, 'no analysis before ad completion');
    assert.equal(await page.locator('.cell').nth(4).isDisabled(), true);
    assert.equal(await page.locator('#draw-button').isDisabled(), true);
    await page.evaluate(() => { window.testHidden = true; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); finishAd({ status: 'dismissed' }); window.finishAd = null; });
    await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    await page.waitForFunction(() => !document.querySelector('#computer-hint').disabled);
    assert.match(await page.locator('#coach-hint').innerText(), /提示未成功生成/);
    await page.screenshot({ path: new URL(`h5-dismissed-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    assert.equal(await page.locator('.hint-destination').count(), 0);
    await page.locator('#computer-hint').tap(); await waitHint(page);
    await page.evaluate(() => { window.testHidden = true; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); finishAd({ status: 'completed' }); window.finishAd = null; });
    assert.equal(await page.evaluate(() => workers.length), 0, 'no analysis behind ad overlay');
    await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    await page.waitForFunction(() => !document.querySelector('#computer-hint').disabled);
    assert.equal(await page.locator('.hint-destination').count(), 1, await page.locator('#coach-hint').innerText());
    assert.equal(await page.locator('.hint-destination').getAttribute('aria-label'), 'E1 空位，提示落点');
    assert.match(await page.locator('#coach-hint').innerText(), /直接连五/);
    assert.equal(await page.evaluate(() => visibilityEvents), 4, 'visibility must reach Window listeners as real events do');
    await page.locator('#computer-hint').tap();
    assert.equal(await page.evaluate(() => adOffers.length), 2);
    await page.screenshot({ path: new URL(`h5-earned-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    if (width !== 320) {
      await page.locator('#draw-button').tap();
      assert.equal(await page.locator('.hint-destination').count(), 0);
      await page.locator('#computer-hint').tap();
      await page.waitForFunction(() => !document.querySelector('#computer-hint').disabled);
    assert.equal(await page.locator('.hint-destination').count(), 1, await page.locator('#coach-hint').innerText());
      assert.equal(await page.evaluate(() => adOffers.length), 2, 'same turn known draw reuses earned ad');
    }
    await page.locator('.cell').nth(4).tap();
    await page.waitForFunction(() => document.body.dataset.result === 'red');
    assert.equal(await page.locator('#computer-hint').isVisible(), false);
    await page.screenshot({ path: new URL(`h5-result-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    await page.reload(); await page.locator('#home-continue').tap();
    await page.locator('#computer-undo').tap();
    assert.equal(await page.evaluate(() => adOffers.length), 0, 'first undo is free');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi-five-local-v1')).freeUndoUsed), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi-five-local-v1')).history.length), 6);
    await page.evaluate(() => { sessionStorage.keepSave = '1'; });
    await page.reload(); await page.locator('#home-continue').tap();
    assert.equal(await page.locator('#computer-undo').innerText(), '悔棋');
    await page.locator('.cell').nth(5).tap();
    await page.waitForFunction(() => document.body.dataset.turn === 'red' && !document.querySelector('#computer-undo').disabled, { timeout: 15000 });
    const beforeUndo = await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1'));
    await page.locator('#computer-undo').tap(); await waitHint(page);
    await page.evaluate(() => { window.testHidden = true; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); finishAd({ status: 'dismissed' }); window.finishAd = null; });
    await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    await page.waitForFunction(() => !document.querySelector('#computer-undo').disabled);
    assert.equal(await page.locator('#coach-hint').innerText(), '未成功获得悔棋次数，悔棋失败');
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1')), beforeUndo);
    await page.screenshot({ path: new URL(`h5-undo-failed-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    await page.locator('#computer-undo').tap(); await waitHint(page);
    await page.evaluate(() => { window.testHidden = true; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); finishAd({ status: 'completed' }); window.finishAd = null; });
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1')), beforeUndo);
    await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#coach-hint').textContent.includes('已悔棋'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi-five-local-v1')).history.length), 6);
    await page.screenshot({ path: new URL(`h5-undo-complete-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    assert.deepEqual(errors, []);
    reports.push({ width, height, result: 'passed', checks: ['touch', 'real-worker', 'cancel-no-reward', 'complete-highlight', 'repeat-free', width === 320 ? 'preselected-piece-direct-hint-deploy' : 'draw-refresh-free', 'win', 'no-overflow', 'ad-before-analysis', 'bubbling-visibility-document-and-window', 'free-undo', 'cancel-undo-feedback', 'rewarded-undo'] });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.addInitScript(initialize, { saved, withHost });
  await page.goto(base); await page.locator('#home-continue').tap();
  await page.locator('#computer-hint').tap(); await waitHint(page);
  await page.locator('#game-more').tap();
  await page.evaluate(() => finishAd({ status: 'completed' }));
  await page.locator('#tools-close').tap();
  assert.equal(await page.locator('.hint-destination').count(), 0, 'late callback after leaving cannot unlock');
  assert.equal(await page.locator('#computer-hint').innerText(), '获取提示');
  await page.close();
  reports.push({ result: 'passed', checks: ['pause-cancels-late-reward'] });
  if (withHost) {
    const longAd = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await longAd.clock.install();
    const errors = []; longAd.on('pageerror', error => errors.push(error.message));
    await longAd.addInitScript(initialize, { saved, withHost, coldLoadMs: 12000 });
    await longAd.goto(base); await longAd.locator('#home-continue').tap();
    const started = await longAd.evaluate(() => Date.now());
    await longAd.locator('#computer-hint').tap();
    assert.equal(await longAd.locator('#computer-hint').innerText(), '准备广告…');
    assert.equal(await longAd.evaluate(() => workers.length), 0);
    await longAd.clock.fastForward(12000);
    await longAd.waitForFunction(() => adOffers.length === 1, null, { timeout: 20000 });
    const loadedMs = await longAd.evaluate(() => Date.now()) - started;
    assert.equal(await longAd.evaluate(() => adLoads), 1, 'click consumes the startup preload');
    console.log('Long-ad package check: advancing the browser clock through 10 minutes on the ad end card.');
    await longAd.evaluate(() => { window.testHidden = true; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    await longAd.clock.fastForward(600000);
    assert.equal(await longAd.locator('#computer-hint').isDisabled(), true, 'no premature timeout or reward');
    assert.equal(await longAd.locator('.hint-destination').count(), 0);
    await longAd.evaluate(() => { finishAd({ status: 'completed' }); window.finishAd = null; });
    assert.equal(await longAd.evaluate(() => workers.length), 0);
    await longAd.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); });
    await longAd.waitForFunction(() => document.querySelector('.hint-destination'));
    assert.match(await longAd.locator('#coach-hint').innerText(), /直接连五/);
    const diagnostics = await longAd.evaluate(() => JSON.parse(localStorage.getItem('xiangqi-five-ad-diagnostics')));
    assert(diagnostics.events.some(event => event.event === 'close' && event.isEnded === true));
    assert(diagnostics.events.some(event => event.event === 'shown'));
    assert(diagnostics.events.some(event => event.event === 'result' && event.status === 'completed'));
    assert(!diagnostics.events.some(event => event.event === 'timeout'));
    assert.equal(await longAd.evaluate(() => SmallGamesDev.inspect().game.ads.revision), diagnostics.revision);
    assert.deepEqual(errors, []);
    await longAd.screenshot({ path: new URL('h5-10min-ad-earned-390.png', output).pathname.replace(/^\/(\w:)/, '$1') });
    reports.push({ result: 'passed', loadedMs, virtualTotalMs: await longAd.evaluate(() => Date.now()) - started, diagnostics,
      checks: ['12s-startup-preload-browser-clock', '10min-end-card-browser-clock', 'complete-highlight-after-return', 'diagnostics-in-existing-dev-snapshot'] });
    await longAd.close();
  }
  await writeFile(new URL(withHost ? 'host-browser-validation.json' : 'browser-validation.json', output), JSON.stringify({ browser: browser.version(), sourceRoot, environment: `Windows Chromium desktop touch emulation; ${withHost ? 'real config/host adapter, simulated Tap SDK' : 'simulated ad provider'}`, reports }, null, 2) + '\n');
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await new Promise(r => server.close(r)); }
