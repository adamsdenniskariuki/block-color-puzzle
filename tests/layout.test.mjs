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
  // The narrowest landscape phone still in use. It sits just above the
  // two-column threshold; at 600px it fell back to stacked and overflowed 67px.
  { name: 'iPhone SE landscape', width: 568, height: 320 },
  { name: 'small phone landscape', width: 640, height: 360 },
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
    const modePanel = document.querySelector('.mode-panel');
    const modeNote = document.getElementById('mode-note');
    const hud = document.querySelector('.hud');
    const topbar = document.querySelector('.topbar');
    const stage = document.querySelector('.stage');

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
      modePanel: rect(modePanel),
      modeNote: rect(modeNote),
      hud: rect(hud),
      topbar: rect(topbar),
      stage: rect(stage),

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

// The narrowest landscape phone still in common use. It cannot reach a
// comfortable cell size at six rows, so unlike the test above this only
// requires that it uses two columns and fits - the matrix covers the overflow.
test('the narrowest landscape phone still uses two columns', async (t) => {
  const context = await browser.newContext({ viewport: { width: 568, height: 320 } });
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
    });
  }

  await context.close();
});

// The custom domain serves Sortile at the origin root. Keeping the old GitHub
// project path here would give the TWA a different web identity.
test('install metadata uses the custom-domain root as the app identity', async () => {
  const response = await fetch(`${server.url}/manifest.webmanifest`);
  assert.equal(response.status, 200, 'manifest should be served');
  const manifest = await response.json();

  const productionManifest = new URL('https://sortile.madebyfavor.com/manifest.webmanifest');
  const resolvedStart = new URL(manifest.start_url, productionManifest);
  const resolvedId = new URL(manifest.id, resolvedStart.origin);
  assert.equal(resolvedId.href, 'https://sortile.madebyfavor.com/index.html');
  assert.equal(resolvedStart.href, 'https://sortile.madebyfavor.com/index.html');
  assert.equal(manifest.name, 'Sortile \u2014 Colour Block Puzzle');
  assert.equal(manifest.short_name, 'Sortile');
  assert.equal(manifest.scope, '/');

  // "portrait" is respected by installed PWAs and would make the landscape
  // layout unreachable for the users most likely to need it.
  assert.notEqual(manifest.orientation, 'portrait',
    'locking portrait would make the landscape layout unreachable once installed');
  assert.notEqual(manifest.orientation, 'portrait-primary', 'same as above');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'),
    'a maskable icon is required for a clean installed icon');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'),
    'store packaging tools require a 512px icon');

  const context = await browser.newContext();
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  const head = await page.evaluate(() => ({
    title: document.title,
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
    applicationName: document.querySelector('meta[name="application-name"]')?.content,
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content
  }));
  assert.deepEqual(head, {
    title: 'Sortile \u2014 Colour Block Puzzle',
    manifest: 'manifest.webmanifest',
    applicationName: 'Sortile',
    appleTitle: 'Sortile'
  });
  await context.close();
});

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

test('the mode row keeps a stable phone budget and the board caps on tablets', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));
  await settle(page);

  const free = await measure(page);
  const phoneWidthCell = Math.floor(
    (free.wrapContentWidth - free.gutter * (free.cols - 1)) / free.cols
  );
  assert.equal(free.cell, phoneWidthCell, 'a tall phone should grow the board to its width budget');

  await page.locator('.seg-mode [data-mode="daily"]').click();
  await page.waitForFunction(() => window.__bcp.state.mode === 'daily');
  await settle(page);
  const daily = await measure(page);

  await page.locator('.seg-mode [data-mode="levels"]').click();
  await page.waitForFunction(() => window.__bcp.state.mode === 'levels');
  await settle(page);
  const levels = await measure(page);
  const levelNoteSpacing = await page.evaluate(() => {
    const wrapper = document.querySelector('#mode-note > .mode-note-text');
    if (!wrapper) return { wrapped: false, leadingSpaceWidth: 0 };
    const text = wrapper.childNodes[1];
    if (!text || text.nodeType !== Node.TEXT_NODE) return { wrapped: true, leadingSpaceWidth: 0 };
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    return { wrapped: true, leadingSpaceWidth: range.getBoundingClientRect().width };
  });

  assert.equal(daily.modeNote.height, free.modeNote.height, 'the note reserves its height in free play');
  assert.equal(levels.modeNote.height, free.modeNote.height, 'the note height is stable in levels');
  assert.equal(daily.stage.top, free.stage.top, 'daily should not move the board down');
  assert.equal(levels.stage.top, free.stage.top, 'levels should not move the board down');
  assert.equal(daily.cell, free.cell, 'same-sized free and daily boards share one stable budget');
  assert.equal(levelNoteSpacing.wrapped, true, 'rich mode status should remain one flex item');
  assert.ok(levelNoteSpacing.leadingSpaceWidth > 0, 'Level status should keep space after its bold label');

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.locator('.seg-mode [data-mode="free"]').click();
  await page.waitForFunction(() => window.__bcp.state.mode === 'free');
  await settle(page);
  const tablet = await measure(page);
  assert.equal(tablet.cell, CELL_MAX, 'the board should stop growing at the tablet cap');

  await context.close();
});

