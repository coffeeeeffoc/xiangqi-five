// Build first: node build.js && node mobile-pages-check.mjs.
// Tests actual touch navigation and game input, using an installed Playwright.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { createRoomService } from './rooms.js';

async function loadPlaywright() {
  const candidates = [
    process.env.XIANGQI_PLAYWRIGHT_MODULE,
    '@playwright/test',
    'playwright',
    '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
    '/opt/codex/runtimes/cua/lib/node_modules/playwright/index.mjs',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Install Playwright or set XIANGQI_PLAYWRIGHT_MODULE to its module path.');
}

const { chromium } = await loadPlaywright();
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (!executablePath) {
  try {
    await access('/usr/bin/chromium');
    executablePath = '/usr/bin/chromium';
  } catch {}
}
const root = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const contentTypes = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
};
const handleRoom = createRoomService();
const server = createServer(async (request, response) => {
  if (await handleRoom(request, response)) return;
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const filename = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!filename.startsWith(`${root}${sep}`)) return response.writeHead(404).end();
  try {
    const data = await readFile(filename);
    response
      .writeHead(200, {
        'Content-Type': contentTypes[filename.split('.').at(-1)] || 'application/octet-stream',
      })
      .end(data);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox'],
});
const url = `http://127.0.0.1:${server.address().port}/`;
const artifactRoot = new URL('.turbo/mobile-pages/', import.meta.url);
await mkdir(artifactRoot, { recursive: true });
const evidence = {
  checkedAt: new Date().toISOString(),
  browser: browser.version(),
  checks: [],
  screenshots: [],
};
const pageErrors = [];

async function screen(page, expected) {
  await page.waitForFunction((name) => document.body.dataset.screen === name, expected);
  const visible = await page
    .locator('[data-screen]:not(body)')
    .evaluateAll((items) =>
      items
        .filter((item) => !item.hidden && item.getClientRects().length > 0)
        .map((item) => item.dataset.screen),
    );
  assert.deepEqual(visible, [expected], 'exactly one page is visible');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'navigation never opens a modal');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    `${expected}: no horizontal page overflow`,
  );
}

async function touchTarget(page, id) {
  const box = await page.locator(`#${id}`).boundingBox();
  assert.ok(
    box && box.width >= 43.99 && box.height >= 43.99,
    `${id}: touch target is at least 44×44 (${JSON.stringify(box)})`,
  );
}

async function history(page, expected) {
  await page.waitForFunction(
    (count) =>
      document.querySelector('#history-count').textContent === String(count) &&
      document.querySelector('#board').getAttribute('aria-busy') === 'false',
    expected,
    { timeout: 12000 },
  );
}

const saved = (page) => page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1'));
const idle = (page) =>
  page.waitForFunction(
    () => document.querySelector('#board').getAttribute('aria-busy') === 'false',
  );

