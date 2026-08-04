// Layout tests. These need a real layout engine, so they run in headless
// Chromium rather than jsdom — jsdom has no CSS box model, so every
// getBoundingClientRect() is zero and metrics() always clamps to its floor.
//
// The rule here: assert the *invariants* the sizing code exists to guarantee,
// never exact pixel values. Exact values change with any style tweak and tell
// you nothing about whether the game is usable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './helpers/serve.mjs';

const CELL_MIN = 34;
const CELL_MAX = 78;

// Sub-pixel rounding means rects rarely land on whole numbers.
const SLACK = 1;

const VIEWPORTS = [
  { name: 'iPhone SE', width: 320, height: 568 },
  { name: 'small Android', width: 360, height: 640 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'large phone', width: 414, height: 896 },
  // The short-and-wide case height-aware sizing was written for.
  { name: 'phone landscape', width: 740, height: 360 },
  { name: 'large phone landscape', width: 844, height: 390 },
  { name: 'tablet portrait', width: 768, height: 1024 },
  { name: 'tablet landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 }
];

const DIFFICULTIES = [4, 5, 6];

let server;
let browser;

test.before(async () => {
  server = await startServer();
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  await server?.close();
});

// Everything the assertions need, gathered in one round trip.
async function measure(page) {
  return page.evaluate(() => {
    const bcp = window.__bcp;
    const root = document.documentElement;
    const board = document.getElementById('board');
    const wrap = board.parentElement;
    const app = document.querySelector('.app');
    const controls = document.querySelector('.controls');
    const guide = document.getElementById('guide');

    const wrapCs = getComputedStyle(wrap);
    const inset = parseFloat(wrapCs.paddingLeft) + parseFloat(wrapCs.paddingRight);

    const offset = (node) => {
      const m = new DOMMatrix(getComputedStyle(node).transform);
      return { x: m.m41, y: m.m42 };
    };

    const rect = (node) => {
      const r = node.getBoundingClientRect();
      return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
    };

    const slots = [...board.querySelectorAll('.slot')];

    return {
      rows: bcp.state.rows,
      cols: bcp.COLS,
      cell: bcp.state.cell,
      gutter: bcp.state.gutter,
      cssCell: parseFloat(root.style.getPropertyValue('--cell')),
      cssGutter: parseFloat(root.style.getPropertyValue('--gutter')),
      cssRows: parseFloat(root.style.getPropertyValue('--rows')),
      cssCols: parseFloat(root.style.getPropertyValue('--cols')),

      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,

      wrapContentWidth: wrap.clientWidth - inset,
      board: rect(board),
      guide: rect(guide),
      app: rect(app),
      controls: rect(controls),

      slotCount: slots.length,
      tileCount: bcp.state.tiles.filter(Boolean).length,
      slotOffsets: slots.map(offset),
      slotRects: slots.map(rect)
    };
  });
}

// The difficulty buttons live inside the settings sheet, so they have to be
// reached the way a player reaches them. The click handler closes the sheet and
// starts a new game itself.
async function setDifficulty(page, rows) {
  const button = page.locator(`.seg-diff .seg-btn[data-rows="${rows}"]`);
  assert.equal(await button.count(), 1, `expected one difficulty button for ${rows} rows`);

  await page.locator('#btn-settings').click();
  await button.click();
  await page.waitForFunction(() => document.getElementById('settings').hidden);
  await page.waitForFunction((n) => window.__bcp?.state.rows === n, rows);
  await settle(page);
}

// Two frames: one for the layout write, one for it to take effect.
function settle(page) {
  return page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
}

for (const vp of VIEWPORTS) {
  test(`layout on ${vp.name} (${vp.width}x${vp.height})`, async (t) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    // Never let a mis-targeted selector stall the whole run.
    context.setDefaultTimeout(10000);
    const page = await context.newPage();

    // The service worker caches across runs and would happily serve stale JS.
    await page.route('**/sw.js', (route) => route.abort());

    await page.goto(`${server.url}/index.html`);
    await page.waitForFunction(() => Boolean(window.__bcp));

    for (const rows of DIFFICULTIES) {
      await t.test(`${rows} rows`, async () => {
        await setDifficulty(page, rows);
        const m = await measure(page);

        assert.equal(m.rows, rows, 'row count applied');

        // --- the CSS custom properties mirror state ---
        assert.equal(m.cssCell, m.cell, '--cell matches state.cell');
        assert.equal(m.cssGutter, m.gutter, '--gutter matches state.gutter');
        assert.equal(m.cssRows, rows, '--rows matches state.rows');
        assert.equal(m.cssCols, m.cols, '--cols matches COLS');

        // --- the clamp holds ---
        assert.ok(
          m.cell >= CELL_MIN && m.cell <= CELL_MAX,
          `cell ${m.cell} outside the ${CELL_MIN}-${CELL_MAX} clamp`
        );

        // --- the gutter rule ---
        assert.equal(m.gutter, rows >= 6 ? 5 : 6, 'gutter tightens at six rows');

        // --- the board fits its wrapper horizontally ---
        const boardWidth = m.cols * m.cell + (m.cols - 1) * m.gutter;
        assert.ok(
          boardWidth <= m.wrapContentWidth + SLACK,
          `board ${boardWidth}px overflows its ${m.wrapContentWidth}px wrapper`
        );

        // --- nothing is pushed below the fold ---
        assert.ok(
          m.controls.bottom <= m.innerHeight + SLACK,
          `controls end at ${m.controls.bottom}px, past the ${m.innerHeight}px viewport`
        );

        // --- and the page does not scroll in either direction ---
        assert.ok(
          m.scrollHeight <= m.innerHeight + SLACK,
          `page scrolls: ${m.scrollHeight}px of content in ${m.innerHeight}px`
        );
        assert.ok(
          m.scrollWidth <= m.innerWidth + SLACK,
          `page scrolls sideways: ${m.scrollWidth}px of content in ${m.innerWidth}px`
        );

        // --- the guide sits directly above the board, never overlapping it ---
        assert.ok(
          m.guide.bottom <= m.board.top + SLACK,
          'guide row overlaps the board'
        );

        // --- every cell has a slot, and the grid arithmetic is honoured ---
        assert.equal(m.slotCount, rows * m.cols, 'one slot per cell');
        assert.equal(m.tileCount, rows * m.cols - 1, 'one empty space');

        m.slotOffsets.forEach((o, i) => {
          const col = i % m.cols;
          const row = Math.floor(i / m.cols);
          assert.equal(o.x, col * (m.cell + m.gutter), `slot ${i} x`);
          assert.equal(o.y, row * (m.cell + m.gutter), `slot ${i} y`);
        });

        // --- slots never overlap each other ---
        for (let a = 0; a < m.slotRects.length; a++) {
          for (let b = a + 1; b < m.slotRects.length; b++) {
            const p = m.slotRects[a];
            const q = m.slotRects[b];
            const apart =
              p.right <= q.left + SLACK ||
              q.right <= p.left + SLACK ||
              p.bottom <= q.top + SLACK ||
              q.bottom <= p.top + SLACK;
            assert.ok(apart, `slots ${a} and ${b} overlap`);
          }
        }
      });
    }

    await context.close();
  });
}