// The help modal must fit the smallest phone without scrolling, and its dismiss
// button must always be reachable. It once held 13 flat bullets, which pushed
// "Got it" off the card on a 360px screen - you had to scroll to close it.
for (const vp of [{ name: 'small phone', width: 360, height: 640 },
                  { name: 'tall phone', width: 390, height: 844 }]) {
  test(`help modal fits without scrolling on a ${vp.name}`, async () => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    context.setDefaultTimeout(10000);
    const page = await context.newPage();
    await page.route('**/sw.js', (route) => route.abort());
    await page.goto(`${server.url}/index.html`);
    await page.waitForFunction(() => Boolean(window.__bcp));
    await page.click('#btn-help');
    await settle(page);

    const m = await page.evaluate(() => {
      const card = document.querySelector('#help .modal-card');
      const scroll = document.querySelector('#help .modal-scroll');
      const btn = document.getElementById('btn-help-close');
      const cardRect = card.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      return {
        overflow: scroll.scrollHeight - scroll.clientHeight,
        btnTop: btnRect.top,
        btnBottom: btnRect.bottom,
        cardTop: cardRect.top,
        cardBottom: cardRect.bottom,
        sections: document.querySelectorAll('#help details').length,
        open: document.querySelectorAll('#help details[open]').length,
      };
    });

    assert.ok(m.overflow <= SLACK, `help modal should not scroll, overflowed by ${m.overflow}px`);
    assert.ok(m.btnBottom <= m.cardBottom + SLACK && m.btnTop >= m.cardTop - SLACK,
      'the "Got it" button must be visible without scrolling');
    assert.ok(m.sections >= 3, 'reference content should stay in collapsible sections');
    assert.equal(m.open, 0, 'sections should start collapsed so the modal opens short');

    await context.close();
  });
}

// Reopening help must reset the collapsible sections, otherwise the modal grows
// a little every time the user expands something and comes back to it.
test('help modal collapses its sections again when reopened', async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  await page.click('#btn-help');
  await page.evaluate(() => {
    document.querySelectorAll('#help details').forEach((d) => { d.open = true; });
  });
  await settle(page);

  const expanded = await page.evaluate(() => {
    const scroll = document.querySelector('#help .modal-scroll');
    return scroll.scrollHeight;
  });

  await page.click('#btn-help-close');
  await page.click('#btn-help');
  await settle(page);

  const reopened = await page.evaluate(() => ({
    open: document.querySelectorAll('#help details[open]').length,
    height: document.querySelector('#help .modal-scroll').scrollHeight,
  }));

  assert.equal(reopened.open, 0, 'sections should be collapsed again on reopen');
  assert.ok(reopened.height < expanded, 'reopened modal should be shorter than the expanded one');

  await context.close();
});

