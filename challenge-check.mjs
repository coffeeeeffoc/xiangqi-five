// Actual touch/keyboard training, isolated saves, and safe same-position sharing.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { CHALLENGES } from './challenges.js';
import { newGame, deployDirectly } from './game.js';
import { encodeGame } from './local-game.js';

const server = createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^[\w./-]+$/.test(name) || name.split('/').includes('..'))
    return response.writeHead(404).end();
  try {
    const data = await readFile(new URL(`dist/${name}`, import.meta.url));
    response
      .writeHead(200, {
        'Content-Type':
          {
            html: 'text/html',
            js: 'text/javascript',
            css: 'text/css',
            svg: 'image/svg+xml',
            png: 'image/png',
            webp: 'image/webp',
          }[name.split('.').at(-1)] || 'text/plain',
      })
      .end(data);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
);
const base = `http://127.0.0.1:${server.address().port}/`;
const solutions = {
  'rook-bridge': [[14, 41]],
  'horse-leg': [[21, 40]],
  'elephant-eye': [[55, 39]],
  'cannon-link': [[11, 47]],
  'pawn-return': [[11, 20]],
  'break-threat': [[67, 13]],
  crossroads: [
    [43, 40],
    [50, 41],
  ],
  'cannon-cross': [
    [43, 40],
    [51, 42],
  ],
};
const idle = (page) =>
  page.waitForFunction(
    () => document.querySelector('#board').getAttribute('aria-busy') === 'false',
  );
const play = async (page, from, to) => {
  await page.locator('.cell').nth(from).tap();
  await page.locator('.cell').nth(to).tap();
  await idle(page);
};
const saved = (page) => page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1'));
const progress = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi-five-challenges-v1')).progress);
const screen = (page, name) =>
  page.waitForFunction((value) => document.body.dataset.screen === value, name);
const localGame = async (page) => {
  await page.locator('#home-start').tap();
  await screen(page, 'modes');
  await page.locator('#mode-local').tap();
  await screen(page, 'setup');
  await page.locator('#setup-start').tap();
  await screen(page, 'game');
  await idle(page);
};
const challengePicker = async (page) => {
  await page.locator('#game-back').tap();
  await screen(page, 'home');
  await page.locator('#home-start').tap();
  await screen(page, 'modes');
  await page.locator('#challenge-open').tap();
  await screen(page, 'challenges');
};
const openHelp = async (page) => {
  await page.locator('#training-help-open').tap();
  await screen(page, 'challenge-help');
};
const helpBack = async (page) => {
  await page.locator('.screen[data-screen="challenge-help"] [data-back]').tap();
  await screen(page, 'game');
};
const challengeTools = async (page) => {
  const current = await page.locator('body').getAttribute('data-screen');
  if (current === 'result') {
    await page.locator('#result-board').tap();
    await screen(page, 'game');
  } else if (current === 'challenge-help') await helpBack(page);
  await page.locator('#game-more').tap();
  await screen(page, 'tools');
};
const exitChallenge = async (page) => {
  await challengeTools(page);
  await page.locator('#challenge-exit').tap();
  await screen(page, 'game');
};

