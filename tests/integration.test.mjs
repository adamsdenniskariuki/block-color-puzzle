/*
 * Integration tests: the real game, booted in jsdom, driven through the DOM.
 *
 * These exercise behaviour a unit test cannot -- input wiring, rendering,
 * modals, persistence -- by clicking and typing rather than calling internals.
 * Internals are still read to assert on the resulting state.
 *
 * jsdom has no layout engine, so anything measured with getBoundingClientRect
 * is deliberately left out; that stays verified in a real browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, autoSolve } from './helpers/boot.mjs';

/** A fresh game per test, so no test can be polluted by an earlier one. */
async function fresh(opts) {
  const h = await boot(opts);
  return h;
}

/* ---------------- rendering ---------------- */

test('boot renders a guide and a board that agree with the state', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  assert.equal(h.$$('#guide .guide-cell').length, COLS, 'one guide cell per column');
  assert.equal(state.board.length, state.rows * COLS);
  assert.equal(h.$$('#board .tile').length, state.rows * COLS - 1, 'every cell but the gap');

  h.close();
});

test('difficulty changes the board size and starts a new puzzle', async () => {
  const h = await fresh();
  const { COLS } = h.bcp;

  for (const [rows, label] of [[4, 'Easy'], [6, 'Hard']]) {
    h.click(`.seg-btn[data-rows="${rows}"]`);
    await h.tick(2);

    assert.equal(h.bcp.state.rows, rows, `${label} should be ${rows} rows`);
    assert.equal(h.$$('#board .tile').length, rows * COLS - 1);
    assert.equal(h.bcp.state.moves, 0, `${label} should start a fresh board`);
  }

  h.close();
});

test('a scrambled board does not start solved', async () => {
  const h = await fresh();
  assert.equal(h.bcp.isSolved(), false);
  assert.ok(h.bcp.misplaced() > 0);
  h.close();
});

/* ---------------- sliding ---------------- */

test('tapping a tile in line with the gap slides it', async () => {
  const h = await fresh();
  const { state, neighbours } = h.bcp;

  const gap = state.gap;
  const target = [...neighbours(gap)][0];
  const colour = state.board[target];

  h.bcp.slideTo(target, true);

  assert.equal(state.board[gap], colour, 'the colour moved into the old gap');
  assert.equal(state.board[target], null, 'the gap moved to the tapped cell');
  assert.equal(state.gap, target);
  assert.equal(state.moves, 1);

  h.close();
});

test('a run slide moves every block between the tap and the gap, and counts them all',
  async () => {
    const h = await fresh();
    const { state, COLS } = h.bcp;

    // Find a cell at least two steps from the gap along its row.
    const gap = state.gap;
    const row = Math.floor(gap / COLS);
    const col = gap % COLS;
    const far = col >= 2 ? gap - 2 : col <= COLS - 3 ? gap + 2 : null;

    if (far === null) { h.close(); return; }

    const step = far < gap ? 1 : -1;
    const between = [far, far + step];
    const colours = between.map(i => state.board[i]);

    const before = state.moves;
    h.bcp.slideTo(far, true);

    assert.equal(state.gap, far, 'the gap ended up where we tapped');
    assert.equal(state.board[far + step], colours[0], 'the run shifted by one');
    assert.equal(state.board[far + step * 2], colours[1]);
    assert.equal(state.moves - before, 2, 'a run counts blocks, not taps');
    assert.equal(Math.floor(state.gap / COLS), row, 'the slide stayed in its row');

    h.close();
  });

test('tapping a tile that is not in line with the gap does not move anything', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  const gap = state.gap;
  const offRow = Math.floor(gap / COLS) === 0 ? 1 : 0;
  const offCol = gap % COLS === 0 ? 1 : 0;
  const target = offRow * COLS + offCol;

  if (target === gap || Math.floor(target / COLS) === Math.floor(gap / COLS)
      || target % COLS === gap % COLS) { h.close(); return; }

  const before = [...state.board];
  h.bcp.slideTo(target, true);

  assert.deepEqual([...state.board], before, 'the board should be untouched');
  assert.equal(state.moves, 0);

  h.close();
});