// With every section expanded the content scrolls, and the dismiss button must
// stay opaque. A sticky footer with a partly transparent background let list
// items show through it.
//
// Note both obvious tests are fooled here: elementFromPoint still returns a
// transparent footer, and .modal-scroll's box ends at the footer even when its
// content paints past it. The symptom is visual, so the assertion is visual -
// the footer band must render identically at every scroll position.
test('help content never shows through the dismiss button', async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  await page.click('#btn-help');
  await page.evaluate(() => {
    document.querySelectorAll('#help details').forEach((d) => { d.open = true; });
  });
  await settle(page);

  const scrollable = await page.evaluate(() => {
    const s = document.querySelector('#help .modal-scroll');
    const c = document.querySelector('#help .modal-card');
    return Math.max(s.scrollHeight - s.clientHeight, c.scrollHeight - c.clientHeight);
  });
  assert.ok(scrollable > 40, 'expanding every section should leave something to scroll, or this proves nothing');

  const band = await page.evaluate(() => {
    const r = document.querySelector('#help .modal-foot').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });

  const shots = [];
  for (const fraction of [0, 0.5, 1]) {
    await page.evaluate((f) => {
      for (const sel of ['#help .modal-scroll', '#help .modal-card']) {
        const n = document.querySelector(sel);
        n.scrollTop = (n.scrollHeight - n.clientHeight) * f;
      }
    }, fraction);
    await settle(page);
    // Under parallel test load the compositor can still be a frame behind, which
    // made this test flaky. Wait for the band to stop changing before recording.
    // A real bleed is a steady-state difference between scroll positions, so
    // settling here does not weaken the assertion below.
    let shot = await page.screenshot({ clip: band });
    for (let i = 0; i < 10; i += 1) {
      await settle(page);
      const next = await page.screenshot({ clip: band });
      if (next.equals(shot)) break;
      shot = next;
    }
    shots.push(shot);
  }

  for (let i = 1; i < shots.length; i += 1) {
    assert.ok(shots[i].equals(shots[0]),
      'the footer band changed as the content scrolled - text is showing through the dismiss button');
  }

  await context.close();
});

// The button must also be the thing you actually hit when you tap it.
test('the dismiss button is on top of the help content', async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  await page.click('#btn-help');
  await page.evaluate(() => {
    document.querySelectorAll('#help details').forEach((d) => { d.open = true; });
  });
  await settle(page);

  const hits = await page.evaluate(() => {
    const rect = document.querySelector('#help .modal-foot').getBoundingClientRect();
    const found = [];
    for (let i = 1; i <= 6; i += 1) {
      const node = document.elementFromPoint(rect.left + rect.width / 2, rect.top + (rect.height * i) / 7);
      found.push(node ? node.tagName.toLowerCase() : 'none');
    }
    return found;
  });

  for (const tag of hits) {
    assert.ok(tag === 'div' || tag === 'button', `the footer band hit <${tag}> instead of the button`);
  }

  await page.click('#btn-help-close');
  assert.equal(await page.evaluate(() => document.getElementById('help').hidden), true,
    'clicking Got it should close the modal');

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

/* ---------------- themes ---------------- */

// sRGB relative luminance, per WCAG 2.1.
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function parseRgb(css) {
  const nums = css.match(/[\d.]+/g).slice(0, 3).map(Number);
  assert.equal(nums.length, 3, `could not parse a colour from "${css}"`);
  return nums;
}

// Themes are pure CSS custom properties, so jsdom cannot resolve them - this
// has to run somewhere with a cascade. Two of the themes are light, which is
// where readability is easiest to break, so the contrast floor matters more
// than any of the individual colour choices.
test('every theme is readable and none is a duplicate', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  const themes = await page.evaluate(() => {
    // Probe the accent pair the same way the UI uses it: a filled control.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-999px;background:var(--accent);color:var(--on-accent)';
    document.body.appendChild(probe);

    const out = {};
    for (const [id, name] of Object.entries(window.__bcp.APPEARANCES)) {
      window.__bcp.setAppearance(id);
      const body = getComputedStyle(document.body);
      const chip = getComputedStyle(probe);
      out[id] = {
        name,
        applied: document.documentElement.dataset.appearance,
        bg: body.backgroundColor,
        text: body.color,
        accent: chip.backgroundColor,
        onAccent: chip.color
      };
    }
    probe.remove();
    return out;
  });

  const seen = new Map();

  for (const [id, theme] of Object.entries(themes)) {
    await t.test(theme.name, () => {
      assert.equal(theme.applied, id, 'choosing a theme must apply it to the document');

      // A typo in a selector leaves the theme silently falling back to the
      // default, which looks like a working button that does nothing.
      const previous = seen.get(theme.bg);
      assert.equal(previous, undefined,
        `${theme.name} has the same background as ${previous} - one of them is not being applied`);
      seen.set(theme.bg, theme.name);

      const body = contrast(parseRgb(theme.text), parseRgb(theme.bg));
      assert.ok(body >= 4.5, `body text is ${body.toFixed(2)}:1 against the page, needs 4.5:1`);

      const onAccent = contrast(parseRgb(theme.onAccent), parseRgb(theme.accent));
      assert.ok(onAccent >= 4.5, `text on the accent is ${onAccent.toFixed(2)}:1, needs 4.5:1`);
    });
  }

  await context.close();
});

