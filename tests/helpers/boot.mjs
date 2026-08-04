/*
 * Boots the real game inside jsdom.
 *
 * The point is to test the shipped files, not a copy of their logic, so this
 * loads index.html and the actual scripts. The URL is 127.0.0.1 because
 * game.js only publishes its window.__bcp test hook on localhost.
 *
 * jsdom has no layout engine and no audio, so a few browser APIs are stubbed.
 * Nothing in the game itself is stubbed.
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function audioStub() {
  const param = {
    value: 0,
    setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}
  };
  return new Proxy({ gain: param, frequency: param, type: '', value: 0 }, {
    get: (t, k) => (k in t ? t[k] : () => audioStub())
  });
}

/** Flush pending rAF/timeout work. */
export function tick(w, n = 1) {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => new Promise(r => w.setTimeout(r, 0)));
  return p;
}

/*
 * Arrays and objects created inside jsdom carry jsdom's prototypes, so
 * assert.deepStrictEqual rejects them against a native literal even when the
 * contents match. Copy anything crossing the boundary before asserting on it.
 */
export const plain = v => (Array.isArray(v) ? [...v] : v);
export const nums = v => [...v].sort((a, b) => a - b);

/**
 * @param {object} [opts]
 * @param {object} [opts.storage] Object preloaded into localStorage as bcp.v1.
 * @param {boolean} [opts.reducedMotion] Report prefers-reduced-motion as on.
 * @param {number} [opts.width] Reported viewport width.
 * @param {number} [opts.height] Reported viewport height.
 */
export async function boot(opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8123/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });

  const w = dom.window;

  w.matchMedia = q => ({
    matches: /reduced-motion/.test(q) ? !!opts.reducedMotion : false,
    media: q,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  });

  w.AudioContext = class {
    constructor() { this.state = 'running'; }
    get currentTime() { return 0; }
    get destination() { return audioStub(); }
    createGain() { return audioStub(); }
    createOscillator() { return audioStub(); }
    createBuffer() { return audioStub(); }
    createBufferSource() { return audioStub(); }
    resume() { return Promise.resolve(); }
  };
  w.webkitAudioContext = w.AudioContext;

  // Confetti draws to a canvas jsdom cannot rasterise. The game only writes to
  // the 2D context and never reads pixels back, so a no-op keeps it happy.
  w.HTMLCanvasElement.prototype.getContext = () => audioStub();

  if (opts.width) Object.defineProperty(w, 'innerWidth', { value: opts.width, configurable: true });
  if (opts.height) Object.defineProperty(w, 'innerHeight', { value: opts.height, configurable: true });

  if (opts.storage) w.localStorage.setItem('bcp.v1', JSON.stringify(opts.storage));

  for (const file of ['fx.js', 'solver.js', 'game.js']) {
    const s = w.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, file), 'utf8');
    w.document.body.appendChild(s);
  }

  await tick(w, 2);

  if (!w.__bcp) throw new Error('game did not publish its test hook');

  return {
    win: w,
    doc: w.document,
    bcp: w.__bcp,
    solver: w.BCPSolver,
    tick: (n = 1) => tick(w, n),
    storage: () => JSON.parse(w.localStorage.getItem('bcp.v1') || '{}'),
    $: sel => w.document.querySelector(sel),
    $$: sel => [...w.document.querySelectorAll(sel)],
    click: sel => w.document.querySelector(sel).dispatchEvent(
      new w.MouseEvent('click', { bubbles: true, cancelable: true })),
    key: k => w.document.dispatchEvent(
      new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })),
    close: () => w.close()
  };
}

/** Drive the game to solved using its own solver. Returns the slide count. */
export async function autoSolve(harness, { record = true, limit = 800 } = {}) {
  const { bcp } = harness;
  let steps = 0;
  while (!bcp.isSolved() && steps < limit) {
    const path = bcp.solveFromHere();
    if (!path || !path.length) break;
    bcp.slideTo(path[0], record);
    steps++;
  }
  await harness.tick(2);
  return steps;
}
