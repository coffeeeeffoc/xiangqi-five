// Run after `pnpm build` from the small-games workspace (uses its Playwright).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from '@playwright/test';

const server = createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^(?:assets\/)?[\w.-]+$/.test(name)) return response.writeHead(404).end();
  try {
    const data = await readFile(new URL(`./dist/${name}`, import.meta.url));
    response
      .writeHead(200, {
        'Content-Type':
          { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', html: 'text/html' }[
            name.split('.').at(-1)
          ] || 'text/plain',
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
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] }
    : { args: ['--no-sandbox'] },
);
const url = `http://127.0.0.1:${server.address().port}/`;
const waitForTurn = (page, ply) =>
  page.waitForFunction(
    (expected) =>
      document.querySelector('#history-count').textContent === String(expected) &&
      !document.querySelector('#board .cell').disabled,
    ply,
  );
const activeIndex = (page) =>
  page.locator('.cell').evaluateAll((cells) => cells.indexOf(document.activeElement));

try {
  for (const [mode, cols, count] of [
    ['xiangqi', 9, 90],
    ['gomoku', 15, 225],
  ]) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      Math.random = () => 0;
    });
    await page.goto(url);
    await page.locator('#home-start').click();
    await page.locator('#mode-local').click();
    await page.selectOption('#board-mode', mode);
    await page.locator('#setup-start').click();
    await page.locator('[data-screen="game"]:not(body)').waitFor({ state: 'visible' });
    const cells = page.locator('.cell');
    assert.equal(
      await cells.evaluateAll((items) => items.filter((cell) => cell.tabIndex === 0).length),
      1,
      'a whole board takes one Tab stop',
    );
    await cells.nth(cols + 2).focus();
    await page.keyboard.press('Home');
    assert.equal(await activeIndex(page), cols);
    await page.keyboard.press('End');
    assert.equal(await activeIndex(page), 2 * cols - 1);
    await page.keyboard.press('ArrowRight');
    assert.equal(await activeIndex(page), 2 * cols - 1, 'right edge does not wrap rows');
    await page.keyboard.press('Control+End');
    assert.equal(await activeIndex(page), count - 1);
    await page.keyboard.press('Control+Home');
    assert.equal(await activeIndex(page), 0);
    await page.keyboard.press('Tab');
    assert.equal(
      await activeIndex(page),
      -1,
      'Tab leaves the board instead of visiting every point',
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(await activeIndex(page), 0, 'returning to the board remembers the focused point');

    await page.keyboard.press('Enter');
    // A synthetic event bypasses native disabled buttons, so this also proves
    // the game keeps rejecting duplicate input during the real animation.
    await cells.nth(1).dispatchEvent('click');
    await waitForTurn(page, 1);
    assert.equal(await activeIndex(page), 0, 'focus survives a normal deployment animation');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await waitForTurn(page, 2);
    assert.equal(
      await activeIndex(page),
      1,
      'a second move works without re-tabbing into the board',
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    assert.equal(await cells.first().getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await cells.first().getAttribute('aria-pressed'), 'false');
    assert.equal(
      await page.locator('#history-count').textContent(),
      '2',
      'canceling a selection does not consume a turn',
    );

    await page.locator('#draw-button').click();
    await cells.nth(2).focus();
    const saved = await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1'));
    await page.keyboard.press('Escape');
    assert.equal(
      await page.evaluate(() => localStorage.getItem('xiangqi-five-local-v1')),
      saved,
      'Escape never cancels or redraws a pending piece',
    );
    await page.keyboard.press('Enter');
    await waitForTurn(page, 3);
    assert.equal(await activeIndex(page), 2);
    await page.close();
    console.log(
      `PASS ${mode}: one Tab stop, arrows/Home/End, consecutive keyboard turns, selection cancel, pending-piece lock`,
    );
  }

  const page = await browser.newPage();
  await page.goto(url);
  await page.locator('#home-start').click();
  await page.locator('#mode-computer').click();
  await page.selectOption('#difficulty', 'practice');
  await page.locator('#setup-start').click();
  await page.locator('[data-screen="game"]:not(body)').waitFor({ state: 'visible' });
  await page.locator('.cell').first().focus();
  await page.keyboard.press('Enter');
  await waitForTurn(page, 2);
  assert.equal(await activeIndex(page), 0, 'focus resumes when the computer finishes');
  await page.locator('.cell').nth(2).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#history-count').textContent === '3');
  await page.locator('#game-more').focus();
  await waitForTurn(page, 4);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'game-more',
    'finishing a computer turn does not steal focus from another control',
  );
  await page.close();
  console.log(
    'PASS computer: focus resumes after thinking and respects navigation to other controls',
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