test('arrow keys slide the block on that side of the gap', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  const gap = state.gap;
  const col = gap % COLS;
  // ArrowLeft pulls the block to the gap's right leftwards into it.
  const [key, source] = col < COLS - 1 ? ['ArrowLeft', gap + 1] : ['ArrowRight', gap - 1];
  const colour = state.board[source];

  h.key(key);
  await h.tick();

  assert.equal(state.board[gap], colour, `${key} moved the neighbour in`);
  assert.equal(state.gap, source);
  assert.ok(state.moves > 0, 'a keyboard slide is recorded');

  h.close();
});

test('arrow keys are ignored while a modal is open', async () => {
  const h = await fresh();

  h.click('#btn-settings');
  await h.tick();
  assert.equal(h.$('#settings').hidden, false, 'settings should be open');

  const before = [...h.bcp.state.board];
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) h.key(k);
  await h.tick();

  assert.deepEqual([...h.bcp.state.board], before);
  assert.equal(h.bcp.state.moves, 0);

  h.close();
});

/* ---------------- undo ---------------- */

test('undo restores the exact board and rewinds the move count', async () => {
  const h = await fresh();
  const { state, neighbours } = h.bcp;

  const before = [...state.board];
  h.bcp.slideTo([...neighbours(state.gap)][0], true);
  assert.notDeepEqual([...state.board], before, 'the slide should have changed something');

  h.click('#btn-undo');
  await h.tick();

  assert.deepEqual([...state.board], before, 'undo did not restore the board');
  assert.equal(state.moves, 0, 'undo did not rewind the counter');
  assert.equal(h.$('#btn-undo').disabled, true, 'undo should disable when history is empty');

  h.close();
});

test('undo unwinds a run slide in one step', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  const gap = state.gap;
  const col = gap % COLS;
  const far = col >= 2 ? gap - 2 : col <= COLS - 3 ? gap + 2 : null;
  if (far === null) { h.close(); return; }

  const before = [...state.board];
  h.bcp.slideTo(far, true);
  assert.equal(state.moves, 2);

  h.click('#btn-undo');
  await h.tick();

  assert.deepEqual([...state.board], before, 'a run should undo as a single entry');
  assert.equal(state.moves, 0);

  h.close();
});

/* ---------------- hints ---------------- */

test('a hint costs one of three and disables the button at zero', async () => {
  const h = await fresh();
  const badge = h.$('#hint-badge');
  const button = h.$('#btn-hint');

  assert.equal(badge.textContent, String(h.bcp.HINTS_PER_GAME));

  for (let left = h.bcp.HINTS_PER_GAME - 1; left >= 0; left--) {
    h.click('#btn-hint');
    // showHint defers the search into a frame, so wait for the outcome.
    await h.waitFor(() => h.bcp.state.hintsLeft === left, { label: `${left} hints left` });

    if (left > 0) {
      assert.equal(badge.textContent, String(left), 'the badge tracks what is left');
      assert.equal(button.disabled, false);
    }
  }

  assert.equal(button.disabled, true, 'the button locks once hints run out');
  assert.equal(badge.hidden, true, 'a zero badge is hidden rather than shown');

  h.close();
});

test('the hint label names the remaining count for screen readers', async () => {
  const h = await fresh();

  h.click('#btn-hint');
  await h.waitFor(() => h.bcp.state.hintsLeft === h.bcp.HINTS_PER_GAME - 1,
    { label: 'a hint to be spent' });

  assert.match(h.$('#btn-hint').getAttribute('aria-label'), /2 remaining/);

  h.close();
});

test('a hint rings exactly one tile, and it is the solver move', async () => {
  const h = await fresh();

  h.click('#btn-hint');
  await h.waitFor(() => h.bcp.state.hintCell >= 0, { label: 'a tile to be ringed' });

  const ringed = h.$$('#board .tile.is-hint');
  assert.equal(ringed.length, 1, 'only one tile should be highlighted');
  assert.ok([...h.bcp.neighbours(h.bcp.state.gap)].includes(h.bcp.state.hintCell),
    'the hinted tile must be slideable right now');

  h.close();
});

test('a new puzzle refills the hints', async () => {
  const h = await fresh();

  h.click('#btn-hint');
  await h.waitFor(() => h.bcp.state.hintsLeft === h.bcp.HINTS_PER_GAME - 1,
    { label: 'a hint to be spent' });

  h.click('#btn-new');
  await h.tick(2);

  assert.equal(h.bcp.state.hintsLeft, h.bcp.HINTS_PER_GAME);
  assert.equal(h.$('#btn-hint').disabled, false);
  assert.equal(h.$('#hint-badge').hidden, false);

  h.close();
});