// The empty slot is the one thing a player has to locate every single turn, and
// it is a pure CSS artefact - a translucent fill plus inset shadows - so nothing
// in jsdom or in the token values alone can tell you whether it is actually
// visible. It shipped at 1.25:1 against the frame, i.e. very nearly invisible,
// because the fill was measured but the *rendering* never was.
//
// WCAG 1.4.11 wants 3:1 for a graphical object you need in order to understand
// the content. The boundary is what carries it here, so this samples the real
// pixels and takes the darkest one: the fill on its own is only ~1.4:1 and it is
// the rim and top shadow that do the work.
test('the empty slot reads as a recess in every theme', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  const appearances = await page.evaluate(() => window.__bcp.APPEARANCES);

  for (const [id, name] of Object.entries(appearances)) {
    await t.test(name, async () => {
      await page.evaluate((v) => window.__bcp.setAppearance(v), id);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      // Slots are appended in cell order, so the gap's index picks its slot.
      const probe = await page.evaluate(() => {
        const slot = document.querySelectorAll('#board .slot')[window.__bcp.state.gap];
        const r = slot.getBoundingClientRect();
        return {
          rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          frame: getComputedStyle(document.querySelector('.frame')).backgroundColor
        };
      });

      assert.ok(probe.rect.width > 0 && probe.rect.height > 0, 'the empty slot should have a box');

      // Playwright hands back a PNG; the page's own canvas is the only decoder
      // available without adding a dependency.
      const shot = await page.screenshot({ clip: probe.rect });
      const pixels = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(0, 0, img.width, img.height).data);
      }, shot.toString('base64'));

      let darkest = null;
      let lowest = Infinity;
      for (let i = 0; i < pixels.length; i += 4) {
        const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const l = luminance(rgb);
        if (l < lowest) {
          lowest = l;
          darkest = rgb;
        }
      }

      const edge = contrast(darkest, parseRgb(probe.frame));
      assert.ok(edge >= 3,
        `the empty slot's strongest edge is ${edge.toFixed(2)}:1 against the frame, needs 3:1 to be findable`);
    });
  }

  await context.close();
});