try {
  await mkdir(new URL('.turbo/challenges/', import.meta.url), { recursive: true });
  const newcomer = await browser.newPage({ viewport: { width: 305, height: 568 }, hasTouch: true });
  await newcomer.goto(base);
  const entryBox = await newcomer.locator('#challenge-quick-start').boundingBox();
  assert.ok(
    entryBox && entryBox.y >= 0 && entryBox.y + entryBox.height <= 568 && entryBox.height >= 44,
    'a newcomer can immediately reach the short practice on a small phone',
  );
  await newcomer.screenshot({
    path: fileURLToPath(new URL('.turbo/challenges/newcomer-305.png', import.meta.url)),
  });
  await newcomer.locator('#challenge-quick-start').tap();
  assert.equal(new URL(newcomer.url()).searchParams.get('challenge'), 'rook-bridge');
  await play(newcomer, 14, 41);
  await exitChallenge(newcomer);
  await newcomer.locator('#game-back').tap();
  await screen(newcomer, 'home');
  await newcomer.locator('#challenge-quick-start').tap();
  assert.equal(
    new URL(newcomer.url()).searchParams.get('challenge'),
    'horse-leg',
    'quick practice advances to an unfinished objective',
  );
  await newcomer.close();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await localGame(page);
  await page.locator('.cell').first().tap();
  await idle(page);
  await page.locator('.cell').last().tap();
  await idle(page);
  const original = await saved(page);
  await challengePicker(page);
  assert.equal(await page.locator('.challenge-card').count(), CHALLENGES.length);
  await page.locator('[data-challenge="horse-leg"]').tap();
  assert.equal(await page.locator('#room-open').isDisabled(), true);
  await play(page, 23, 40);
  assert.equal(
    await page.locator('#history-count').textContent(),
    '0',
    'a blocked horse never consumes an attempt',
  );
  assert.match(
    await page.locator('#challenge-move-message').textContent(),
    /不能走到这里/,
    'illegal input has visible training feedback',
  );
  assert.equal(
    await page.locator('.challenge-coordinate').count(),
    18,
    'visible row and column coordinates make hints usable',
  );
  await openHelp(page);
  await page.locator('#challenge-hint').tap();
  assert.equal(await page.locator('#challenge-hint-text').isVisible(), true);
  await helpBack(page);
  await play(page, 21, 40);
  assert.equal(await page.locator('#result-title').textContent(), '一手成五！');
  assert.equal((await progress(page))['horse-leg'].stars, 1);
  assert.equal(await saved(page), original);
  await exitChallenge(page);
  assert.equal(
    await page.locator('#history-count').textContent(),
    '2',
    'return restores the original local game',
  );
  assert.equal(await saved(page), original);
  assert.equal(new URL(page.url()).searchParams.has('challenge'), false);

  await page.goto(base + '?challenge=cannon-link');
  await play(page, 46, 47);
  assert.equal(
    await page.locator('#result-title').textContent(),
    '这手还差一点',
    'capturing the king does not pass without five',
  );
  assert.equal(await page.locator('.cell.winning').count(), 0);
  await page.locator('#result-restart').tap();
  assert.equal(await page.locator('#history-count').textContent(), '0');
  await play(page, 11, 47);
  assert.equal(await page.locator('#result-title').textContent(), '一手成五！');

  for (const [index, challenge] of CHALLENGES.entries()) {
    await page.goto(base + '?challenge=' + challenge.id);
    for (const step of solutions[challenge.id]) await play(page, ...step);
    assert.equal(
      await page.locator('#result-title').textContent(),
      challenge.goal === 'defend'
        ? '防守成功'
        : challenge.goal === 'two-turn'
          ? '连招成五！'
          : '一手成五！',
    );
    assert.equal((await progress(page))[challenge.id].stars, 2);
    assert.equal(await saved(page), original, 'training never overwrites ordinary saved moves');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.locator('#result-restart').tap();
    assert.equal(
      new URL(page.url()).searchParams.get('challenge'),
      CHALLENGES[(index + 1) % CHALLENGES.length].id,
      'next challenge is immediately playable',
    );
    assert.equal(await page.locator('#history-count').textContent(), '0');
  }
  await page.goto(base + '?challenge=break-threat');
  await play(page, 67, 49);
  assert.equal(
    await page.locator('#result-title').textContent(),
    '这手还差一点',
    'blocking the endpoint still loses to a capture',
  );
  await page.locator('#result-restart').tap();
  await play(page, 67, 31);
  assert.equal(
    await page.locator('#result-title').textContent(),
    '防守成功',
    'an alternative upstream defense is accepted',
  );

  await page.goto(base + '?challenge=cannon-cross');
  await play(page, 31, 40);
  assert.equal(
    await page.locator('#history-count').textContent(),
    '2',
    'the defender automatically plays one genuine legal move',
  );
  assert.equal(
    await page.locator('#result-banner').isVisible(),
    false,
    'king capture never substitutes for five',
  );
  assert.match(
    await page.locator('#challenge-objective').textContent(),
    /目标 2\/2.*黑马 E6→C5/,
    'the defender adapts to the alternative king-first plan',
  );
  await play(page, 51, 42);
  assert.equal(
    await page.locator('#result-title').textContent(),
    '连招成五！',
    'the alternative first-move plan also passes',
  );
  assert.match(await page.locator('#challenge-next-goal').textContent(), /下一目标.*一车架桥/);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload) => {
        window.shared = payload;
      },
    }),
  );
  await page.locator('#challenge-result-share').tap();
  assert.equal(await page.evaluate(() => window.shared.url), base + '?challenge=cannon-cross');
  assert.match(await page.evaluate(() => window.shared.text), /这题我解开了.*两手成五/);
  await challengeTools(page);
  await page.locator('#challenge-select').tap();
  assert.match(
    await page.locator('#challenge-summary').textContent(),
    /入门 6\/6 · 连招 2\/2 · 16\/16 星/,
  );
  await page.locator('#challenge-close').tap();
  await page.goto(base + '?challenge=crossroads');
  await play(page, 43, 44);
  assert.equal(await page.locator('#history-count').textContent(), '2');
  await play(page, 50, 51);
  assert.equal(
    await page.locator('#result-title').textContent(),
    '这手还差一点',
    'a refuted plan gets two genuine turns rather than a fake success',
  );
  await page.locator('#result-restart').tap();
  assert.equal(await page.locator('#history-count').textContent(), '0');
  assert.equal(await saved(page), original);

  await page.goto(
    base + '?challenge=rook-bridge&token=private&server=https://private.invalid/#secret=private',
  );
  await page.evaluate(() => {
    window.shared = null;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload) => {
        window.shared = payload;
      },
    });
  });
  await openHelp(page);
  await page.locator('#challenge-share').tap();
  assert.equal(await page.evaluate(() => window.shared.url), base + '?challenge=rook-bridge');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('clipboard must not be used after cancellation');
        },
      },
    });
  });
  await page.locator('#challenge-share').tap();
  assert.equal(await page.locator('#challenge-share-message').textContent(), '已取消分享。');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await page.locator('#challenge-share').tap();
  assert.equal(
    await page.locator('#challenge-share-link').inputValue(),
    base + '?challenge=rook-bridge',
  );
  assert.equal(await page.locator('#challenge-share-fallback').isVisible(), true);
  assert.equal(
    await page
      .locator('#challenge-share-link')
      .evaluate((input) => document.activeElement === input),
    true,
    'manual copying focuses the visible link',
  );
  assert.equal(
    await page
      .locator('#challenge-share-link')
      .evaluate((input) => input.selectionEnd - input.selectionStart),
    (base + '?challenge=rook-bridge').length,
  );
  for (const rejection of [null, undefined]) {
    await page.evaluate((value) => {
      window.copyCalls = 0;
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: () => Promise.reject(value),
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            window.copyCalls++;
          },
        },
      });
    }, rejection);
    await page.locator('#challenge-share').tap();
    assert.equal(
      await page.locator('#challenge-share-message').textContent(),
      '同题链接已复制。',
      'empty share rejections still allow clipboard fallback',
    );
    assert.equal(await page.evaluate(() => window.copyCalls), 1);
    assert.equal(await page.locator('#challenge-share').isDisabled(), false);
  }
  await page.evaluate(() => {
    window.shareCalls = 0;
    window.copyCalls = 0;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => {
        window.shareCalls++;
        return new Promise((resolve) => {
          window.resolveShare = resolve;
        });
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          window.copyCalls++;
        },
      },
    });
    document.querySelector('#challenge-share').click();
    document.querySelector('#challenge-share').click();
  });
  assert.equal(await page.locator('#challenge-share').isDisabled(), true);
  await page.locator('#challenge-hint').tap();
  assert.equal(
    await page.locator('#challenge-share').isDisabled(),
    true,
    'a board render cannot unlock a pending share',
  );
  await page.evaluate(() =>
    document
      .querySelector('#challenge-share')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  assert.equal(
    await page.evaluate(() => window.shareCalls),
    1,
    'consecutive clicks open only one system share',
  );
  assert.equal(
    await page.evaluate(() => window.copyCalls),
    0,
    'duplicate shares never fall into copying',
  );
  await page.evaluate(() => window.resolveShare());
  await page.waitForFunction(() => !document.querySelector('#challenge-share').disabled);
  assert.equal(
    await page.locator('#challenge-share-message').textContent(),
    '已打开分享，邀请好友解同一道题。',
  );
  assert.equal(await page.evaluate(() => window.copyCalls), 0);
  await page.evaluate(() => {
    window.copyCalls = 0;
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => {
          window.copyCalls++;
          return new Promise((resolve) => {
            window.resolveCopy = resolve;
          });
        },
      },
    });
    document.querySelector('#challenge-share').click();
    document.querySelector('#challenge-share').click();
  });
  assert.equal(
    await page.evaluate(() => window.copyCalls),
    1,
    'consecutive clicks write the clipboard only once',
  );
  await page.evaluate(() => window.resolveCopy());
  await page.waitForFunction(() => !document.querySelector('#challenge-share').disabled);
  assert.equal(await page.locator('#challenge-share-message').textContent(), '同题链接已复制。');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () =>
        new Promise((resolve, reject) => {
          window.rejectShare = reject;
        }),
    });
    window.copyCalls = 0;
  });
  await page.locator('#challenge-share').tap();
  await exitChallenge(page);
  await page.evaluate(() => window.rejectShare(null));
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(() => window.copyCalls),
    0,
    'leaving training prevents late share rejection from copying or moving focus',
  );
  assert.equal(await page.locator('#challenge-panel').isVisible(), false);
  assert.equal(await saved(page), original);
  for (const suffix of [
    '?challenge=unknown',
    '?challenge=horse-leg&challenge=rook-bridge',
    '?challenge=%3Cscript%3E',
  ]) {
    await page.goto(base + suffix);
    assert.equal(await page.locator('#challenge-panel').isVisible(), false);
    assert.equal(await page.locator('#history-count').textContent(), '2');
  }
  assert.deepEqual(errors, []);
  await page.close();
  console.log(
    'PASS eight real touch challenges, two-turn legal defender/multiple plans/failed retry, growth/next-goal/result invitations, old saves, share empty rejections/single flight/manual focus/exit, cancellation and hostile IDs',
  );

  const pending = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await pending.goto(base);
  await localGame(pending);
  await pending.locator('#draw-button').tap();
  const pendingSave = await saved(pending);
  assert.ok(JSON.parse(pendingSave).pending);
  await challengePicker(pending);
  await pending.locator('[data-challenge="crossroads"]').tap();
  await play(pending, 43, 40);
  await play(pending, 50, 41);
  await exitChallenge(pending);
  assert.equal(
    await saved(pending),
    pendingSave,
    'training preserves an already-drawn piece without a redraw',
  );
  assert.match(await pending.locator('#draw-button').getAttribute('aria-label'), /已抽到/);
  assert.equal(
    await pending.locator('#draw-button').isDisabled(),
    true,
    'the restored pending piece cannot be drawn again',
  );
  await pending.close();
  const invite = await browser.newPage();
  await invite.goto(base + '?challenge=horse-leg#room=ABCDEF12');
  assert.equal(
    await invite.locator('#challenge-panel').isVisible(),
    false,
    'friend invitations take priority over training links',
  );
  assert.equal(await invite.locator('#room-dialog').isVisible(), true);
  await invite.close();
  const computer = await browser.newPage({ hasTouch: true });
  const originalComputer = newGame();
  deployDirectly(originalComputer, 40, () => 0);
  const computerSave = encodeGame(originalComputer, 'computer', 'practice');
  await computer.addInitScript(
    (value) => localStorage.setItem('xiangqi-five-local-v1', value),
    computerSave,
  );
  await computer.goto(base + '?challenge=cannon-cross');
  await play(computer, 43, 40);
  await play(computer, 51, 42);
  assert.equal(
    await saved(computer),
    computerSave,
    'a two-turn lesson never writes over the interrupted computer game',
  );
  await exitChallenge(computer);
  await computer.waitForFunction(
    () =>
      document.querySelector('#history-count').textContent === '2' &&
      document.querySelector('#board').getAttribute('aria-busy') === 'false',
  );
  assert.equal(await computer.locator('#play-mode').inputValue(), 'computer');
  assert.equal(await computer.locator('#difficulty').inputValue(), 'practice');
  assert.match(await computer.locator('.cell').nth(40).getAttribute('aria-label'), /红方车/);
  await computer.close();
  console.log(
    'PASS newcomer quick practice, pending-piece save, interrupted computer resumes, friend invitations take priority',
  );

  for (const [width, height] of [
    [305, 568],
    [844, 390],
    [1280, 800],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
    await page.goto(base + '?challenge=rook-bridge');
    await page.locator('.cell').nth(14).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await idle(page);
    assert.equal(await page.locator('#result-title').textContent(), '一手成五！');
    assert.equal(
      await page
        .locator('.cell')
        .evaluateAll((cells) => cells.filter((cell) => cell.tabIndex === 0).length),
      1,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.locator('#result-restart').click();
    assert.equal(
      await page.locator('#challenge-title').textContent(),
      `2/${CHALLENGES.length} · 两马一条路`,
    );
    await page.goto(base + '?challenge=crossroads');
    await page.locator('.cell').nth(43).focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await idle(page);
    assert.equal(
      await page
        .locator('.cell')
        .nth(40)
        .evaluate((cell) => cell === document.activeElement),
      true,
      'keyboard focus survives both red and automatic black animations',
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`.turbo/challenges/combo-${width}.png`, import.meta.url)),
    });
    assert.equal(
      await page
        .locator('.cell')
        .evaluateAll((cells) => cells.filter((cell) => cell.tabIndex === 0).length),
      1,
    );
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await idle(page);
    assert.equal(await page.locator('#result-title').textContent(), '连招成五！');
    assert.equal(await page.locator('#history-count').textContent(), '3');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.close();
    console.log(
      `PASS ${width}x${height}: one/two-turn real keyboard solutions, focus across defender, no overflow, next exercise`,
    );
  }
  const denied = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await denied.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('storage unavailable');
    };
    Storage.prototype.setItem = () => {
      throw new Error('storage unavailable');
    };
  });
  await denied.goto(base + '?challenge=crossroads');
  await play(denied, 43, 40);
  await play(denied, 50, 41);
  assert.equal(await denied.locator('#result-title').textContent(), '连招成五！');
  await exitChallenge(denied);
  assert.equal(await denied.locator('#history-count').textContent(), '0');
  assert.match(await denied.locator('#save-status').textContent(), /未允许保存/);
  await denied.close();
  console.log(
    'PASS storage disabled: training remains playable and returning restores the local board',
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
