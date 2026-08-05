/*
 * Palette tests: the colours have to be far enough apart to play with.
 *
 * The whole game is "tell these five colours apart", so a palette whose colours
 * sit close together is not a style choice, it is a difficulty bug. The first
 * Ocean palette shipped with a blue and an indigo only dE 20 apart -- roughly a
 * third of the separation Classic gives -- and nothing caught it because no test
 * looked at the colours themselves.
 *
 * Distance is CIELAB dE76. It is the crude one, but it needs no dependencies and
 * the thresholds here are far enough apart that the extra precision of dE2000
 * would not change any verdict.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/boot.mjs';

/** sRGB channel (0-255) to linear light. */
function linear(v) {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' to CIELAB, D65. */
function lab(hex) {
  const r = linear(parseInt(hex.slice(1, 3), 16));
  const g = linear(parseInt(hex.slice(3, 5), 16));
  const b = linear(parseInt(hex.slice(5, 7), 16));
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* Classic sits at 59. Accessible is the Okabe-Ito set: it trades raw separation
 * for colour-blind safety and lands at 33, so it gets its own lower floor that
 * it must not drop below either. */
const WITHIN_FLOOR = 45;
const OKABE_ITO_FLOOR = 33;

/* Between palettes, slot for slot. Accessible is again the exception: its five
 * colours are fixed by the standard, and they happen to sit near Classic's
 * (28.4 apart), which is not something we can design away without giving up
 * colour-blind safety. Every other pairing is ours to choose, so it gets the
 * higher floor -- that is the one that catches "this palette is just the last
 * one with the saturation turned down". */
const BETWEEN_FLOOR = 30;
const BETWEEN_FLOOR_FIXED = 25;

test('every palette keeps its five colours far enough apart to play with', async () => {
  const { bcp } = await boot();
  for (const [id, def] of Object.entries(bcp.PALETTES)) {
    const floor = id === 'accessible' ? OKABE_ITO_FLOOR : WITHIN_FLOOR;
    const labs = def.colours.map(c => lab(c.hex));
    let worst = Infinity;
    let pair = '';
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const d = dE(labs[i], labs[j]);
        if (d < worst) {
          worst = d;
          pair = `${def.colours[i].name}/${def.colours[j].name}`;
        }
      }
    }
    assert.ok(
      worst >= floor,
      `${id}: ${pair} are only dE ${worst.toFixed(1)} apart, floor is ${floor}`
    );
  }
});

test('the palettes look different from each other, not just differently saturated', async () => {
  const { bcp } = await boot();
  const ids = Object.keys(bcp.PALETTES);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = bcp.PALETTES[ids[i]].colours.map(c => lab(c.hex));
      const b = bcp.PALETTES[ids[j]].colours.map(c => lab(c.hex));
      const avg = a.reduce((sum, x, k) => sum + dE(x, b[k]), 0) / a.length;
      const fixed = ids[i] === 'accessible' || ids[j] === 'accessible';
      const floor = fixed ? BETWEEN_FLOOR_FIXED : BETWEEN_FLOOR;
      assert.ok(
        avg >= floor,
        `${ids[i]} and ${ids[j]} average only dE ${avg.toFixed(1)} apart slot for slot, floor is ${floor}`
      );
    }
  }
});

test('every palette has one colour per column and no duplicates', async () => {
  const { bcp } = await boot();
  for (const [id, def] of Object.entries(bcp.PALETTES)) {
    assert.equal(def.colours.length, bcp.COLS, `${id} needs one colour per column`);
    const hexes = new Set(def.colours.map(c => c.hex.toLowerCase()));
    assert.equal(hexes.size, def.colours.length, `${id} repeats a colour`);
    const names = new Set(def.colours.map(c => c.name));
    assert.equal(names.size, def.colours.length, `${id} repeats a colour name`);
    for (const c of def.colours) {
      assert.match(c.hex, /^#[0-9a-f]{6}$/i, `${id}: ${c.name} is not a 6-digit hex`);
    }
  }
});

test('a palette renamed after release still loads from a saved pref', async () => {
  const { bcp } = await boot();
  for (const [old, current] of Object.entries(bcp.PALETTE_ALIASES)) {
    assert.ok(
      !bcp.PALETTES[old],
      `${old} is still a real palette, so it does not need an alias`
    );
    assert.ok(
      bcp.PALETTES[current],
      `${old} forwards to ${current}, which does not exist`
    );
  }
});