// About three quarters of the blocks on a fresh board are in the wrong column,
// so the old treatment - an outline on each of them - marked nearly the whole
// board, which is the same as marking none of it. The affordance now runs the
// other way: the misplaced blocks lose their colour, leaving the settled ones as
// the only coloured things on the board. That is a rendered effect - a CSS
// filter - and the declared background never changes, so neither jsdom nor
// getComputedStyle can see it. The only honest check is to photograph the board.
test('the colour hint drains the misplaced blocks in every palette', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  await page.evaluate(() => {
    const box = document.getElementById('opt-hints');
    if (!box.checked) {
      box.checked = true;
      box.dispatchEvent(new Event('change'));
    }
  });

  const palettes = await page.evaluate(() => Object.keys(window.__bcp.PALETTES));

  for (const id of palettes) {
    await t.test(id, async () => {
      // A board where every block is already home has nothing to compare against,
      // so deal until both groups exist. A fresh scramble gives both almost always.
      const probe = await page.evaluate(async (pid) => {
        window.__bcp.setPalette(pid);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          window.__bcp.newGame();
          const tiles = [...document.querySelectorAll('#board .tile')];
          const wrong = tiles.filter((tile) => tile.classList.contains('is-wrong'));
          if (!wrong.length || wrong.length === tiles.length) continue;
          // The drain is transitioned, so a plain rAF wait photographs the board
          // a fifth of the way into the fade - it measured grayscale(0.13) and
          // the pixels looked barely touched. Wait for the filter to settle.
          const settled = async () => {
            let last = '';
            for (let i = 0; i < 40; i += 1) {
              await new Promise((r) => setTimeout(r, 30));
              const now = tiles.map((tile) => getComputedStyle(tile).filter).join('|');
              if (now === last) return;
              last = now;
            }
          };
          await settled();
          const board = document.getElementById('board').getBoundingClientRect();
          return {
            rect: { x: Math.round(board.x), y: Math.round(board.y), width: Math.round(board.width), height: Math.round(board.height) },
            tiles: tiles.map((tile) => {
              const r = tile.getBoundingClientRect();
              return {
                wrong: tile.classList.contains('is-wrong'),
                filter: getComputedStyle(tile).filter,
                x: Math.round(r.x + r.width / 2 - board.x),
                y: Math.round(r.y + r.height / 2 - board.y)
              };
            })
          };
        }
        return null;
      }, id);

      assert.ok(probe, 'could not deal a board holding both settled and misplaced blocks');

      // The class carries the whole feature, so a rule that stops matching is the
      // failure to catch first - the pixels below would then simply all agree.
      for (const tile of probe.tiles) {
        const expected = tile.wrong ? 'is not none' : 'is none';
        const actual = tile.filter === 'none' ? 'is none' : 'is not none';
        assert.equal(actual, expected, `a ${tile.wrong ? 'misplaced' : 'settled'} block's filter ${actual}, expected it ${expected}`);
      }

      const shot = await page.screenshot({ clip: probe.rect });
      const pixels = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(0, 0, img.width, img.height).data);
      }, shot.toString('base64'));

      // Chroma, not luminance: the filter holds brightness on purpose so the block
      // keeps the contrast against the board that every theme was tuned for. What
      // it takes away is the colour.
      const chromaAt = (x, y) => {
        const i = (y * probe.rect.width + x) * 4;
        const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
        return Math.max(...rgb) - Math.min(...rgb);
      };

      const drained = probe.tiles.filter((tile) => tile.wrong).map((tile) => chromaAt(tile.x, tile.y));
      const vivid = probe.tiles.filter((tile) => !tile.wrong).map((tile) => chromaAt(tile.x, tile.y));

      assert.ok(Math.max(...drained) <= 30,
        `a misplaced block still carries ${Math.max(...drained)} chroma, so it does not read as drained`);
      assert.ok(Math.min(...vivid) >= 60,
        `a settled block only carries ${Math.min(...vivid)} chroma, so it has nothing to stand out with`);
    });
  }

  await context.close();
});


// Each swatch in the picker carries data-appearance and paints itself in the
// theme it offers, so a theme is rendered *inside* whichever theme is currently
// active. Any token a theme block leaves undefined therefore leaks in from the
// surrounding theme instead of falling back to :root - the swatch shows a
// colour belonging to a different theme. That is how Slate shipped with no
// --accent of its own: at root it inherited the right value from :root and
// looked correct, so only the nested preview was wrong.
test('a theme previewed inside another theme still looks like itself', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));

  const result = await page.evaluate(() => {
    // The tokens a swatch actually paints with.
    const TOKENS = ['--bg', '--text', '--accent', '--wash'];
    const read = (el) => {
      const cs = getComputedStyle(el);
      return TOKENS.map((t) => cs.getPropertyValue(t).trim());
    };

    const ids = Object.keys(window.__bcp.APPEARANCES);

    // What each theme looks like when it owns the whole document.
    const atRoot = {};
    for (const id of ids) {
      window.__bcp.setAppearance(id);
      atRoot[id] = read(document.documentElement);
    }

    // The same theme, nested inside a different one.
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-999px';
    document.body.appendChild(host);

    const nested = {};
    ids.forEach((id, i) => {
      const under = ids[(i + 1) % ids.length];
      host.dataset.appearance = under;
      const inner = document.createElement('div');
      inner.dataset.appearance = id;
      host.appendChild(inner);
      nested[id] = { under, tokens: read(inner) };
      inner.remove();
    });

    host.remove();
    return { ids, atRoot, nested, TOKENS };
  });

  for (const id of result.ids) {
    await t.test(id, () => {
      const want = result.atRoot[id];
      const got = result.nested[id].tokens;

      // Guard against the probe reading empty strings, which would make every
      // comparison below trivially true.
      assert.ok(want.every((v) => v.length > 0),
        `${id} resolved no values at root - the probe is not measuring anything`);

      result.TOKENS.forEach((token, i) => {
        assert.equal(got[i], want[i],
          `${token} is "${got[i]}" when ${id} is previewed inside ${result.nested[id].under}, ` +
          `but "${want[i]}" when ${id} is the active theme - ${id} does not define ${token}`);
      });
    });
  }

  await context.close();
});

