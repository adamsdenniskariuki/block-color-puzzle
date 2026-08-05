// Generates Microsoft Store listing assets.
//   Desktop screenshots : 1366x768 minimum, PNG.
//   Poster art          : 720x1080 (2:3), strongly recommended for games.
// Run with: node tools/make-store-assets.js
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { startServer } from '../tests/helpers/serve.mjs';

const OUT = 'store-assets';
await mkdir(OUT, { recursive: true });

const server = await startServer();
const browser = await chromium.launch();

async function shot(name, { width, height, prepare }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));
  if (prepare) await prepare(page);
  // Two frames so any layout triggered above has settled.
  await page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await context.close();
  console.log(`${name}.png  ${width}x${height}`);
}

const DESKTOP = { width: 1366, height: 768 };

await shot('01-board', DESKTOP);

await shot('02-hint', {
  ...DESKTOP,
  prepare: async (page) => {
    await page.click('#btn-hint');
    await page.waitForTimeout(400);
  }
});

await shot('03-levels', {
  ...DESKTOP,
  prepare: async (page) => {
    // Levels is a mode inside the settings sheet, not a top-level button.
    // Choosing it closes the sheet by itself, so do not click Done.
    await page.click('#btn-settings');
    await page.click('.seg-btn[data-mode="levels"]');
    await page.waitForTimeout(400);
  }
});

await shot('04-stats', {
  ...DESKTOP,
  prepare: async (page) => page.click('#btn-stats')
});

await shot('05-settings', {
  ...DESKTOP,
  prepare: async (page) => page.click('#btn-settings')
});

// Declared in the manifest as form_factor "narrow", which gives phones a
// richer install prompt. Not used by the Store listing itself.
await shot('narrow-board', { width: 390, height: 844 });

// 2:3 poster art. Games use this as the main logo in the Store, so it is a
// composed marketing image rather than a screenshot - a raw 720x1080 capture
// of the app leaves the bottom 40% empty.
{
  const context = await browser.newContext({
    viewport: { width: 720, height: 1080 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve('tools/poster.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/poster-720x1080.png` });
  await context.close();
  console.log('poster-720x1080.png  720x1080');

  // The same art at 2x for the 1440x2160 slot.
  const hi = await browser.newContext({
    viewport: { width: 720, height: 1080 },
    deviceScaleFactor: 2
  });
  const hiPage = await hi.newPage();
  await hiPage.goto(pathToFileURL(resolve('tools/poster.html')).href);
  await hiPage.evaluate(() => document.fonts.ready);
  await hiPage.screenshot({ path: `${OUT}/poster-1440x2160.png` });
  await hi.close();
  console.log('poster-1440x2160.png  1440x2160');
}

await browser.close();
await server.close();
console.log(`\nWrote to ${OUT}/`);
