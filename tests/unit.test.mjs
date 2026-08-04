/*
 * Unit tests - pure logic, driven through the real game's test hook.
 *
 * These deliberately exercise the shipped game.js rather than a copy, so a
 * refactor that changes behaviour fails here rather than silently passing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, nums } from './helpers/boot.mjs';

let h;
test.before(async () => { h = await boot(); });
test.after(() => h.close());

/* ---------------- seeded randomness ---------------- */

test('seedFrom is deterministic and separates similar inputs', () => {
  const { seedFrom } = h.bcp;
  assert.equal(seedFrom('2026-08-04'), seedFrom('2026-08-04'));
  assert.notEqual(seedFrom('2026-08-04'), seedFrom('2026-08-05'));
  assert.notEqual(seedFrom('ab'), seedFrom('ba'));
  assert.ok(Number.isInteger(seedFrom('x')));
});

test('mulberry32 replays the same stream for the same seed', () => {
  const { mulberry32 } = h.bcp;
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const c = mulberry32(12346);

  const first = Array.from({ length: 50 }, () => a());
  const second = Array.from({ length: 50 }, () => b());
  const third = Array.from({ length: 50 }, () => c());

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, third);
  for (const v of first) assert.ok(v >= 0 && v < 1, `${v} out of range`);
});

test('mulberry32 does not immediately repeat itself', () => {
  const rng = h.bcp.mulberry32(7);
  const seen = new Set(Array.from({ length: 500 }, () => rng()));
  assert.ok(seen.size > 490, `only ${seen.size} distinct values in 500 draws`);
});

test('shuffled permutes without losing or duplicating members', () => {
  const { shuffled, mulberry32 } = h.bcp;
  const input = [0, 1, 2, 3, 4, 5, 6, 7];
  const out = shuffled(input, mulberry32(99));

  assert.deepEqual(nums(out), input);
  assert.deepEqual(input, [0, 1, 2, 3, 4, 5, 6, 7], 'input was mutated');
  assert.deepEqual([...out], [...shuffled(input, mulberry32(99))], 'not deterministic');
});

/* ---------------- formatting ---------------- */

test('formatTime renders m:ss and floors partial seconds', () => {
  const { formatTime } = h.bcp;
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(999), '0:00');
  assert.equal(formatTime(1000), '0:01');
  assert.equal(formatTime(59_000), '0:59');
  assert.equal(formatTime(60_000), '1:00');
  assert.equal(formatTime(3_723_000), '62:03');
});

test('formatLong steps through seconds, minutes and hours', () => {
  const { formatLong } = h.bcp;
  assert.equal(formatLong(0), '\u2014');
  assert.equal(formatLong(5_000), '5s');
  assert.equal(formatLong(65_000), '1m 5s');
  assert.equal(formatLong(3_600_000), '1h 0m');
  assert.equal(formatLong(7_830_000), '2h 10m');
});

/* ---------------- daily streak maths ---------------- */

test('isPreviousDay only accepts exactly one day earlier', () => {
  const { isPreviousDay } = h.bcp;
  assert.ok(isPreviousDay('2026-08-03', '2026-08-04'));
  assert.ok(isPreviousDay('2026-02-28', '2026-03-01'), 'month boundary');
  assert.ok(isPreviousDay('2025-12-31', '2026-01-01'), 'year boundary');
  assert.ok(!isPreviousDay('2026-08-02', '2026-08-04'), 'two-day gap');
  assert.ok(!isPreviousDay('2026-08-04', '2026-08-04'), 'same day');
  assert.ok(!isPreviousDay('2026-08-05', '2026-08-04'), 'backwards');
});

test('isPreviousDay is unaffected by a leap day', () => {
  assert.ok(h.bcp.isPreviousDay('2028-02-28', '2028-02-29'));
  assert.ok(h.bcp.isPreviousDay('2028-02-29', '2028-03-01'));
});

/* ---------------- stars ---------------- */

test('starsFor gives 3 at or under par, 2 near it, 1 beyond', () => {
  const { starsFor } = h.bcp;
  assert.equal(starsFor(10, 20), 3);
  assert.equal(starsFor(20, 20), 3, 'exactly par still earns three');
  assert.equal(starsFor(21, 20), 2);
  assert.equal(starsFor(32, 20), 2, 'par * 1.6 is the upper edge of two');
  assert.equal(starsFor(33, 20), 1);
  assert.equal(starsFor(9999, 20), 1, 'never zero once finished');
});