test('the hint the solver gives is a legal, useful move', async () => {
  const h = await fresh();
  const { state, neighbours } = h.bcp;

  const path = h.bcp.solveFromHere();
  assert.ok(path && path.length, 'the solver should find a path');
  assert.ok([...neighbours(state.gap)].includes(path[0]),
    'the first hint must be adjacent to the gap');

  const before = h.bcp.misplaced();
  for (const move of path) h.bcp.slideTo(move, false);
  assert.equal(h.bcp.isSolved(), true, 'following the hints finishes the board');
  assert.ok(before > 0);

  h.close();
});

/* ---------------- settings ---------------- */

test('the settings sheet opens, toggles persist, and it closes', async () => {
  const h = await fresh();
  const sheet = h.$('#settings');

  assert.equal(sheet.hidden, true);
  h.click('#btn-settings');
  await h.tick();
  assert.equal(sheet.hidden, false);

  for (const id of ['#opt-hints', '#opt-symbols', '#opt-sound']) {
    const box = h.$(id);
    const was = box.checked;
    box.checked = !was;
    box.dispatchEvent(new h.win.Event('change', { bubbles: true }));
    await h.tick();
    assert.equal(h.$(id).checked, !was, `${id} did not flip`);
  }

  const store = h.bcp.loadStore();
  assert.equal(store.sound, h.$('#opt-sound').checked, 'toggles are written to storage');
  assert.equal(store.symbols, h.$('#opt-symbols').checked);

  h.click('#btn-settings-close');
  await h.tick();
  assert.equal(sheet.hidden, true);

  h.close();
});

test('the wrong-column highlight follows the hints toggle', async () => {
  const h = await fresh();

  const box = h.$('#opt-hints');
  box.checked = true;
  box.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  await h.tick();
  assert.ok(h.$$('#board .tile.is-wrong').length > 0, 'misplaced tiles should be marked');

  box.checked = false;
  box.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  await h.tick();
  assert.equal(h.$$('#board .tile.is-wrong').length, 0, 'turning it off clears the marks');

  h.close();
});

test('Escape closes an open modal', async () => {
  const h = await fresh();

  for (const [open, id] of [['#btn-settings', '#settings'], ['#btn-help', '#help'],
                            ['#btn-stats', '#stats'], ['#btn-more', '#more']]) {
    h.click(open);
    await h.tick();
    assert.equal(h.$(id).hidden, false, `${id} should have opened`);

    h.key('Escape');
    await h.tick();
    assert.equal(h.$(id).hidden, true, `Escape should have closed ${id}`);
  }

  h.close();
});

/* ---------------- themes ---------------- */

test('switching palette repaints in place without reordering the board', async () => {
  const h = await fresh();

  // Symbols are the colour-blind fallback; turn them on so the assertion that
  // a shape keeps its meaning across palettes is actually testing something.
  const box = h.$('#opt-symbols');
  box.checked = true;
  box.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  await h.tick();

  const order = [...h.bcp.state.board];
  const symbols = h.$$('#board .tile').map(t => t.textContent);
  const moves = h.bcp.state.moves;
  assert.ok(symbols.some(s => s.trim().length > 0), 'symbols should be showing');

  h.bcp.setPalette('accessible');
  await h.tick();

  assert.equal(h.bcp.state.palette, 'accessible');
  assert.deepEqual([...h.bcp.state.board], order, 'tile order must survive a repaint');
  assert.deepEqual(h.$$('#board .tile').map(t => t.textContent), symbols,
    'a shape must keep its meaning across palettes');
  assert.equal(h.bcp.state.moves, moves, 'the game should not restart');

  h.close();
});

test('appearance sets the document theme and survives a reload', async () => {
  const h = await fresh();

  h.bcp.setAppearance('slate');
  await h.tick();
  assert.equal(h.doc.documentElement.dataset.appearance, 'slate');

  const stored = h.storage();
  h.close();

  const again = await fresh({ storage: stored });
  assert.equal(again.doc.documentElement.dataset.appearance, 'slate');
  again.close();
});