// The picker swatches put a fixed-width preview and a label on one line, so
// the label is what runs out of room. It is a single unbreakable word, so it
// does not wrap - it spills straight out of the rounded card, which looks far
// worse than the stacked layout it replaced. Narrow phones fall back to
// stacking for exactly this reason, and this is the test that decides whether
// that threshold sits in the right place.
test('picker swatch labels stay inside their cards', async (t) => {
  const context = await browser.newContext();
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());

  for (const vp of VIEWPORTS) {
    await t.test(vp.name, async () => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${server.url}/index.html`);
      await page.waitForFunction(() => Boolean(window.__bcp));
      await page.click('#btn-settings');
      await page.click('#btn-colours');
      await settle(page);
      const paletteLabels = await page.evaluate(() => {
        const out = [];
        for (const sw of document.querySelectorAll('#palette-row .swatch')) {
          const name = sw.querySelector('.swatch-name');
          const card = sw.getBoundingClientRect();
          const label = name.getBoundingClientRect();
          const pad = parseFloat(getComputedStyle(sw).paddingRight);
          out.push({
            text: name.textContent,
            spill: Math.round(label.right - (card.right - pad)),
            // An ellipsis is not an acceptable outcome either - the whole point
            // of the label is that it can be read.
            clipped: name.scrollWidth > name.clientWidth + 1
          });
        }
        return out;
      });
      await page.click('#btn-colours-back');
      await page.click('#btn-appearance');
      await settle(page);
      const appearanceLabels = await page.evaluate(() => {
        const out = [];
        for (const sw of document.querySelectorAll('#appearance-row .swatch')) {
          const name = sw.querySelector('.swatch-name');
          const card = sw.getBoundingClientRect();
          const label = name.getBoundingClientRect();
          const pad = parseFloat(getComputedStyle(sw).paddingRight);
          out.push({
            text: name.textContent,
            spill: Math.round(label.right - (card.right - pad)),
            clipped: name.scrollWidth > name.clientWidth + 1
          });
        }
        return out;
      });
      const labels = [...paletteLabels, ...appearanceLabels];

      assert.ok(labels.length > 0, 'found no swatches - the picker did not render');

      for (const o of labels) {
        assert.ok(o.spill <= 1, `"${o.text}" overflows its card by ${o.spill}px`);
        assert.ok(!o.clipped, `"${o.text}" is truncated rather than shown in full`);
      }
    });
  }

  await context.close();
});

test('Settings subdialogs stay contained across supported viewport classes', async (t) => {
  const context = await browser.newContext();
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  const viewports = [
    { name: 'small phone', width: 320, height: 568 },
    { name: 'phone', width: 390, height: 844 },
    { name: 'landscape phone', width: 740, height: 360 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 800 }
  ];

  for (const vp of viewports) {
    await t.test(vp.name, async () => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${server.url}/index.html`);
      await page.waitForFunction(() => Boolean(window.__bcp));
      await page.click('#btn-settings');

      for (const id of ['colours', 'appearance', 'options']) {
        await page.click(`#btn-${id}`);
        await settle(page);
        const result = await page.evaluate((modalId) => {
          const modal = document.getElementById(modalId);
          const card = modal.querySelector('.modal-card');
          const r = card.getBoundingClientRect();
          const controls = [...card.querySelectorAll('button, input')]
            .filter(node => !node.closest('[hidden]'))
            .map(node => node.getBoundingClientRect());
          return {
            contained: r.left >= -1 && r.top >= -1 &&
              r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
            controlsContained: controls.every(c => c.left >= r.left - 1 && c.top >= r.top - 1 &&
              c.right <= r.right + 1 && c.bottom <= r.bottom + 1),
            pageScroll: document.documentElement.scrollWidth - innerWidth
          };
        }, id);
        assert.equal(result.contained, true, `${id} card escaped ${vp.name}`);
        assert.equal(result.controlsContained, true, `${id} controls escaped their card on ${vp.name}`);
        assert.ok(result.pageScroll <= SLACK, `${id} caused horizontal page scroll on ${vp.name}`);
        await page.click(`#btn-${id}-back`);
      }
    });
  }

  await context.close();
});