/* ---------------- level ramp ---------------- */

test('levelSpec grows the board in three tiers', () => {
  const { levelSpec } = h.bcp;
  for (let n = 1; n <= 8; n++) assert.equal(levelSpec(n).rows, 4, `level ${n}`);
  for (let n = 9; n <= 16; n++) assert.equal(levelSpec(n).rows, 5, `level ${n}`);
  for (let n = 17; n <= 24; n++) assert.equal(levelSpec(n).rows, 6, `level ${n}`);
});

test('levelSpec depth rises within each block and never goes below the floor', () => {
  const { levelSpec } = h.bcp;
  for (const start of [1, 9, 17]) {
    for (let n = start; n < start + 7; n++) {
      const a = levelSpec(n).depth;
      const b = levelSpec(n + 1).depth;
      assert.ok(b > a, `level ${n + 1} (${b}) should be deeper than ${n} (${a})`);
    }
  }
  for (let n = 1; n <= 24; n++) {
    assert.ok(levelSpec(n).depth >= 4, `level ${n} below the floor`);
  }
});

test('the last level of a block is as scrambled as free play', () => {
  const { levelSpec, SCRAMBLE_PER_CELL, COLS } = h.bcp;
  for (const [n, rows] of [[8, 4], [16, 5], [24, 6]]) {
    assert.equal(levelSpec(n).depth, rows * COLS * SCRAMBLE_PER_CELL);
  }
});

/* ---------------- board geometry ---------------- */

test('neighbours respects the walls', () => {
  const { neighbours, state, COLS } = h.bcp;
  const rows = state.rows;
  const last = rows * COLS - 1;

  assert.deepEqual(nums(neighbours(0)), [1, COLS], 'top-left');
  assert.deepEqual(nums(neighbours(COLS - 1)),
    [COLS - 2, COLS - 1 + COLS], 'top-right');
  assert.deepEqual(nums(neighbours(last)),
    [last - COLS, last - 1], 'bottom-right');

  const middle = COLS + 2;
  assert.equal(neighbours(middle).length, 4, 'an interior cell has four');
});

/* ---------------- the solvability invariant ---------------- */

test('a freshly built board is solved by construction', () => {
  const { buildSolved, mulberry32, isSolved, misplaced } = h.bcp;
  for (let seed = 0; seed < 25; seed++) {
    buildSolved(mulberry32(seed));
    assert.ok(isSolved(), `seed ${seed} did not build solved`);
    assert.equal(misplaced(), 0);
  }
});

test('scrambling only ever uses legal slides, so every board stays solvable', () => {
  const { buildSolved, scramble, mulberry32, solveFromHere, isSolved, state,
          renderGuide, renderBoard, slideTo } = h.bcp;

  for (let seed = 0; seed < 12; seed++) {
    const rng = mulberry32(seed);
    buildSolved(rng);
    scramble(rng, 200);
    // newGame() is bypassed here so the scramble depth stays fixed, so clear
    // the solved latch by hand -- slideTo is a no-op while it is set.
    state.solved = false;
    // slideTo drives the DOM, so the tiles have to match the scrambled board.
    renderGuide();
    renderBoard();

    const path = solveFromHere();
    assert.ok(path && path.length, `seed ${seed} produced an unsolvable board`);

    for (const move of path) slideTo(move, false);
    assert.ok(isSolved(), `seed ${seed} solver path did not finish the board`);
  }
});

test('the board always holds exactly one gap', () => {
  const { buildSolved, scramble, mulberry32, state } = h.bcp;
  const rng = mulberry32(4);
  buildSolved(rng);
  scramble(rng, 500);

  const gaps = state.board.filter(v => v === null).length;
  assert.equal(gaps, 1);
  assert.equal(state.board[state.gap], null, 'state.gap disagrees with the board');
});

test('scrambling preserves the colour census', () => {
  const { buildSolved, scramble, mulberry32, state } = h.bcp;
  const census = board => {
    const c = {};
    for (const v of board) if (v !== null) c[v] = (c[v] || 0) + 1;
    return c;
  };

  const rng = mulberry32(11);
  buildSolved(rng);
  const before = census(state.board);
  scramble(rng, 400);

  assert.deepEqual(census(state.board), before);
});