// A saved theme id that no longer exists fails the lookup in loadPrefs and
// drops the user back to dark on every refresh, with nothing to explain why.
// This is what happened when Sand was renamed to Amber.
test('a theme renamed after release keeps working for whoever had it', async () => {
  const h = await fresh();
  h.bcp.setAppearance('amber');
  await h.tick();
  const stored = h.storage();
  h.close();

  assert.equal(stored.appearance, 'amber', 'the theme should have been saved at all');

  stored.appearance = 'sand';
  const again = await fresh({ storage: stored });
  assert.equal(again.doc.documentElement.dataset.appearance, 'amber',
    'the old id should forward to the new one, not fall back to the default');
  again.close();
});

// An id that never existed is a different case - there is nothing to forward
// to, so falling back is right. This guards the alias table from swallowing
// genuine rubbish.
test('an unknown theme falls back to the default', async () => {
  const h = await fresh({ storage: { appearance: 'chartreuse' } });
  assert.equal(h.doc.documentElement.dataset.appearance, 'dark');
  h.close();
});

// Ocean was renamed to Jewel when its colours were redrawn, so anyone who had
// picked it needs to land on Jewel rather than be quietly reset to Classic.
test('a palette renamed after release keeps working for whoever had it', async () => {
  const h = await fresh();
  h.bcp.setPalette('jewel');
  await h.tick();
  const stored = h.storage();
  h.close();

  assert.equal(stored.palette, 'jewel', 'the palette should have been saved at all');

  stored.palette = 'ocean';
  const again = await fresh({ storage: stored });
  assert.equal(again.bcp.state.palette, 'jewel',
    'the old id should forward to the new one, not fall back to classic');
  again.close();
});

test('an unknown palette falls back to the default', async () => {
  const h = await fresh({ storage: { palette: 'ultraviolet' } });
  assert.equal(h.bcp.state.palette, 'classic');
  h.close();
});

test('every palette and appearance is offered as a control', async () => {
  const h = await fresh();

  assert.equal(h.$$('#palette-row .swatch').length, Object.keys(h.bcp.PALETTES).length);
  assert.equal(h.$$('#appearance-row .swatch').length, Object.keys(h.bcp.APPEARANCES).length);

  h.close();
});

/* ---------------- accessibility ---------------- */

// A colour name on its own gives a screen reader no way to build a picture of
// the grid: you hear twenty-four colours in a row with nothing to place them
// against, and no clue which ones you could actually move.
test('every block announces its colour and its position', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  const tiles = h.$$('#board .tile');
  assert.equal(tiles.length, state.rows * COLS - 1);

  for (const tile of tiles) {
    const i = Number(tile.dataset.index);
    const label = tile.getAttribute('aria-label');
    const row = Math.floor(i / COLS) + 1;
    const col = (i % COLS) + 1;

    assert.ok(label, `the block at index ${i} has no label at all`);
    assert.ok(label.includes(`row ${row}, column ${col}`),
      `"${label}" should place the block at row ${row}, column ${col}`);
    assert.ok(label.startsWith(h.bcp.palette()[Number(tile.dataset.colour)].name),
      `"${label}" should lead with the colour name`);
  }

  h.close();
});

// Whether a block can move is shown visually by a hover ring, which is no use
// to anyone who cannot see it - and it changes every single move.
test('only the blocks in line with the gap are announced as movable', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;
  const gapRow = Math.floor(state.gap / COLS);
  const gapCol = state.gap % COLS;

  for (const tile of h.$$('#board .tile')) {
    const i = Number(tile.dataset.index);
    const inLine = Math.floor(i / COLS) === gapRow || i % COLS === gapCol;
    const label = tile.getAttribute('aria-label');
    assert.equal(label.endsWith(', movable'), inLine,
      `"${label}" ${inLine ? 'should' : 'should not'} be announced as movable`);
  }

  h.close();
});

