import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./', import.meta.url));
await mkdir(`${output}/source`, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 432, height: 768 },
  deviceScaleFactor: 2.5, isMobile: true, hasTouch: true,
  recordVideo: { dir: `${output}/source`, size: { width: 432, height: 768 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = 'http://127.0.0.1:4189/';
const pause = ms => page.waitForTimeout(ms);
const screenshot = name => page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
const idle = () => page.waitForFunction(() => document.querySelector('#board').getAttribute('aria-busy') === 'false');
const tap = async selector => { await page.locator(selector).tap(); await pause(500); };
const cell = async index => { await page.locator('.cell').nth(index).tap(); await pause(650); };
try {
  await page.goto(base);
  await page.locator('.app-shell').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.app-shell').inert);
  await page.evaluate(() => document.fonts.ready);
  await pause(1500);
  assert.equal(await page.title(), '象五子棋 · 象棋走法，同色连五');
  await screenshot('screenshot-01-home-1080x1920');
  await tap('#challenge-quick-start');
  await idle();
  await pause(1200);
  await screenshot('source/preview-game');
  await cell(14);
  await pause(1000);
  await screenshot('screenshot-02-gameplay-1080x1920');
  await cell(41);
  await idle();
  await pause(1300);
  assert.equal(await page.locator('.cell.winning').count(), 5);
  await screenshot('screenshot-03-five-in-row-1080x1920');
  await pause(2000);
  await page.goto(`${base}?challenge=cannon-link`);
  await idle();
  await pause(1600);
  await cell(11);
  await pause(1300);
  await cell(47);
  await idle();
  assert.equal(await page.locator('.cell.winning').count(), 5);
  await pause(2000);
  await page.goto(`${base}?challenge=crossroads`);
  await idle();
  await pause(1500);
  await cell(43);
  await pause(1000);
  await cell(40);
  await idle();
  await pause(1700);
  await cell(50);
  await pause(1000);
  await cell(41);
  await idle();
  assert.equal(await page.locator('.cell.winning').count(), 5);
  await pause(2500);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/source/capture-evidence.json`, JSON.stringify({
    capturedAt: new Date().toISOString(), browser: browser.version(),
    source: base, viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
    screenshots: '1080x1920, same 9:16 ratio, unmodified browser captures',
    input: 'Playwright touchscreen.tap, real game rules and rendering; no state injection',
    scenarios: ['rook-bridge: 14→41', 'cannon-link: 11→47', 'crossroads: 43→40, 50→41'],
    assertions: 'Each scenario has exactly five winning cells; no page errors.',
    errors,
  }, null, 2));
} finally {
  await context.close();
  const video = await page.video().path();
  await browser.close();
  console.log(JSON.stringify({ output, video, errors }));
}