async function makePage(viewport, motion = 'reduce') {
  const page = await browser.newPage({
    viewport,
    hasTouch: true,
    isMobile: true,
    reducedMotion: motion,
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  return page;
}

async function startLocal(page, mode) {
  await page.goto(url);
  await screen(page, 'home');
  await touchTarget(page, 'home-start');
  await page.locator('#home-start').tap();
  await screen(page, 'modes');
  await touchTarget(page, 'mode-local');
  await page.locator('#mode-local').tap();
  await screen(page, 'setup');
  assert.equal(await page.locator('#play-mode').inputValue(), 'local');
  await page.selectOption('#board-mode', mode);
  await page.locator('#setup-start').tap();
  await screen(page, 'game');
  for (const id of ['game-back', 'game-more', 'draw-button', 'move-button'])
    await touchTarget(page, id);
}

async function screenshot(page, name) {
  const path = fileURLToPath(new URL(`${name}.png`, artifactRoot));
  await page.screenshot({ path, fullPage: true });
  evidence.screenshots.push(path);
}

try {
  console.log(`Browser ${browser.version()}, actual touch input, reduced motion and normal motion`);
  for (const [width, height] of [
    [305, 568],
    [390, 844],
    [844, 390],
  ]) {
    for (const mode of ['xiangqi', 'gomoku']) {
      const page = await makePage({ width, height });
      await startLocal(page, mode);
      const cells = page.locator('.cell'),
        cols = mode === 'xiangqi' ? 9 : 15;
      assert.equal(await cells.count(), mode === 'xiangqi' ? 90 : 225);
      const boardBox = await page.locator('#board').boundingBox();
      assert.ok(
        boardBox &&
          boardBox.x >= 0 &&
          boardBox.y >= 0 &&
          boardBox.x + boardBox.width <= width &&
          boardBox.y + boardBox.height <= height,
        `${width}×${height}/${mode}: complete board visible (${JSON.stringify(boardBox)})`,
      );
      await cells.first().tap();
      await history(page, 1);
      await cells.last().tap();
      await history(page, 2);
      const beforeMove = await saved(page);
      await page.locator('#move-button').tap();
      await cells.nth(1).tap();
      assert.equal(
        await saved(page),
        beforeMove,
        'move intention rejects an empty-square tap without consuming a piece',
      );
      await cells.first().tap();
      await cells.nth(cols).tap();
      await history(page, 3);
      assert.match(await cells.nth(cols).getAttribute('aria-label'), /红方车/);
      await page.locator('#draw-button').tap();
      assert.match(
        await page.locator('#draw-button').innerText(),
        /车/,
        'a drawn piece has visible identity',
      );
      const pending = await saved(page);
      await page.locator('#game-more').tap();
      await screen(page, 'tools');
      await page.locator('#tools-rules').tap();
      await screen(page, 'rules');
      await page.locator('#rules-close').tap();
      await screen(page, 'tools');
      await page.locator('#history-open').tap();
      await screen(page, 'history');
      assert.equal(await page.locator('#full-history > li').count(), 3);
      await page.locator('#history-close').tap();
      await screen(page, 'tools');
      await page.locator('#tools-pool').tap();
      await screen(page, 'pool');
      await page.locator('#pool-close').tap();
      await screen(page, 'tools');
      await page.locator('#tools-close').tap();
      await screen(page, 'game');
      assert.equal(
        await saved(page),
        pending,
        'rules, history and pool pages preserve the pending piece and local moves',
      );
      await page.locator('#game-back').tap();
      await screen(page, 'home');
      assert.equal(await saved(page), pending, 'returning home preserves the exact game');
      await page.reload();
      await screen(page, 'home');
      await page.locator('#home-continue').tap();
      await screen(page, 'game');
      assert.equal(
        await saved(page),
        pending,
        'reloading and resuming preserves the pending piece',
      );
      await cells.nth(1).tap();
      await history(page, 4);
      await page.locator('#game-more').tap();
      await screen(page, 'tools');
      await page.locator('#new-game').tap();
      await screen(page, 'restart');
      const beforeRestart = await saved(page);
      await page.locator('#restart-cancel').tap();
      await screen(page, 'tools');
      assert.equal(await saved(page), beforeRestart, 'canceling restart preserves exact state');
      await page.locator('#new-game').tap();
      await screen(page, 'restart');
      await page.locator('#restart-confirm').tap();
      await screen(page, 'game');
      await history(page, 0);
      await screenshot(page, `game-${mode}-${width}x${height}`);
      await page.close();
      const label = `${width}×${height} ${mode}: screen navigation, touch turns/move, pending draw, save/reload, restart`;
      evidence.checks.push(label);
      console.log(`PASS ${label}`);
    }
  }

  // A real cancelled two-finger gesture must never accidentally deploy a piece.
  const zoom = await makePage({ width: 390, height: 844 });
  await startLocal(zoom, 'xiangqi');
  const beforePinch = await saved(zoom);
  const viewport = zoom.locator('#board-scroll');
  const box = await viewport.boundingBox();
  const touch = await zoom.context().newCDPSession(zoom);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: box.x + 70, y: box.y + 90 },
      { x: box.x + 130, y: box.y + 90 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: box.x + 60, y: box.y + 90 },
      { x: box.x + 140, y: box.y + 90 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await touch.detach();
  assert.equal(
    await saved(zoom),
    beforePinch,
    'a canceled pinch consumes no piece and leaves the saved game untouched',
  );
  await zoom.waitForTimeout(500);
  await zoom.locator('.cell').first().tap();
  await history(zoom, 1);
  await zoom.close();
  evidence.checks.push(
    'real two-finger pinch cancel, no accidental deployment, touch input recovers',
  );
  console.log('PASS real two-finger pinch cancel: no accidental deployment, touch input recovers');

  // Training deep links and hints use pages, retain ordinary saved games, and solve with touch.
  const challenge = await makePage({ width: 390, height: 844 }, 'no-preference');
  await startLocal(challenge, 'xiangqi');
  await challenge.locator('.cell').first().tap();
  await history(challenge, 1);
  await challenge.locator('.cell').last().tap();
  await history(challenge, 2);
  const ordinary = await saved(challenge);
  await challenge.goto(url + '?challenge=horse-leg');
  await screen(challenge, 'game');
  await challenge.locator('.cell').nth(23).tap();
  await challenge.locator('.cell').nth(40).tap();
  await idle(challenge);
  assert.equal(
    await challenge.locator('#history-count').textContent(),
    '0',
    'blocked horse does not consume a training attempt',
  );
  await challenge.locator('#training-help-open').tap();
  await screen(challenge, 'challenge-help');
  await challenge.locator('#challenge-hint').tap();
  assert.equal(await challenge.locator('#challenge-hint-text').isVisible(), true);
  await challenge.locator('.screen[data-screen="challenge-help"] [data-back]').tap();
  await screen(challenge, 'game');
  await challenge.locator('.cell').nth(21).tap();
  await challenge.locator('.cell').nth(40).tap();
  await screen(challenge, 'result');
  assert.equal(await challenge.locator('#result-title').textContent(), '一手成五！');
  assert.equal(await saved(challenge), ordinary, 'training does not overwrite the ordinary game');
  assert.equal(
    await challenge.evaluate(
      () =>
        JSON.parse(localStorage.getItem('xiangqi-five-challenges-v1')).progress['horse-leg'].stars,
    ),
    1,
  );
  await screenshot(challenge, 'challenge-result-390x844');
  await challenge.locator('#result-board').tap();
  await screen(challenge, 'game');
  await challenge.locator('#game-more').tap();
  await screen(challenge, 'tools');
  await challenge.locator('#challenge-exit').tap();
  await screen(challenge, 'game');
  await history(challenge, 2);
  assert.equal(await saved(challenge), ordinary, 'leaving training restores the ordinary game');
  await challenge.close();
  evidence.checks.push(
    'training deep link, illegal horse, hint page, real solve/result, ordinary save isolation',
  );
  console.log(
    'PASS training: deep link, illegal horse, hint page, real solve/result, ordinary save isolation',
  );

  for (const [mode, cols, count] of [
    ['xiangqi', 9, 90],
    ['gomoku', 15, 225],
  ]) {
    const page = await makePage({ width: 390, height: 844 }, 'no-preference');
    await startLocal(page, mode);
    const cells = page.locator('.cell');
    const activeIndex = () => cells.evaluateAll((items) => items.indexOf(document.activeElement));
    assert.equal(
      await cells.evaluateAll((items) => items.filter((item) => item.tabIndex === 0).length),
      1,
    );
    await cells.nth(cols + 2).focus();
    await page.keyboard.press('Home');
    assert.equal(await activeIndex(), cols);
    await page.keyboard.press('End');
    assert.equal(await activeIndex(), cols * 2 - 1);
    await page.keyboard.press('ArrowRight');
    assert.equal(await activeIndex(), cols * 2 - 1);
    await page.keyboard.press('Control+End');
    assert.equal(await activeIndex(), count - 1);
    await page.keyboard.press('Control+Home');
    assert.equal(await activeIndex(), 0);
    await page.keyboard.press('Enter');
    await history(page, 1);
    assert.equal(await activeIndex(), 0, 'normal-motion placement restores board focus');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await history(page, 2);
    assert.equal(await activeIndex(), 1);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    assert.equal(await cells.first().getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#history-count').textContent(), '2');
    await page.close();
    evidence.checks.push(
      `${mode}: board single Tab stop, edge/Home/End navigation, consecutive keyboard turns, Escape selection cancel`,
    );
    console.log(
      `PASS ${mode}: single Tab stop, edge/Home/End navigation, consecutive keyboard turns, Escape cancel`,
    );
  }

  const computer = await makePage({ width: 390, height: 844 });
  await computer.goto(url);
  await computer.locator('#home-start').tap();
  await computer.locator('#mode-computer').tap();
  await screen(computer, 'setup');
  await computer.selectOption('#difficulty', 'standard');
  await computer.locator('#setup-start').tap();
  await screen(computer, 'game');
  await computer.locator('.cell').nth(40).tap();
  await computer.locator('#game-more').tap();
  await screen(computer, 'tools');
  await computer.locator('#tools-rules').tap();
  await screen(computer, 'rules');
  await computer.locator('#rules-close').focus();
  await history(computer, 2);
  await screen(computer, 'rules');
  assert.equal(
    await computer.evaluate(() => document.activeElement.id),
    'rules-close',
    'worker completion respects focus on the current page',
  );
  await computer.locator('#rules-close').tap();
  await computer.locator('#tools-close').tap();
  await screen(computer, 'game');
  const state = await computer.evaluate(() =>
    JSON.parse(localStorage.getItem('xiangqi-five-local-v1')),
  );
  const to = state.history[1].to;
  assert.ok(
    to % 9 !== 4 && Math.floor(to / 9) !== 4,
    'real worker avoids deploying on the rook file/rank',
  );
  assert.equal(state.difficulty, 'standard');
  await computer.close();
  evidence.checks.push(
    'real computer Worker completes safely while reading rules; navigation/focus stays on rules',
  );
  console.log(
    'PASS computer Worker: real response, difficulty saved, rules navigation and focus retained',
  );

  const navigation = await makePage({ width: 305, height: 568 });
  await navigation.goto(url);
  await screen(navigation, 'home');
  await screenshot(navigation, 'home-305x568');
  await navigation.locator('#rules-open').tap();
  await screen(navigation, 'rules');
  await navigation.locator('#pieces-open').tap();
  await screen(navigation, 'pieces');
  assert.equal(await navigation.locator('#piece-guide > *').count(), 7);
  assert.equal(
    await navigation.locator('.screen[data-screen="pieces"] details').getAttribute('open'),
    null,
    'fine rules stay collapsed',
  );
  await navigation.locator('#pieces-close').tap();
  await screen(navigation, 'rules');
  await navigation.locator('#rules-close').tap();
  await screen(navigation, 'home');
  await navigation.locator('#home-start').tap();
  await screen(navigation, 'modes');
  await navigation.locator('#challenge-open').tap();
  await screen(navigation, 'challenges');
  assert.equal(await navigation.locator('.challenge-card').count(), 8);
  await screenshot(navigation, 'challenges-305x568');
  await navigation.locator('#challenge-close').tap();
  await screen(navigation, 'modes');
  await navigation.locator('#room-open').tap();
  await screen(navigation, 'room');
  await navigation.locator('#room-close').tap();
  await screen(navigation, 'modes');
  await navigation.close();
  evidence.checks.push(
    'small phone: home lessons, all seven piece guides, collapsed details, all eight challenges, room entry and page return',
  );
  console.log(
    'PASS all page entries: lessons/pieces/challenges/room, collapsed details and correct return',
  );

  const switching = await makePage({ width: 390, height: 844 });
  await startLocal(switching, 'xiangqi');
  await switching.locator('.cell').first().tap();
  await history(switching, 1);
  await switching.locator('.cell').last().tap();
  await history(switching, 2);
  const beforeSwitch = await saved(switching);
  await switching.locator('#game-more').tap();
  await switching.locator('#tools-settings').tap();
  await screen(switching, 'setup');
  await switching.selectOption('#board-mode', 'gomoku');
  assert.equal(
    await saved(switching),
    beforeSwitch,
    'selecting a new board does not immediately reset the game',
  );
  await switching.locator('#setup-start').tap();
  await screen(switching, 'restart');
  await switching.locator('#restart-cancel').tap();
  await screen(switching, 'setup');
  assert.equal(
    await saved(switching),
    beforeSwitch,
    'canceling a board change retains exact moves',
  );
  await switching.locator('#setup-start').tap();
  await screen(switching, 'restart');
  await switching.locator('#restart-confirm').tap();
  await screen(switching, 'game');
  await history(switching, 0);
  assert.equal(
    await switching.locator('.cell').count(),
    225,
    'confirmed switch starts the selected board',
  );
  await switching.close();
  evidence.checks.push(
    'board change: draft preserves moves, dedicated confirmation page, cancel preserves state, confirm changes board',
  );
  console.log(
    'PASS board change: draft/confirmation/cancel preserve moves, confirm starts selected board',
  );

  const roomPages = await Promise.all([0, 1].map(() => makePage({ width: 390, height: 844 })));
  const [host, guest] = roomPages;
  await startLocal(host, 'xiangqi');
  await host.locator('.cell').first().tap();
  await history(host, 1);
  await host.locator('.cell').last().tap();
  await history(host, 2);
  const localBeforeRoom = await saved(host);
  await host.locator('#game-back').tap();
  await host.locator('#home-start').tap();
  await host.locator('#room-open').tap();
  await screen(host, 'room');
  await host.locator('#room-create').tap();
  await host.locator('#room-connected').waitFor({ state: 'visible' });
  const invitation = await host.locator('#room-invite').inputValue();
  const invitationFields = new URLSearchParams(new URL(invitation).hash.slice(1));
  assert.match(invitationFields.get('room'), /^[A-F0-9]{8}$/);
  assert.equal(
    invitationFields.has('token'),
    false,
    'room invitations never expose the player credential',
  );
  await guest.goto(invitation);
  await screen(guest, 'room');
  await guest.locator('#room-join').tap();
  await guest.locator('#room-connected').waitFor({ state: 'visible' });
  for (const page of roomPages) {
    await page.locator('#room-play').tap();
    await screen(page, 'game');
  }
  await host.locator('.cell').first().tap();
  await history(host, 1);
  await history(guest, 1);
  await guest.locator('.cell').last().tap();
  await history(guest, 2);
  await history(host, 2);
  assert.equal(
    await saved(host),
    localBeforeRoom,
    'real room moves never overwrite the ordinary local save',
  );
  await host.locator('#game-more').tap();
  await host.locator('#tools-room').tap();
  await screen(host, 'room');
  await host.locator('#room-leave').tap();
  await screen(host, 'game');
  await history(host, 2);
  assert.equal(
    await saved(host),
    localBeforeRoom,
    'leaving the room restores the exact local game',
  );
  for (const page of roomPages) await page.close();
  evidence.checks.push(
    'real room: create/invite/join pages, two independent touch turns and sync, leave restores local game',
  );
  console.log(
    'PASS real room: create/invite/join, two independent touch turns and sync, local save restored',
  );

  // A remote restart can arrive while this client has returned to the old result page.
  const restartPages = await Promise.all([0, 1].map(() => makePage({ width: 390, height: 844 })));
  const [restartHost, restartGuest] = restartPages;
  await startLocal(restartHost, 'xiangqi');
  await restartHost.locator('#game-back').tap();
  await restartHost.locator('#home-start').tap();
  await restartHost.locator('#room-open').tap();
  await screen(restartHost, 'room');
  await restartHost.locator('#room-create').tap();
  await restartHost.locator('#room-connected').waitFor({ state: 'visible' });
  await restartGuest.goto(await restartHost.locator('#room-invite').inputValue());
  await screen(restartGuest, 'room');
  await restartGuest.locator('#room-join').tap();
  await restartGuest.locator('#room-connected').waitFor({ state: 'visible' });
  for (const page of restartPages) {
    await page.locator('#room-play').tap();
    await screen(page, 'game');
  }
  for (const [ply, index] of [0, 89, 1, 88, 2, 87, 3, 86, 4].entries()) {
    await restartPages[ply % 2].locator('.cell').nth(index).tap();
    for (const page of restartPages) await history(page, ply + 1);
  }
  for (const page of restartPages) {
    await screen(page, 'result');
    assert.equal(await page.locator('#result-title').textContent(), '红方获胜！');
  }
  await restartHost.locator('#result-restart').tap();
  await screen(restartHost, 'game');
  for (const page of restartPages) {
    await page.waitForFunction(() =>
      document.querySelector('#room-status').textContent.includes('申请重开'),
    );
  }
  await restartHost.goBack();
  await screen(restartHost, 'result');
  assert.equal(await restartHost.locator('#result-banner').isVisible(), true);
  await restartGuest.locator('#result-restart').tap();
  for (const page of restartPages) {
    await history(page, 0);
    await screen(page, 'game');
    assert.equal(
      await page.locator('#board').isVisible(),
      true,
      'the new round has a visible board',
    );
    assert.equal(await page.locator('#result-banner').isVisible(), false);
    assert.equal(
      await page.locator('.cell .piece').count(),
      0,
      'both clients received the fresh board',
    );
  }
  await restartHost.locator('.cell').nth(40).tap();
  for (const page of restartPages) await history(page, 1);
  for (const page of restartPages) await page.close();
  evidence.checks.push(
    'real room: remote restart replaces an old result page with the fresh playable board',
  );
  console.log(
    'PASS asynchronous room restart: Back to result, remote agreement, fresh board and next touch turn',
  );

  const dev = await makePage({ width: 390, height: 844 });
  await dev.goto(url + '?dev=1');
  await screen(dev, 'home');
  assert.equal(await dev.evaluate(() => window.SmallGamesDev?.isEnabled()), true);
  assert.equal(await dev.locator('small-games-devtools').count(), 1);
  await dev.goto(url + '?dev=0');
  await screen(dev, 'home');
  assert.equal(await dev.evaluate(() => window.SmallGamesDev?.isEnabled()), false);
  assert.equal(
    await dev.locator('small-games-devtools').count(),
    0,
    'developer tools stay hidden when disabled',
  );
  await dev.close();
  evidence.checks.push(
    'shared developer mode: explicit opt-in works, explicit opt-out hides its entry',
  );
  console.log('PASS shared developer mode: explicit opt-in and opt-out preserved');
  // Browser history entries survive reload; revisiting setup initializes a new draft.
  const backAfterReload = await makePage({ width: 390, height: 844 });
  await startLocal(backAfterReload, 'xiangqi');
  await backAfterReload.locator('.cell').first().tap();
  await history(backAfterReload, 1);
  const beforeHistory = await saved(backAfterReload);
  await backAfterReload.reload();
  await screen(backAfterReload, 'home');
  await backAfterReload.goBack();
  await screen(backAfterReload, 'setup');
  await backAfterReload.selectOption('#board-mode', 'xiangqi');
  await backAfterReload.locator('#setup-start').tap();
  await screen(backAfterReload, 'game');
  assert.equal(await saved(backAfterReload), beforeHistory);
  await backAfterReload.close();
  evidence.checks.push(
    'browser Back after reload restores an editable setup draft and preserves the saved game',
  );
  console.log('PASS browser Back after reload: valid setup and exact game preservation');

  // Failed result sharing reveals a real, focusable copy field on its own page.
  const shareFallback = await makePage({ width: 390, height: 844 });
  await shareFallback.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Clipboard unavailable');
        },
      },
      configurable: true,
    });
  });
  await shareFallback.goto(url + '?challenge=rook-bridge');
  await screen(shareFallback, 'game');
  await shareFallback.locator('.cell').nth(14).tap();
  await shareFallback.locator('.cell').nth(41).tap();
  await screen(shareFallback, 'result');
  await shareFallback.locator('#challenge-result-share').tap();
  await screen(shareFallback, 'challenge-help');
  assert.equal(await shareFallback.locator('#challenge-share-link').isVisible(), true);
  assert.equal(
    await shareFallback.evaluate(() => document.activeElement.id),
    'challenge-share-link',
  );
  assert.equal(
    new URL(await shareFallback.locator('#challenge-share-link').inputValue()).searchParams.get(
      'challenge',
    ),
    'rook-bridge',
  );
  await shareFallback.locator('.screen[data-screen="challenge-help"] [data-back]').tap();
  await screen(shareFallback, 'result');
  await shareFallback.close();
  evidence.checks.push(
    'result sharing without clipboard opens a visible manual-copy page and returns to the result',
  );
  console.log('PASS result share fallback: visible copy field, focus, exact same-puzzle link');

  assert.deepEqual(pageErrors, [], 'no uncaught browser errors');
  await writeFile(new URL('checks.json', artifactRoot), JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidence.checks.length} browser scenarios, no uncaught browser errors`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}