// The gap has no element of its own - it is a hole where a button is not - so
// without a live region it is the one piece of state assistive tech can never
// reach, on a board whose entire mechanic is "slide into the hole".
test('the empty slot is announced, and again wherever it moves to', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;
  const status = h.$('#board-status');

  assert.ok(status, 'there should be a live region for board state');
  assert.equal(status.getAttribute('aria-live'), 'polite');

  const said = (i) => `Empty slot row ${Math.floor(i / COLS) + 1}, column ${(i % COLS) + 1}.`;
  assert.equal(status.textContent, said(state.gap), 'the starting position should be announced');

  // Slide the block directly left of the gap into it, so the gap moves.
  const before = state.gap;
  const neighbour = before % COLS === 0 ? before + 1 : before - 1;
  h.bcp.slideTo(neighbour, true);
  await h.tick();

  assert.equal(state.gap, neighbour, 'the move should have happened');
  assert.equal(status.textContent, said(neighbour), 'the new position should be announced');

  h.close();
});

/* ---------------- keyboard navigation ---------------- */

// Twenty-four buttons in the tab order is not navigation, it is a maze. A grid
// gets one tab stop and a cursor, so the board can be reached and left in two
// keystrokes.
test('the whole board is a single tab stop, starting on the gap', async () => {
  const h = await fresh();
  const { state } = h.bcp;

  const tabbable = h.$$('#board [tabindex="0"]');
  assert.equal(tabbable.length, 1, 'exactly one cell should be in the tab order');
  assert.equal(h.bcp.cellEl(state.gap), tabbable[0],
    'the tab stop should start on the empty slot, where the player is looking');

  const others = h.$$('#board .tile').filter(t => t.getAttribute('tabindex') !== '0');
  assert.equal(others.length, h.$$('#board .tile').length - (state.tiles[state.gap] ? 1 : 0));
  for (const t of others) {
    assert.equal(t.getAttribute('tabindex'), '-1', 'every other block must be skipped by Tab');
  }

  h.close();
});

// Without this the board is observable but not playable: a screen reader user
// can hear where the gap is and never reach the block they want to move.
test('the arrow keys walk a cursor around the board', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  // Somewhere off every edge, so all four directions are legal.
  let start = -1;
  for (let i = 0; i < state.rows * COLS; i++) {
    const r = Math.floor(i / COLS), c = i % COLS;
    if (r > 0 && r < state.rows - 1 && c > 0 && c < COLS - 1) { start = i; break; }
  }
  h.bcp.cellEl(start).focus();
  assert.equal(state.focusCell, start, 'focusing a cell should place the cursor on it');

  const moves = [['ArrowRight', 1], ['ArrowLeft', -1], ['ArrowDown', COLS], ['ArrowUp', -COLS]];
  for (const [key, delta] of moves) {
    const from = state.focusCell;
    h.key(key);
    assert.equal(state.focusCell, from + delta, `${key} should move the cursor by ${delta}`);
    assert.equal(h.win.document.activeElement, h.bcp.cellEl(state.focusCell),
      `${key} should move focus with the cursor, not just the bookkeeping`);
    assert.equal(h.$$('#board [tabindex="0"]').length, 1, 'still exactly one tab stop');
  }

  h.close();
});

// The cursor must be able to stop on the gap. Skipping it would jump the cursor
// clean over the one cell the whole game is about finding.
test('the cursor can rest on the empty slot itself', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  const gapSlot = h.bcp.cellEl(state.gap);
  assert.ok(gapSlot, 'the gap should expose something focusable');
  assert.ok(gapSlot.classList.contains('slot'), 'that something is the backing slot');

  const row = Math.floor(state.gap / COLS) + 1;
  const col = (state.gap % COLS) + 1;
  assert.match(gapSlot.getAttribute('aria-label') || '',
    new RegExp(`empty slot,\\s*row ${row}, column ${col}`, 'i'),
    'the focusable gap should say it is the gap, and where');

  // Only the current gap is reachable; the other slots are inert scenery.
  const focusableSlots = h.$$('#board .slot').filter(s => s.hasAttribute('tabindex'));
  assert.deepEqual(focusableSlots, [gapSlot], 'only the gap slot should be focusable');

  h.close();
});

