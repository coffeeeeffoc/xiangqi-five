// Portable browser checks: npm install --no-save --package-lock=false playwright
// npx playwright install chromium && node build.js && node pavilion-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from 'playwright';
import { newGame, draw, deploy } from './game.js';
import { SAVE_KEY, encodeGame, decodeGame } from './local-game.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const artifactRoot = resolve(root, 'artifacts/pavilion');
const mime = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', png: 'image/png', svg: 'image/svg+xml',
  webp: 'image/webp', woff2: 'font/woff2',
};

// Run the built output in a child process, without a machine-specific server dependency.
if (process.argv.includes('--serve')) {
  const dist = resolve(root, 'dist');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filename = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filename.startsWith(dist + sep)) return response.writeHead(404).end();
      const data = await readFile(filename);
      response.writeHead(200, {
        'Content-Type': mime[filename.split('.').at(-1)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      }).end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1', () => {
    console.log(JSON.stringify({ port: server.address().port }));
  });
  process.on('SIGTERM', () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
} else {
  await main();
}

async function main() {
  await mkdir(artifactRoot, { recursive: true });
  const evidence = {
    checkedAt: new Date().toISOString(),
    safeAreaSimulation: 'CSS env() replacement: top 20px, bottom 24px; not a physical-device claim.',
    checks: [], layouts: [], screenshots: [], failures: [],
  };
  const server = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  let serverLog = '';
  server.stderr.on('data', (chunk) => { serverLog += chunk; });
  try {
    const url = await new Promise((resolveReady, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Static server did not start: ' + serverLog)), 15000);
      const fail = (error) => { clearTimeout(timer); reject(error); };
      server.once('error', fail);
      server.once('exit', (code) => fail(new Error('Static server exited early: ' + code)));
      server.stdout.on('data', (chunk) => {
        output += chunk;
        const line = output.split('\n').find((entry) => entry.startsWith('{"port":'));
        if (line) {
          clearTimeout(timer);
          resolveReady('http://127.0.0.1:' + JSON.parse(line).port + '/');
        }
      });
    });
    const response = await fetch(url);
    assert.equal(response.status, 200, 'built site must be available before the browser starts');
    browser = await playwright.chromium.launch({
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      args: ['--no-sandbox'],
    });
    evidence.browser = browser.version();

    async function screenshot(page, name, fullPage = false) {
      const filename = name.replace(/[^a-zA-Z0-9_-]/g, '-') + '.png';
      await page.screenshot({
        path: resolve(artifactRoot, filename), fullPage, animations: 'disabled',
      });
      evidence.screenshots.push(filename);
    }

    async function runCase(name, viewport, task, safeArea = false) {
      const errors = [];
      const page = await browser.newPage({
        viewport, hasTouch: true, isMobile: viewport.width < 760, reducedMotion: 'reduce',
      });
      page.setDefaultTimeout(12000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => { Math.random = () => 0; });
      if (safeArea) {
        const css = await readFile(resolve(root, 'dist/style.css'), 'utf8');
        let substitutions = 0;
        const replaced = css.replace(
          /env\(\s*safe-area-inset-(top|right|bottom|left)(?:\s*,[^)]*)?\)/g,
          (_, edge) => {
            substitutions++;
            return ({ top: '20px', bottom: '24px', left: '0px', right: '0px' })[edge];
          },
        );
        assert.ok(substitutions > 0, 'safe-area simulation must replace real CSS env declarations');
        await page.route('**/style.css', (route) => route.fulfill({
          body: replaced, contentType: 'text/css; charset=utf-8',
        }));
      }
      try {
        await page.goto(url);
        await task(page, name, safeArea);
        assert.deepEqual(errors, [], name + ': no uncaught browser errors');
        evidence.checks.push(name);
        console.log('PASS ' + name);
      } catch (error) {
        evidence.failures.push({ name, message: error.stack || String(error), pageErrors: errors });
        console.error('FAIL ' + name + ': ' + error.message);
        await screenshot(page, 'FAIL-' + name, true).catch(() => {});
      } finally {
        await page.close();
      }
    }

    async function screen(page, name) {
      await page.waitForFunction((expected) => document.body.dataset.screen === expected, name);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      });
      const visible = await page.locator('.screen[data-screen]').evaluateAll((items) =>
        items.filter((item) => !item.hidden && item.getClientRects().length)
          .map((item) => item.dataset.screen),
      );
      assert.deepEqual(visible, [name], 'exactly one screen is visible');
      assert.equal(await page.locator('dialog[open]').count(), 0);
    }

    async function fits(page, label, selectors, safeArea = false) {
      const limits = { top: safeArea ? 20 : 0, bottom: safeArea ? 24 : 0 };
      const layout = await page.evaluate(({ selectors, limits }) => {
        const active = document.querySelector('.screen:not([hidden])');
        const boxes = selectors.map((selector) => {
          const element = document.querySelector(selector);
          if (!element || !element.getClientRects().length)
            return { selector, missing: true };
          const rect = element.getBoundingClientRect();
          return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            bottom: rect.bottom, right: rect.right };
        });
        const controls = [...active.querySelectorAll(
          '.primary-button, .mint-button, .icon-button, .board-choices button, .difficulty-choices button',
        )].filter((element) => element.getClientRects().length &&
          getComputedStyle(element).visibility !== 'hidden').map((element) => {
          const rect = element.getBoundingClientRect();
          return { id: element.id, className: element.className,
            label: element.getAttribute('aria-label') || element.textContent.trim(),
            width: rect.width, height: rect.height };
        });
        const scrolling = [document.documentElement, document.body, active, ...active.querySelectorAll('*')]
          .filter((element) => {
            if (!element.getClientRects().length) return false;
            const style = getComputedStyle(element);
            return /auto|scroll|hidden|clip/.test(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 2;
          }).map((element) => ({
            tag: element.tagName, id: element.id, className: String(element.className),
            client: element.clientHeight, scroll: element.scrollHeight,
          }));
        return {
          width: innerWidth, height: innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          scrollY, boxes, controls, scrolling, limits,
        };
      }, { selectors, limits });
      evidence.layouts.push({ label, ...layout });
      assert.ok(layout.documentWidth <= layout.width + 1, label + ': no horizontal page overflow');
      assert.ok(layout.documentHeight <= layout.height + 1,
        label + ': no page scrolling needed: ' + JSON.stringify(layout));
      assert.equal(layout.scrollY, 0, label + ': page starts without scrolling');
      assert.deepEqual(layout.scrolling, [], label + ': no nested scrolling or clipped content');
      for (const control of layout.controls) {
        assert.ok(control.width >= 43.99 && control.height >= 43.99,
          label + ': visible control is at least 44×44: ' + JSON.stringify(control));
      }
      for (const box of layout.boxes) {
        assert.ok(!box.missing && box.y >= limits.top - 1 && box.bottom <= layout.height - limits.bottom + 1 &&
          box.x >= -1 && box.right <= layout.width + 1,
        label + ': complete control/content visible: ' + JSON.stringify(box));
      }
    }

    async function history(page, count) {
      await page.waitForFunction((expected) =>
        document.querySelector('#history-count').textContent === String(expected) &&
        document.querySelector('#board').getAttribute('aria-busy') === 'false',
      count);
    }

    async function startLocal(page, mode = 'xiangqi') {
      await screen(page, 'home');
      await page.locator('#home-start').tap();
      await page.locator('#mode-local').tap();
      await screen(page, 'setup');
      await page.locator('[data-board="' + mode + '"]').tap();
      await page.locator('#setup-start').tap();
      await screen(page, 'game');
    }

    const viewports = [
      [305, 568], [375, 650], [375, 651], [390, 700],
      [390, 701], [390, 740], [390, 780], [390, 844],
    ];
    const variants = [
      ...viewports.map(([width, height]) => ({ width, height, safeArea: false })),
      { width: 375, height: 650, safeArea: true },
      { width: 390, height: 844, safeArea: true },
    ];

    for (const { width, height, safeArea } of variants) {
      const name = 'pages-' + width + 'x' + height + (safeArea ? '-safe-area' : '');
      await runCase(name, { width, height }, async (page) => {
        await screen(page, 'home');
        await fits(page, name + '-home', ['#home-title', '#home-start', '#home-settings', '.home-note'], safeArea);
        await screenshot(page, name + '-home');
        await page.locator('#home-start').tap();
        await screen(page, 'modes');
        await fits(page, name + '-modes', ['#mode-computer', '#mode-local', '#challenge-open', '.bottom-note'], safeArea);
        await screenshot(page, name + '-modes');
        // The embedded Shell reveals this existing button. Simulate only that visibility
        // signal; app.js's real MutationObserver moves the legacy room into "More modes".
        await page.locator('#mode-online').evaluate((button) => { button.hidden = false; });
        await page.waitForFunction(() =>
          !document.querySelector('#mode-extras').hidden &&
          document.querySelector('#room-open').parentElement.id === 'mode-extras');
        await screen(page, 'modes');
        assert.equal(await page.locator('#mode-extras').evaluate((details) => details.open), false);
        await fits(page, name + '-modes-online-entry-simulated',
          ['#mode-computer', '#mode-local', '#mode-online', '#challenge-open',
            '#mode-extras summary', '.bottom-note'], safeArea);
        await screenshot(page, name + '-modes-online-entry');
        if ((width === 305 && height === 568) || (width === 390 && height === 844)) {
          await page.locator('#mode-extras summary').tap();
          if (height === 844) {
            await fits(page, name + '-modes-online-expanded',
              ['#mode-online', '#room-open', '.bottom-note'], safeArea);
          } else {
            for (const selector of ['#room-open', '.bottom-note']) {
              const target = page.locator(selector);
              await target.scrollIntoViewIfNeeded();
              const layout = await target.evaluate((element) => {
                const blocked = [];
                for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                  if (/hidden|clip/.test(getComputedStyle(parent).overflowY) &&
                      parent.scrollHeight > parent.clientHeight + 2)
                    blocked.push(parent.id || parent.className || parent.tagName);
                }
                const rect = element.getBoundingClientRect();
                return { blocked, top: rect.top, bottom: rect.bottom, height: innerHeight };
              });
              evidence.layouts.push({ label: name + '-modes-online-expanded-' + selector, ...layout });
              assert.deepEqual(layout.blocked, [], 'expanded modes content must not be clipped');
              assert.ok(layout.top >= -1 && layout.bottom <= layout.height + 1,
                'expanded modes final control is reachable: ' + selector + JSON.stringify(layout));
            }
          }
          await screenshot(page, name + '-modes-online-entry-expanded', true);
          await page.locator('#mode-extras summary').tap();
          await page.evaluate(() => window.scrollTo(0, 0));
        }

        for (const opponent of ['computer', 'local']) {
          await page.locator('#mode-' + opponent).tap();
          await screen(page, 'setup');
          if (opponent === 'computer') await page.locator('[data-difficulty="hard"]').tap();
          assert.ok((await page.locator('#save-status').textContent()).trim());
          const explanation = await page.locator('.draw-method-note').innerText();
          assert.match(explanation, /抽/);
          assert.match(explanation, /直接/);
          assert.match(explanation, /后|才/);
          await fits(page, name + '-setup-' + opponent,
            ['#setup-title', '#board-mode', '.draw-method-note', '#save-status', '#setup-start',
              ...(opponent === 'computer' ? ['#difficulty', '#difficulty-hint'] : [])], safeArea);
          await screenshot(page, name + '-setup-' + opponent);
          if (opponent === 'computer') {
            await page.locator('.setup-screen [data-back]').tap();
            await screen(page, 'modes');
          }
        }
        await page.locator('#setup-start').tap();
        await screen(page, 'game');
        await fits(page, name + '-game-xiangqi',
          ['#board', '#draw-button', '#move-button', '#action-hint'], safeArea);
        await screenshot(page, name + '-game-xiangqi');

        // A saved game adds a home action and a longer save-status line after reload.
        await page.locator('.cell').first().tap();
        await history(page, 1);
        await page.reload();
        await screen(page, 'home');
        await fits(page, name + '-home-saved',
          ['#home-start', '#home-continue', '#home-settings', '.home-note'], safeArea);
        await page.locator('#home-settings').tap();
        await screen(page, 'setup');
        assert.match(await page.locator('#save-status').textContent(), /恢复/);
        await fits(page, name + '-setup-saved',
          ['.draw-method-note', '#save-status', '#setup-start'], safeArea);
        await page.locator('[data-board="gomoku"]').tap();
        await page.locator('#setup-start').tap();
        await screen(page, 'restart');
        await fits(page, name + '-restart', ['#restart-confirm', '#restart-keep'], safeArea);
        await page.locator('#restart-confirm').tap();
        await screen(page, 'game');
        await fits(page, name + '-game-gomoku',
          ['#board', '#draw-button', '#move-button', '#action-hint'], safeArea);
        await screenshot(page, name + '-game-gomoku');
        await page.locator('#game-more').tap();
        await screen(page, 'tools');
        await fits(page, name + '-tools', ['#new-game', '#zoom-value', '[data-game-fullscreen]'], safeArea);
        await screenshot(page, name + '-tools');
      }, safeArea);
    }

    await runCase('landscape-844x390', { width: 844, height: 390 }, async (page, name) => {
      for (const mode of ['xiangqi', 'gomoku']) {
        if (mode === 'gomoku') {
          await page.evaluate(() => localStorage.clear());
          await page.goto(url);
        }
        await screen(page, 'home');
        await fits(page, name + '-home-' + mode,
          ['#home-title', '#home-start', '#home-settings', '#rules-open', '#challenge-quick-start']);
        await screenshot(page, name + '-home-' + mode);
        await startLocal(page, mode);
        await fits(page, name + '-game-' + mode,
          ['#board', '#draw-button', '#move-button', '#action-hint']);
        await screenshot(page, name + '-game-' + mode);
        await page.locator('.cell').first().tap();
        await history(page, 1);
        await page.reload();
        await screen(page, 'home');
        await fits(page, name + '-home-saved-' + mode,
          ['#home-start', '#home-continue', '#home-settings', '#rules-open', '#challenge-quick-start']);
        await screenshot(page, name + '-home-saved-' + mode);
        await page.locator('#home-continue').tap();
        await screen(page, 'game');
        await page.locator('#game-more').tap();
        await screen(page, 'tools');
        // The landscape tools list may scroll; its last action must remain reachable.
        const lastAction = page.locator('[data-game-fullscreen]');
        await lastAction.scrollIntoViewIfNeeded();
        const layout = await lastAction.evaluate((element) => {
          const blocked = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (/hidden|clip/.test(getComputedStyle(parent).overflowY) &&
                parent.scrollHeight > parent.clientHeight + 2)
              blocked.push(parent.id || parent.className || parent.tagName);
          }
          const rect = element.getBoundingClientRect();
          return { blocked, top: rect.top, bottom: rect.bottom, left: rect.left,
            right: rect.right, width: rect.width, height: rect.height,
            viewportWidth: innerWidth, viewportHeight: innerHeight };
        });
        evidence.layouts.push({ label: name + '-tools-' + mode, ...layout });
        assert.deepEqual(layout.blocked, [], 'landscape tools must not clip the final action');
        assert.ok(layout.top >= -1 && layout.bottom <= layout.viewportHeight + 1 &&
          layout.left >= -1 && layout.right <= layout.viewportWidth + 1,
          'landscape tools final action is reachable: ' + JSON.stringify(layout));
        assert.ok(layout.width >= 43.99 && layout.height >= 43.99,
          'landscape final action retains its touch target');
        await screenshot(page, name + '-tools-' + mode, true);
      }
    });

    await runCase('desktop-1280x800', { width: 1280, height: 800 }, async (page, name) => {
      await screen(page, 'home');
      await fits(page, name + '-home',
        ['#home-title', '#home-start', '#home-settings', '.home-note']);
      await screenshot(page, name + '-home');
      await page.locator('#home-start').tap();
      await screen(page, 'modes');
      await fits(page, name + '-modes',
        ['#mode-computer', '#mode-local', '#challenge-open', '.bottom-note']);
      await screenshot(page, name + '-modes');
      for (const opponent of ['computer', 'local']) {
        await page.locator('#mode-' + opponent).tap();
        await screen(page, 'setup');
        await fits(page, name + '-setup-' + opponent,
          ['#board-mode', '.draw-method-note', '#save-status', '#setup-start',
            ...(opponent === 'computer' ? ['#difficulty', '#difficulty-hint'] : [])]);
        await screenshot(page, name + '-setup-' + opponent);
        if (opponent === 'computer') {
          await page.locator('.setup-screen [data-back]').tap();
          await screen(page, 'modes');
        }
      }
      await page.locator('#setup-start').tap();
      await screen(page, 'game');
      await fits(page, name + '-game',
        ['#board', '#draw-button', '#move-button', '#action-hint']);
      await screenshot(page, name + '-game');
      await page.locator('.cell').first().tap();
      await history(page, 1);
      await page.locator('#game-back').tap();
      await screen(page, 'home');
      await fits(page, name + '-home-saved',
        ['#home-start', '#home-continue', '#home-settings', '.home-note']);
      await screenshot(page, name + '-home-saved');
    });

    await runCase('unavailable-storage-message', { width: 305, height: 568 }, async (page, name) => {
      await page.addInitScript(() => {
        Object.defineProperty(Storage.prototype, 'getItem', {
          value() { throw new DOMException('Storage disabled for this check', 'SecurityError'); },
        });
      });
      await page.reload();
      await screen(page, 'home');
      await page.locator('#home-start').tap();
      await page.locator('#mode-computer').tap();
      await screen(page, 'setup');
      assert.match(await page.locator('#save-status').innerText(), /未允许|不能保存/);
      await fits(page, name, ['#save-status', '#setup-start', '.draw-method-note']);
      await screenshot(page, name);
    });

    for (const mode of ['xiangqi', 'gomoku']) {
      await runCase('draw-and-reload-' + mode, { width: 305, height: 568 }, async (page, name) => {
        await startLocal(page, mode);
        const saved = () => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
        const cells = page.locator('.cell');
        const before = decodeGame(await saved()).state;
        const drawNote = page.locator('#draw-button .draw-button-note');
        assert.ok(await drawNote.isVisible(), 'draw button explains the before-placement reveal');
        assert.ok((await drawNote.innerText()).trim());
        assert.match(await page.locator('#action-hint').innerText(), /直接/);
        assert.match(await page.locator('#action-hint').innerText(), /后|才/);
        await page.locator('#draw-button').tap();
        const pendingSave = await saved();
        const pending = decodeGame(pendingSave).state;
        assert.equal(pending.pending.type, 'rook');
        assert.deepEqual(pending.board, before.board, 'drawing reveals without placing');
        assert.equal(pending.ply, 0);
        assert.match(await page.locator('#draw-button').innerText(), /车/);
        assert.match(await page.locator('#draw-button').getAttribute('aria-label'), /车/);
        await fits(page, name + '-pending', ['#board', '#draw-button', '#move-button', '#action-hint']);
        await screenshot(page, name + '-pending');
        await page.reload();
        await screen(page, 'home');
        await page.locator('#home-continue').tap();
        await screen(page, 'game');
        assert.equal(await saved(), pendingSave, 'refresh preserves the exact pending piece');
        assert.match(await page.locator('#draw-button').innerText(), /车/);
        await cells.first().tap();
        await history(page, 1);
        const placed = decodeGame(await saved()).state;
        assert.equal(placed.pending, null);
        assert.deepEqual(placed.board[0], { type: 'rook', side: 'red' });
        assert.equal(placed.ply, 1);
        assert.equal(placed.turn, 'black');
        // Direct placement uses a separate turn with no preceding draw control click.
        await cells.last().tap();
        await history(page, 2);
        const direct = decodeGame(await saved()).state;
        assert.equal(direct.pending, null);
        assert.deepEqual(direct.board.at(-1), { type: 'rook', side: 'black' });
        assert.match(await cells.last().getAttribute('aria-label'), /黑方车/);
        assert.equal(direct.pools.black.length, 15);
        await screenshot(page, name + '-placed');
      });
    }

    await runCase('long-content-remains-scrollable', { width: 305, height: 568 }, async (page, name) => {
      async function reachable(selector, label) {
        const target = page.locator(selector);
        await target.scrollIntoViewIfNeeded();
        const result = await target.evaluate((element) => {
          const blocked = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (/hidden|clip/.test(getComputedStyle(parent).overflowY) &&
                parent.scrollHeight > parent.clientHeight + 2) blocked.push(parent.className || parent.tagName);
          }
          const rect = element.getBoundingClientRect();
          return { blocked, top: rect.top, bottom: rect.bottom, height: innerHeight,
            width: document.documentElement.scrollWidth, viewportWidth: innerWidth };
        });
        assert.deepEqual(result.blocked, [], label + ': long content is not clipped by an ancestor');
        assert.ok(result.top >= -1 && result.bottom <= result.height + 1, label + ': final content is reachable');
        assert.ok(result.width <= result.viewportWidth + 1, label + ': no horizontal overflow');
        await screenshot(page, name + '-' + label, true);
      }
      await screen(page, 'home');
      await page.locator('#rules-open').tap();
      await screen(page, 'rules');
      await reachable('#rules-play', 'rules');
      await page.locator('#pieces-open').tap();
      await screen(page, 'pieces');
      await page.locator('.screen[data-screen="pieces"] details summary').tap();
      await reachable('.screen[data-screen="pieces"] details p:last-child', 'pieces-expanded');
      await page.locator('#pieces-close').tap();
      await page.locator('#rules-close').tap();
      await screen(page, 'home');
      await page.locator('#home-start').tap();
      await page.locator('#challenge-open').tap();
      await screen(page, 'challenges');
      await page.locator('.screen[data-screen="challenges"] details summary').tap();
      await reachable('.screen[data-screen="challenges"] details p', 'challenges-expanded');
    });

    for (const mode of ['xiangqi', 'gomoku']) {
      await runCase('forced-loss-resignation-' + mode, { width: 390, height: 740 }, async (page, name) => {
        // Replayable legal moves, with two open ends. Black's distant pawns cannot capture the line.
        const state = newGame(mode);
        const cols = state.cols;
        const destinations = [4 * cols + 2, 0, 4 * cols + 3, cols - 1,
          4 * cols + 4, (state.rows - 1) * cols, 4 * cols + 5];
        for (const to of destinations) {
          const pool = state.pools[state.turn];
          const index = pool.indexOf('pawn');
          draw(state, () => (index + 0.5) / pool.length);
          deploy(state, to);
        }
        const fixture = encodeGame(state, 'computer', 'standard');
        assert.ok(decodeGame(fixture), 'resignation fixture must pass real replay validation');
        await page.evaluate(({ key, value }) => localStorage.setItem(key, value),
          { key: SAVE_KEY, value: fixture });
        await page.reload();
        await screen(page, 'home');
        await page.locator('#home-continue').tap();
        await screen(page, 'result');
        assert.match(await page.locator('#result-title').innerText(), /认输/);
        assert.match(await page.locator('#result-description').innerText(), /认输/);
        const finalText = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
        const finalState = decodeGame(finalText).state;
        assert.equal(finalState.resigned, 'black');
        assert.equal(finalState.result, 'red');
        assert.equal(finalState.ply, 7, 'computer resigns without spending a futile move');
        assert.deepEqual(finalState.history, state.history, 'resignation adds no fabricated move');
        assert.deepEqual(finalState.board, state.board);
        assert.deepEqual(finalState.pools, state.pools);
        assert.deepEqual(finalState.winningLine, [], 'resignation does not show a fabricated five');
        await fits(page, name + '-result', ['#result-title', '#result-description', '#result-restart', '#result-board']);
        await screenshot(page, name + '-result');
        await page.reload();
        await screen(page, 'home');
        await page.locator('#home-continue').tap();
        await screen(page, 'result');
        assert.match(await page.locator('#result-title').innerText(), /认输/);
        assert.equal(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY), finalText);
        await page.locator('#result-board').tap();
        await screen(page, 'game');
        assert.equal(await page.locator('.cell').first().isDisabled(), true);
        await page.goBack();
        await screen(page, 'result');
        await page.locator('#result-restart').tap();
        await screen(page, 'game');
        await history(page, 0);
        const restarted = decodeGame(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).state;
        assert.equal(restarted.resigned, null);
        assert.equal(restarted.result, null);
      });
    }

    assert.equal(evidence.failures.length, 0,
      'Failed checks: ' + evidence.failures.map((failure) => failure.name).join(', '));
  } catch (error) {
    evidence.fatal = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch((error) => { evidence.browserCloseError = String(error); });
    if (server.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
    }
    evidence.serverLog = serverLog;
    await writeFile(resolve(artifactRoot, 'report.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({
      passed: evidence.checks.length, failed: evidence.failures.length,
      report: 'artifacts/pavilion/report.json', screenshots: evidence.screenshots.length,
      ...(evidence.fatal ? { fatal: evidence.fatal } : {}),
    }));
  }
}
