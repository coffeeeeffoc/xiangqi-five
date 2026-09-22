import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Only run against the explicitly isolated competition_test environment.
const url = process.env.XIANGQI_COMPETITION_URL || 'http://127.0.0.1:43010/games/xiangqi-five/';
const browser = await chromium.launch();
const evidence = { url, browser: browser.version(), checkedAt: new Date().toISOString(), matches: [] };
const pages = await Promise.all([0, 1].map(() => browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })));
const read = (page, code) => page.evaluate(code => globalThis.__competition.request(`/rooms/${code}`), code);
try {
  await mkdir(new URL('.turbo/competition/', import.meta.url), { recursive: true });
  for (const page of pages) { await page.goto(url); await page.locator('[data-competition-launch]').tap(); }
  await pages[0].locator('[data-create]').tap();
  await pages[0].locator('[data-room-code]').waitFor({ state: 'visible' });
  let code = (await pages[0].locator('[data-room-code]').textContent()).match(/[A-F0-9]{12}/)[0];
  await pages[1].locator('[data-code]').fill(code); await pages[1].locator('[data-join]').tap();
  await pages[1].locator('[data-room-code]').waitFor({ state: 'visible' });
  for (let round = 0; round < 2; round++) {
    if (round) {
      for (const page of pages) {
        await page.getByRole('button', { name: '再次挑战', exact: true }).tap();
        await page.locator('[data-ready]').waitFor({ state: 'visible' });
      }
      code = (await pages[0].locator('[data-room-code]').textContent()).match(/[A-F0-9]{12}/)[0];
    }
    await pages[0].locator('[data-ready]').tap(); await pages[1].locator('[data-ready]').tap();
    for (const page of pages) await page.waitForFunction(code => globalThis.__competition.request(`/rooms/${code}`).then(r => r.status === 'playing'), code);
    const opening = await read(pages[0], code);
    assert.notEqual(opening.players[0].id, opening.players[1].id);
    for (const [ply, index] of [0, 89, 1, 87, 2, 85, 3, 83, 4].entries()) {
      // Polling transports the authoritative opponent turn before the next real pointer action.
      await pages[ply % 2].waitForTimeout(1500);
      const page = pages[ply % 2], canvas = page.locator('[data-play]'), box = await canvas.boundingBox();
      const unit = Math.max(8, Math.min((box.width - 12) / 9, (box.height - 104) / 10, 56));
      await canvas.tap({ position: { x: (box.width - unit * 9) / 2 + (index % 9 + .5) * unit, y: 36 + (Math.floor(index / 9) + .5) * unit } });
      await page.waitForFunction(({ code, ply }) => globalThis.__competition.request(`/rooms/${code}`).then(r => r.state.ply === ply + 1), { code, ply }, { timeout: 7000 });
    }
    const results = await Promise.all(pages.map(page => read(page, code)));
    assert.equal(results[0].status, 'finished');
    assert.deepEqual(results[0].results, results[1].results);
    assert.deepEqual(results[0].results.map(item => item.result.score), [3, 0]);
    assert.deepEqual(results[0].results.map(item => item.rated), [round === 0, round === 0]);
    const boards = await Promise.all(pages.map(page => page.evaluate(() => globalThis.__competition.request('/boards/xiangqi-five'))));
    assert.deepEqual(boards.map(board => Number(board.me.score)), [3, 0]);
    for (const page of pages) await page.getByRole('button', { name: '再次挑战', exact: true }).waitFor({ state: 'visible' });
    await pages[0].screenshot({ path: fileURLToPath(new URL(`.turbo/competition/online-round-${round + 1}.png`, import.meta.url)) });
    evidence.matches.push({ code, result: results[0].results, boards });
    console.log(`PASS real browser round ${round + 1}: 9 pointer moves, same server result, win3/loss0, rated=${round === 0}, cumulative3/0`);
  }
  await writeFile(new URL('.turbo/competition/online-result.json', import.meta.url), JSON.stringify(evidence, null, 2));
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.error(`Client ${index}: ${await page.locator('[data-status]').textContent()}`);
    await page.screenshot({ path: fileURLToPath(new URL(`.turbo/competition/online-failure-${index}.png`, import.meta.url)) });
  }
  throw error;
} finally { await browser.close(); }