// Focus lives on a DOM node, but a slide renumbers every cell underneath it. If
// the cursor is not re-derived the tab stop drifts onto a different block.
test('the cursor follows the block it just slid', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  const gapBefore = state.gap;
  const target = gapBefore % COLS === 0 ? gapBefore + 1 : gapBefore - 1;
  const tile = h.bcp.cellEl(target);
  tile.focus();
  // Without this the test is vacuous: the cursor defaults to the gap, which is
  // exactly where the block ends up, so a cursor that never updates still looks
  // correct after the slide.
  assert.equal(state.focusCell, target, 'focusing a block should put the cursor on it');

  h.bcp.slideTo(target, true);
  await h.tick();

  assert.equal(state.gap, target, 'the slide should have happened');
  assert.equal(h.win.document.activeElement, tile, 'focus should stay on the block that moved');
  assert.equal(state.focusCell, gapBefore, 'the cursor should have followed it to its new cell');
  assert.equal(tile.getAttribute('tabindex'), '0', 'and it should still be the tab stop');
  assert.equal(h.$$('#board [tabindex="0"]').length, 1, 'still exactly one tab stop');

  h.close();
});

// The original binding - arrows push the neighbouring block into the gap - is
// how everyone plays today. Adding a cursor must not quietly take it away.
test('the arrow keys still push blocks when the board does not have focus', async () => {
  const h = await fresh();
  const { state, COLS } = h.bcp;

  h.win.document.body.focus();
  if (h.win.document.activeElement && h.win.document.activeElement.blur) {
    h.win.document.activeElement.blur();
  }

  const before = state.gap;
  // Pick a direction that actually has a block to pull in. Column 0 has no left
  // neighbour, so ArrowRight would be a no-op there and the board is shuffled
  // randomly on every boot.
  const key = before % COLS === 0 ? 'ArrowLeft' : 'ArrowRight';
  const expected = key === 'ArrowLeft' ? before + 1 : before - 1;

  h.key(key);
  await h.tick();

  assert.equal(state.gap, expected, `${key} should still push a block into the gap`);
  assert.ok(state.moves > 0, 'and it should count as a move');

  h.close();
});

/* ---------------- stats ---------------- */

test('the stats screen fills every card from storage', async () => {
  const h = await fresh();

  h.click('#btn-stats');
  await h.tick();

  const cards = h.$$('#stats-grid .stat-card');
  assert.ok(cards.length >= 16, `expected the full grid, got ${cards.length}`);
  for (const card of cards) {
    assert.ok(card.textContent.trim().length > 0, 'a card was left blank');
  }

  h.close();
});

test('finishing a puzzle records the solve in lifetime stats', async () => {
  const h = await fresh();

  const before = h.bcp.loadStats();
  await autoSolve(h, { record: true });
  assert.equal(h.bcp.isSolved(), true);
  await h.tick(2);

  const after = h.bcp.loadStats();
  assert.equal((after.solved || 0), (before.solved || 0) + 1);
  assert.ok(after.moves > (before.moves || 0), 'moves should accumulate');

  h.close();
});

test('a zero-move finish is not recorded, so it cannot skew the average', async () => {
  const h = await fresh();

  const before = h.bcp.loadStats();
  await autoSolve(h, { record: false });
  assert.equal(h.bcp.isSolved(), true);
  h.bcp.finish();
  await h.tick(2);

  assert.equal(h.bcp.loadStats().solved || 0, before.solved || 0);

  h.close();
});

/* ---------------- winning ---------------- */

test('solving shows the win panel and records a best time', async () => {
  const h = await fresh();

  await autoSolve(h, { record: true });
  await h.tick(2);

  assert.equal(h.bcp.state.solved, true);
  assert.equal(h.$('#win').hidden, false, 'the win panel should be showing');
  assert.ok(h.$('#win-stats').textContent.trim().length > 0);

  const best = h.bcp.getBest(h.bcp.state.rows);
  assert.ok(best && best.ms > 0, 'a best time should have been stored');

  h.close();
});

test('a solved board refuses further slides', async () => {
  const h = await fresh();

  await autoSolve(h, { record: true });
  const board = [...h.bcp.state.board];
  const moves = h.bcp.state.moves;

  h.bcp.slideTo([...h.bcp.neighbours(h.bcp.state.gap)][0], true);
  h.key('ArrowLeft');
  await h.tick();

  assert.deepEqual([...h.bcp.state.board], board, 'the finished board must stay put');
  assert.equal(h.bcp.state.moves, moves);

  h.close();
});