// Landscape phones get a two-column layout: board on the left at full height,
// chrome stacked on the right. Without it six rows cannot fit above the 34px
// minimum tile and the controls fall off the bottom of the screen.
test('landscape phones use the two-column layout', async (t) => {
  const context = await browser.newContext({ viewport: { width: 740, height: 360 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  for (const rows of DIFFICULTIES) {
    await t.test(`${rows} rows`, async () => {
      await setDifficulty(page, rows);
      const m = await measure(page);

      const beside =
        m.controls.left >= m.board.right - SLACK ||
        m.controls.right <= m.board.left + SLACK;
      assert.ok(beside, 'controls should sit beside the board, not under it');

      // The point of the layout is headroom. If the cell has been driven back
      // to its floor the board is still being squeezed and this has not worked.
      assert.ok(
        m.cell > CELL_MIN,
        `cell fell back to the ${CELL_MIN}px floor, so the board is still squeezed`
      );
    });
  }

  await context.close();
});

// Portrait must keep the stacked layout - the two-column rules are scoped to
// landscape and should never leak into the normal case.
test('portrait keeps the stacked layout', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));
  await settle(page);

  const m = await measure(page);
  assert.ok(m.controls.top >= m.board.bottom - SLACK, 'controls should sit below the board');

  await context.close();
});

// Resizing must settle on a stable size rather than oscillate. verticalBudget()
// deliberately does not measure the board's own height; if that ever changes it
// becomes circular, and this is the test that would catch it.
test('resizing converges instead of oscillating', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  await page.setViewportSize({ width: 360, height: 640 });
  await settle(page);
  const first = (await measure(page)).cell;

  // Re-running layout with no viewport change must not move anything.
  const repeated = await page.evaluate(() => {
    const seen = [];
    for (let i = 0; i < 5; i++) {
      window.__bcp.layout();
      seen.push(window.__bcp.state.cell);
    }
    return seen;
  });

  assert.deepEqual(repeated, Array(5).fill(first), 'cell size drifts when layout re-runs');

  // And going back to the original viewport restores the original size.
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  const back = (await measure(page)).cell;

  await page.setViewportSize({ width: 360, height: 640 });
  await settle(page);
  const again = (await measure(page)).cell;

  assert.equal(again, first, 'same viewport gives a different size the second time');
  assert.ok(back >= first, 'a taller viewport should not shrink the cell');

  await context.close();
});