test('Settings keeps a fixed reachable Done footer on phones', async (t) => {
  const context = await browser.newContext();
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());

  for (const vp of [{ name: 'iPhone SE', width: 320, height: 568 },
                    { name: 'iPhone 14', width: 390, height: 844 }]) {
    await t.test(vp.name, async () => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${server.url}/index.html`);
      await page.waitForFunction(() => Boolean(window.__bcp));
      await page.click('#btn-settings');
      await settle(page);

      const result = await page.evaluate(() => {
        const card = document.querySelector('#settings .modal-card');
        const body = document.querySelector('#settings .modal-scroll');
        const foot = document.querySelector('#settings .modal-foot');
        const done = document.getElementById('btn-settings-close');
        const before = foot.getBoundingClientRect();
        body.scrollTop = body.scrollHeight;
        const after = foot.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const doneRect = done.getBoundingClientRect();
        return {
          split: card.classList.contains('modal-card-split'),
          bodyAndFooterAreSiblings: body.parentElement === card && foot.parentElement === card,
          scrolled: body.scrollTop,
          maxScroll: body.scrollHeight - body.clientHeight,
          footBefore: before.top,
          footAfter: after.top,
          cardBottom: cardRect.bottom,
          doneBottom: doneRect.bottom
        };
      });

      assert.equal(result.split, true, 'Settings must keep the split-card structure');
      assert.equal(result.bodyAndFooterAreSiblings, true, 'body and footer must remain separate');
      if (result.maxScroll > SLACK) {
        assert.ok(result.scrolled > 0, 'an overflowing Settings body should scroll independently');
      }
      assert.equal(result.footAfter, result.footBefore, 'footer must not move when the body scrolls');
      assert.ok(result.doneBottom <= result.cardBottom + SLACK, 'Done must stay inside the visible card');
    });
  }

  await context.close();
});

test('Data & backup modal keeps transfer actions contained at 390x844', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));
  await page.click('#btn-settings');
  await page.click('#btn-data-backup');
  await settle(page);

  const m = await page.evaluate(() => {
    const card = document.querySelector('#data-backup .modal-card');
    const cardRect = card.getBoundingClientRect();
    const actions = [...card.querySelectorAll('.btn')].map(node => node.getBoundingClientRect());
    return {
      overflow: card.scrollHeight - card.clientHeight,
      cardContained: cardRect.left >= -1 && cardRect.top >= -1 &&
        cardRect.right <= innerWidth + 1 && cardRect.bottom <= innerHeight + 1,
      actionsContained: actions.every(r => r.left >= cardRect.left - 1 && r.top >= cardRect.top - 1 &&
        r.right <= cardRect.right + 1 && r.bottom <= cardRect.bottom + 1)
    };
  });

  assert.ok(m.overflow <= SLACK, `Data & backup should fit without scrolling, overflowed by ${m.overflow}px`);
  assert.equal(m.cardContained, true);
  assert.equal(m.actionsContained, true);

  await context.close();
});

test('Data & backup status panel keeps readable text in every theme', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));
  await page.click('#btn-settings');
  await page.click('#btn-data-backup');

  for (const [id, name] of Object.entries(await page.evaluate(() => window.__bcp.APPEARANCES))) {
    await t.test(name, async () => {
      const probe = await page.evaluate((theme) => {
        window.__bcp.setAppearance(theme);
        window.__bcp.stageImportText('{');
        const panel = document.getElementById('data-status');
        const cs = getComputedStyle(panel);
        const rect = panel.getBoundingClientRect();
        return {
          hidden: panel.hidden,
          state: panel.dataset.state,
          text: cs.color,
          background: cs.backgroundColor,
          height: rect.height
        };
      }, id);
      const ratio = contrast(parseRgb(probe.text), parseRgb(probe.background));
      assert.equal(probe.hidden, false, 'an error should expose the status panel');
      assert.equal(probe.state, 'error', 'an invalid import should use error state');
      assert.ok(probe.height >= 44, `status panel is only ${probe.height}px tall`);
      assert.ok(ratio >= 4.5, `status text is ${ratio.toFixed(2)}:1 in ${name}, needs 4.5:1`);
    });
  }

  await context.close();
});

test('feedback preflight keeps its actions usable at 390x844', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => Boolean(window.__bcp));
  await page.click('#btn-settings');
  await page.click('#btn-feedback');
  await settle(page);

  const m = await page.evaluate(() => {
    const card = document.querySelector('#feedback .modal-card');
    const send = document.getElementById('btn-send-feedback');
    const back = document.getElementById('btn-feedback-back');
    const cardRect = card.getBoundingClientRect();
    return {
      overflow: card.scrollHeight - card.clientHeight,
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      sendTop: send.getBoundingClientRect().top,
      backBottom: back.getBoundingClientRect().bottom,
      previewOpen: document.getElementById('feedback-preview').open
    };
  });

  assert.ok(m.overflow <= SLACK, `collapsed feedback dialog should fit without scrolling, overflowed by ${m.overflow}px`);
  assert.ok(m.sendTop >= m.cardTop - SLACK && m.backBottom <= m.cardBottom + SLACK,
    'all feedback actions must be visible and touchable');
  assert.equal(m.previewOpen, false, 'preview should preserve space by starting collapsed');

  await context.close();
});

test('privacy policy stays readable and contained in light and dark themes at 390x844', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.route('**/sw.js', (route) => route.abort());

  for (const theme of ['light', 'dark']) {
    await t.test(theme, async () => {
      await page.goto(`${server.url}/privacy.html?scoutTheme=${theme}`);
      await settle(page);

      const probe = await page.evaluate(() => {
        const card = document.querySelector('.privacy-card');
        const heading = document.querySelector('h1');
        const paragraph = document.querySelector('.privacy-card section p');
        const back = document.querySelector('.privacy-back');
        const cardStyle = getComputedStyle(card);
        return {
          theme: document.documentElement.dataset.theme,
          title: heading.textContent,
          sectionCount: document.querySelectorAll('.privacy-card section').length,
          cardLeft: card.getBoundingClientRect().left,
          cardRight: card.getBoundingClientRect().right,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth,
          headingText: getComputedStyle(heading).color,
          bodyText: getComputedStyle(paragraph).color,
          cardBackground: cardStyle.backgroundColor,
          backText: getComputedStyle(back).color,
          pageBackground: getComputedStyle(document.body).backgroundColor,
          date: document.querySelector('time')?.dateTime,
          backTarget: back.getAttribute('href')
        };
      });

      assert.equal(probe.theme, theme);
      assert.equal(probe.title, 'Privacy policy');
      assert.ok(probe.sectionCount >= 9, 'all policy topics should remain present');
      assert.equal(probe.date, '2026-08-07');
      assert.equal(probe.backTarget, 'index.html');
      assert.ok(probe.cardLeft >= -SLACK && probe.cardRight <= probe.innerWidth + SLACK,
        `${theme} policy card escaped the viewport`);
      assert.ok(probe.scrollWidth <= probe.innerWidth + SLACK,
        `${theme} policy page scrolls horizontally`);
      assert.ok(contrast(parseRgb(probe.headingText), parseRgb(probe.cardBackground)) >= 4.5,
        `${theme} policy heading lacks 4.5:1 contrast`);
      assert.ok(contrast(parseRgb(probe.bodyText), parseRgb(probe.cardBackground)) >= 4.5,
        `${theme} policy body lacks 4.5:1 contrast`);
      assert.ok(contrast(parseRgb(probe.backText), parseRgb(probe.pageBackground)) >= 4.5,
        `${theme} back link lacks 4.5:1 contrast`);
    });
  }

  await context.close();
});