test('restart replays the same puzzle from the start', async () => {
  const h = await fresh();
  const { state, neighbours } = h.bcp;

  const start = [...state.board];
  h.bcp.slideTo([...neighbours(state.gap)][0], true);
  assert.equal(state.moves, 1);

  h.click('#btn-restart');
  await h.tick(2);

  assert.equal(state.moves, 0, 'restart resets the counter');
  // state.seed does not exist, so the old `seed` comparison here was undefined
  // against undefined and passed no matter what restart did. Compare the board.
  assert.deepEqual([...state.board], start, 'restart rebuilds the same puzzle');
  assert.equal(state.history.length, 0);

  h.close();
});

/* ---------------- the board menu ---------------- */

test('restart and new are reached through the board menu, not the action row', async () => {
  const h = await fresh();

  // The row's whole point is to stay short. Pin its membership, or the next
  // person to add a control will quietly put it back to five across.
  const rowIds = [...h.$('.action-row').children].map(b => b.id);
  assert.deepEqual(rowIds, ['btn-undo', 'btn-hint', 'btn-more', 'btn-settings'],
    'the action row holds the two play actions and the two sheet openers');

  // jsdom will happily click a button inside a hidden sheet, so asserting the
  // click works proves nothing. Assert where the buttons actually live.
  assert.equal(h.$('#more').contains(h.$('#btn-restart')), true, 'restart lives in the menu');
  assert.equal(h.$('#more').contains(h.$('#btn-new')), true, 'new lives in the menu');
  assert.equal(h.$('#more').hidden, true, 'the menu starts closed');

  h.click('#btn-more');
  await h.tick();
  assert.equal(h.$('#more').hidden, false, 'the action row must be able to open the menu');

  h.click('#btn-restart');
  await h.tick();
  assert.equal(h.$('#more').hidden, true, 'acting from the menu closes it');

  h.close();
});

test('a board with moves on it is never discarded without asking', async () => {
  const h = await fresh();
  const { neighbours } = h.bcp;

  h.bcp.slideTo([...neighbours(h.bcp.state.gap)][0], true);
  await h.tick();
  const board = [...h.bcp.state.board];
  assert.equal(h.bcp.state.moves, 1);

  h.click('#btn-new');
  await h.tick();
  assert.equal(h.$('#confirm-new').hidden, false, 'progress in play must be defended');
  assert.deepEqual([...h.bcp.state.board], board, 'the board must survive being asked about');

  h.click('#btn-confirm-cancel');
  await h.tick(2);
  assert.equal(h.$('#confirm-new').hidden, true);
  assert.deepEqual([...h.bcp.state.board], board, 'backing out keeps the board');
  assert.equal(h.bcp.state.moves, 1, 'backing out keeps the progress too');

  h.click('#btn-new');
  await h.tick();
  h.click('#btn-confirm-new');
  await h.tick(2);
  assert.equal(h.bcp.state.moves, 0, 'confirming deals a new board');
  assert.notDeepEqual([...h.bcp.state.board], board, 'and it is a different one');

  h.close();
});

test('an untouched board is replaced without a pointless question', async () => {
  const h = await fresh();

  assert.equal(h.bcp.state.moves, 0);
  const board = [...h.bcp.state.board];

  h.click('#btn-new');
  await h.tick(2);

  assert.equal(h.$('#confirm-new').hidden, true, 'nothing was at stake, so do not interrupt');
  assert.notDeepEqual([...h.bcp.state.board], board, 'the new board should just be dealt');

  h.close();
});

test('the menu warns about losing a board before it is chosen, not after', async () => {
  const h = await fresh();
  const { neighbours } = h.bcp;

  // Nothing is at stake yet, so nothing should look alarming.
  h.click('#btn-more');
  await h.tick();
  assert.equal(h.$('#btn-new').classList.contains('btn-danger'), false,
    'an untouched board loses nothing, so do not cry wolf');
  h.click('#btn-more-close');
  await h.tick();

  h.bcp.slideTo([...neighbours(h.bcp.state.gap)][0], true);
  await h.tick();
  assert.equal(h.bcp.state.moves, 1);

  h.click('#btn-more');
  await h.tick();
  assert.equal(h.$('#btn-new').classList.contains('btn-danger'), true,
    'once there is progress to lose, the menu must show which row costs it');

  h.close();
});

