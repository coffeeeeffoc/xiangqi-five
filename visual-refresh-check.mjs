// Build first: node build.js && node visual-refresh-check.mjs.
// Capture the implemented mobile refresh through real touch navigation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';
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
const gameRoot = fileURLToPath(new URL('./', import.meta.url));
const root = resolve(gameRoot, 'dist');
const artifactRoot = resolve(gameRoot, 'docs/design');
await mkdir(artifactRoot, { recursive: true });
const types = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  woff2: 'font/woff2',
};
const handleRoom = createRoomService();
const server = createServer(async (request, response) => {
  if (await handleRoom(request, response)) return;
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const filename = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!filename.startsWith(`${root}${sep}`)) return response.writeHead(404).end();
  try {
    response
      .writeHead(200, {
        'Content-Type': types[filename.split('.').at(-1)] || 'application/octet-stream',
      })
      .end(await readFile(filename));
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
const errors = [];
const evidence = {
  checkedAt: new Date().toISOString(),
  environment: 'Chromium mobile emulation with actual touch input; not physical-device testing',
  browser: browser.version(),
  success: false,
  screenshots: [],
  checks: [],
  glyphChecks: [],
};

async function makePage(width = 390, height = 844) {
  const page = await browser.newPage({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function screen(page, expected) {
  await page.waitForFunction((name) => document.body.dataset.screen === name, expected);
  assert.deepEqual(
    await page
      .locator('.screen[data-screen]')
      .evaluateAll((items) =>
        items.filter((item) => !item.hidden).map((item) => item.dataset.screen),
      ),
    [expected],
    'one full page is visible',
  );
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    `${expected}: no horizontal page overflow`,
  );
}

async function capture(page, expected, name) {
  await screen(page, expected);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  const filename = resolve(artifactRoot, `refresh-${name}.png`);
  await page.screenshot({ path: filename, fullPage: true, animations: 'disabled' });
  evidence.screenshots.push({
    page: expected,
    viewport: page.viewportSize(),
    path: relative(gameRoot, filename).split(sep).join('/'),
  });
  console.log(`PASS ${name}: touch navigation, page bounds, screenshot`);
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

async function boardFits(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const viewport = page.viewportSize();
  for (const selector of ['#board', '#draw-button', '#move-button', '#game-more', '#game-back']) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(
      box &&
        box.x >= -0.5 &&
        box.y >= -0.5 &&
        box.x + box.width <= viewport.width + 0.5 &&
        box.y + box.height <= viewport.height + 0.5,
      `${name}: ${selector} is fully within viewport (${JSON.stringify(box)})`,
    );
    if (selector !== '#board') {
      assert.ok(box.width >= 43.99 && box.height >= 43.99, `${selector}: 44px touch target`);
    }
  }
  evidence.checks.push(`${name}: complete board and primary controls fit the viewport`);
}

async function glyphs(page, name, boardOnly = true) {
  const result = await page.evaluate(
    async ({ boardOnly }) => {
      await document.fonts.load('20px "Xiangqi Chess Glyphs"');
      await document.fonts.ready;
      const loaded = [...document.fonts].some(
        (font) =>
          font.family.replaceAll('"', '').replaceAll("'", '') === 'Xiangqi Chess Glyphs' &&
          font.status === 'loaded',
      );
      const context = document.createElement('canvas').getContext('2d');
      const tokens = [...document.querySelectorAll(boardOnly ? '#board .piece' : '.piece')]
        .filter((piece) => piece.getClientRects().length > 0)
        .map((piece) => {
          const label = piece.querySelector('.piece-label');
          const tokenBox = piece.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(label);
          const textBox = range.getBoundingClientRect();
          const styles = getComputedStyle(piece);
          context.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
          const ink = context.measureText(label.textContent);
          // Font line boxes include unused ascender/descender space. Measure the
          // rendered baseline and the glyph's actual ink to test visible bounds.
          const baselineMarker = document.createElement('span');
          baselineMarker.style.cssText =
            'display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';
          label.append(baselineMarker);
          const baseline = baselineMarker.getBoundingClientRect().y;
          baselineMarker.remove();
          return {
            text: label.textContent,
            font: styles.fontFamily,
            fontSize: parseFloat(styles.fontSize),
            token: { x: tokenBox.x, y: tokenBox.y, width: tokenBox.width, height: tokenBox.height },
            glyph: {
              x: textBox.x - ink.actualBoundingBoxLeft,
              y: baseline - ink.actualBoundingBoxAscent,
              width: ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight,
              height: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent,
            },
            fontLineBox: {
              x: textBox.x,
              y: textBox.y,
              width: textBox.width,
              height: textBox.height,
            },
            cellWidth: piece.closest('.cell')?.getBoundingClientRect().width ?? null,
          };
        });
      return {
        loaded,
        fontCheck: document.fonts.check('20px "Xiangqi Chess Glyphs"'),
        decorationCount: document.querySelectorAll('.piece-face, .piece-accent').length,
        tokens,
      };
    },
    { boardOnly },
  );
  assert.equal(result.loaded, true, `${name}: the bundled chess font is loaded`);
  assert.equal(result.fontCheck, true);
  assert.equal(result.decorationCount, 0, `${name}: chess tokens have no face/accent overlay`);
  assert.ok(result.tokens.length, `${name}: actual placed tokens are present`);
  for (const item of result.tokens) {
    assert.match(item.font, /Xiangqi Chess Glyphs/);
    assert.ok(
      item.glyph.x >= item.token.x - 1 &&
        item.glyph.y >= item.token.y - 1 &&
        item.glyph.x + item.glyph.width <= item.token.x + item.token.width + 1 &&
        item.glyph.y + item.glyph.height <= item.token.y + item.token.height + 1,
      `${name}: ${item.text} glyph fits its disk (${JSON.stringify(item)})`,
    );
    if (item.cellWidth !== null) {
      assert.ok(
        Math.abs(item.fontSize / item.cellWidth - 0.62) < 0.02,
        `${name}: font scales with the chess cell`,
      );
    }
  }
  evidence.glyphChecks.push({ name, ...result });
  return result.tokens[0].fontSize;
}

async function startLocal(page, mode = 'xiangqi') {
  await screen(page, 'home');
  await page.locator('#home-start').tap();
  await screen(page, 'modes');
  await page.locator('#mode-local').tap();
  await screen(page, 'setup');
  await page.locator(`[data-board="${mode}"]`).tap();
  await page.locator('#setup-start').tap();
  await screen(page, 'game');
}

async function pendingIdentity(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi-five-local-v1')).pending);
}

async function checkPending(page) {
  assert.equal(await page.locator('.action-panel').getAttribute('data-state'), 'pending');
  assert.match(await page.locator('#draw-button').innerText(), /已抽到「.+」/);
  const drawnLabel = await page.locator('#draw-preview .piece-label').innerText();
  assert.ok((await page.locator('#draw-button').innerText()).includes(`「${drawnLabel}」`));
  assert.match(
    await page.locator('#action-hint').innerText(),
    /点棋盘空位放置.*不能重抽或改为移动/,
  );
  assert.equal(await page.locator('#draw-button').isDisabled(), true);
  assert.equal(await page.locator('#move-button').isDisabled(), true);
}

try {
  const page = await makePage();
  await capture(page, 'home', 'home-390x844');
  await page.locator('#home-start').tap();
  await capture(page, 'modes', 'modes-390x844');
  await page.locator('#mode-computer').tap();
  await page.locator('[data-difficulty="hard"]').tap();
  await capture(page, 'setup', 'setup-computer-390x844');
  assert.match(await page.locator('#setup-subtitle').innerText(), /你执红，电脑执黑/);
  await page.locator('.screen[data-screen="setup"] [data-back]').tap();
  await screen(page, 'modes');
  await page.locator('#mode-local').tap();
  await capture(page, 'setup', 'setup-local-390x844');
  assert.equal(await page.locator('#difficulty').isVisible(), false);
  await page.locator('#setup-start').tap();
  for (const [ply, index] of [40, 49, 30, 60].entries()) {
    await page.locator('.cell').nth(index).tap();
    await history(page, ply + 1);
  }
  await boardFits(page, '390x844 classic ready');
  const fontBeforeZoom = await glyphs(page, '390x844 classic ready');
  await capture(page, 'game', 'game-ready-390x844');
  await page.locator('#game-zoom').tap();
  await page.waitForFunction(
    () => document.querySelector('#board-scroll').dataset.scale !== '1.00',
  );
  const fontAfterZoom = await glyphs(page, '390x844 classic zoomed');
  assert.ok(fontAfterZoom > fontBeforeZoom * 1.3, 'the chess glyph grows with board zoom');
  evidence.checks.push('Actual zoom tap increases both board size and chess glyph size');
  await page.locator('#game-zoom-reset').tap();
  await page.locator('#draw-button').tap();
  await checkPending(page);
  const pending = await pendingIdentity(page);
  await boardFits(page, '390x844 classic pending');
  await capture(page, 'game', 'game-pending-390x844');

  await page.locator('#game-more').tap();
  await capture(page, 'tools', 'tools-390x844');
  await page.locator('#tools-rules').tap();
  await capture(page, 'rules', 'rules-390x844');
  await page.locator('#pieces-open').tap();
  await glyphs(page, 'all seven piece guides', false);
  await capture(page, 'pieces', 'pieces-390x844');
  await page.locator('#pieces-close').tap();
  await screen(page, 'rules');
  await page.locator('#rules-close').tap();
  await screen(page, 'tools');
  await page.locator('#history-open').tap();
  await capture(page, 'history', 'history-390x844');
  assert.equal(await page.locator('#full-history > li').count(), 4);
  await page.locator('#history-close').tap();
  await screen(page, 'tools');
  await page.locator('#tools-pool').tap();
  await glyphs(page, 'both player pool headings', false);
  await capture(page, 'pool', 'pool-390x844');
  await page.locator('#pool-close').tap();
  await screen(page, 'tools');
  await page.locator('#new-game').tap();
  await capture(page, 'restart', 'restart-390x844');
  await page.locator('#restart-cancel').tap();
  await screen(page, 'tools');
  await page.locator('#tools-close').tap();
  await screen(page, 'game');
  await checkPending(page);
  assert.deepEqual(
    await pendingIdentity(page),
    pending,
    'page navigation preserves the drawn identity',
  );
  evidence.checks.push(
    'Pending draw identity and mandatory-placement state survive rules, guides, history, pool and restart cancellation',
  );

  await page.locator('#game-back').tap();
  await screen(page, 'home');
  await page.locator('#home-start').tap();
  await screen(page, 'modes');
  await page.locator('#challenge-open').tap();
  await capture(page, 'challenges', 'challenges-390x844');
  await page.locator('[data-challenge="horse-leg"]').tap();
  await screen(page, 'game');
  await page.locator('#training-help-open').tap();
  await screen(page, 'challenge-help');
  await page.locator('#challenge-hint').tap();
  await capture(page, 'challenge-help', 'challenge-help-390x844');
  await page.locator('.screen[data-screen="challenge-help"] [data-back]').tap();
  await screen(page, 'game');
  await page.locator('.cell').nth(21).tap();
  await page.locator('.cell').nth(40).tap();
  await history(page, 1);
  assert.equal(await page.locator('#result-title').innerText(), '一手成五！');
  await capture(page, 'game', 'practice-solved-390x844');
  await page.locator('#game-more').tap();
  await screen(page, 'tools');
  await page.locator('#challenge-exit').tap();
  await screen(page, 'game');
  assert.deepEqual(
    await pendingIdentity(page),
    pending,
    'practice preserves the local pending draw',
  );
  await page.locator('#game-back').tap();
  await screen(page, 'home');
  await page.locator('#home-start').tap();
  await screen(page, 'modes');
  await page.locator('#room-open').tap();
  await screen(page, 'room');
  await page.locator('#room-create').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#room-create').disabled);
  await capture(page, 'room', 'room-390x844');
  await page.close();

  const winner = await makePage();
  await startLocal(winner);
  for (const [ply, index] of [0, 89, 1, 88, 2, 87, 3, 86, 4].entries()) {
    await winner.locator('.cell').nth(index).tap();
    await history(winner, ply + 1);
  }
  await screen(winner, 'result');
  assert.equal(await winner.locator('#result-title').innerText(), '红方获胜！');
  await capture(winner, 'result', 'result-390x844');
  evidence.checks.push(
    'Nine real alternating touch placements trigger the red five-in-a-row result page',
  );
  await winner.close();

  for (const [width, height, mode, name] of [
    [305, 568, 'gomoku', 'large-board-305x568'],
    [844, 390, 'xiangqi', 'game-landscape-844x390'],
  ]) {
    const small = await makePage(width, height);
    await startLocal(small, mode);
    await small.locator('.cell').first().tap();
    await history(small, 1);
    await small.locator('.cell').last().tap();
    await history(small, 2);
    await boardFits(small, name);
    await glyphs(small, name);
    await capture(small, 'game', name);
    if (mode === 'gomoku') {
      await small.locator('#draw-button').tap();
      await checkPending(small);
      await boardFits(small, 'large-board pending 305x568');
      await capture(small, 'game', 'large-board-pending-305x568');
    }
    await small.close();
  }
  assert.deepEqual(errors, [], 'no browser page errors');
  evidence.checks.push(
    'Every captured page has no horizontal overflow; loaded bundled font, glyph containment and cell-relative scaling verified',
  );
  evidence.success = true;
} catch (error) {
  evidence.error = error.stack || error.message;
  throw error;
} finally {
  evidence.pageErrors = errors;
  await writeFile(
    resolve(artifactRoot, 'refresh-validation.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await browser.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
console.log(
  `PASS visual refresh: ${evidence.screenshots.length} screenshots saved in docs/design/`,
);