/* ---------------- modes ---------------- */
test('the daily is the same board all day and is shareable', async () => {
  const h = await fresh();

  h.bcp.setMode('daily');
  await h.tick(2);
  const board = [...h.bcp.state.board];

  // The reshuffle is not offered at all in daily play. It used to be a greyed
  // row explained only by a title tooltip, which does not exist on touch.
  h.click('#btn-more');
  await h.tick();
  assert.equal(h.$('#btn-new').hidden, true, 'daily must not offer a reshuffle');
  assert.equal(h.$('#daily-note').hidden, false, 'and it must say why, on screen');
  h.click('#btn-more-close');
  await h.tick();

  h.bcp.newGame();
  await h.tick(2);
  assert.deepEqual([...h.bcp.state.board], board, 'the daily must not reroll');

  assert.match(h.bcp.todayKey(), /^\d{4}-\d{2}-\d{2}$/);

  // The share text is the app's public face - it gets pasted into chats. A
  // length check would pass on a stale or blank name, so pin the real shape:
  // title, then the emoji fingerprint, then the stats, then the URL.
  const share = h.bcp.shareText().split('\n');
  assert.equal(share[0], 'Sortile \u2014 ' + h.bcp.todayKey(),
    'the share heading must carry the shipped app name and the day');
  assert.equal(share[1].length > 0, true, 'the emoji strip must be present');
  assert.match(share[2], /moves/);
  assert.match(share[3], /^https?:\/\//, 'the last line must be the site URL');

  h.close();
});

test('solving the daily starts a streak and records the day', async () => {
  const h = await fresh();

  h.bcp.setMode('daily');
  await h.tick(2);
  await autoSolve(h, { record: true });
  await h.tick(2);

  const daily = h.bcp.loadDaily();
  assert.equal(daily.last, h.bcp.todayKey());
  assert.ok(daily.streak >= 1, 'a solve should start the streak');

  h.close();
});

test('a streak continues from yesterday but resets after a gap', async () => {
  const { isPreviousDay } = (await fresh()).bcp;

  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const older = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  assert.equal(isPreviousDay(yesterday, today), true);
  assert.equal(isPreviousDay(older, today), false);
});

test('levels start locked past the first and unlock as they are cleared', async () => {
  const h = await fresh();

  h.bcp.setMode('levels');
  await h.tick(2);

  assert.equal(h.bcp.loadLevels().unlocked || 1, 1, 'only level 1 to begin with');

  h.bcp.playLevel(1);
  await h.tick(2);
  assert.equal(h.bcp.state.level, 1);
  assert.equal(h.bcp.state.rows, h.bcp.levelSpec(1).rows);

  await autoSolve(h, { record: true });
  await h.tick(2);

  const levels = h.bcp.loadLevels();
  assert.ok(levels.unlocked >= 2, 'clearing level 1 should unlock level 2');
  assert.ok(levels.results[1], 'the result should be stored');
  assert.ok(levels.results[1].stars >= 1 && levels.results[1].stars <= 3);

  h.close();
});

test('the level picker lists every level', async () => {
  const h = await fresh();

  h.bcp.setMode('levels');
  await h.tick();
  h.bcp.openLevelPicker();
  await h.tick();

  assert.equal(h.$('#levels').hidden, false);
  assert.equal(h.$$('#levels-grid button').length, h.bcp.LEVEL_COUNT);

  h.close();
});

/* ---------------- persistence ---------------- */

test('preferences, stats and progress all survive a fresh boot', async () => {
  const h = await fresh();

  h.bcp.setPalette('candy');
  h.bcp.setAppearance('midnight');
  h.bcp.bumpStats({ solved: 1, moves: 42, ms: 1000 });
  await h.tick();

  const stored = h.storage();
  h.close();

  const again = await fresh({ storage: stored });
  assert.equal(again.bcp.state.palette, 'candy');
  assert.equal(again.doc.documentElement.dataset.appearance, 'midnight');

  const stats = again.bcp.loadStats();
  assert.equal(stats.solved, 1);
  assert.equal(stats.moves, 42);

  again.close();
});

test('a corrupt store is ignored rather than crashing the game', async () => {
  const h = await boot();
  h.win.localStorage.setItem('bcp.v1', '{not json');

  assert.doesNotThrow(() => h.bcp.loadStore());
  assert.doesNotThrow(() => h.bcp.loadStats());
  assert.doesNotThrow(() => h.bcp.loadPrefs());

  h.close();
});
