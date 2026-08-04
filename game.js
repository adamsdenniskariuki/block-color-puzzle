/*
 * Block Color Puzzle
 * ------------------
 * Board: COLS columns x ROWS playable rows, plus a locked guide row on top.
 * The guide row shows the target colour for each column.
 * One cell is empty. Tap a block sharing a row/column with the gap to slide it in.
 * Solved when every block matches the guide colour above its column.
 *
 * Because the board starts solved and is scrambled only with legal slides,
 * every generated puzzle is guaranteed solvable.
 */
(() => {
  'use strict';

  const COLORS = [
    { name: 'Red',    hex: '#e53935', sym: '\u25CF' },
    { name: 'Green',  hex: '#00897b', sym: '\u25B2' },
    { name: 'Blue',   hex: '#1e88e5', sym: '\u25A0' },
    { name: 'Purple', hex: '#8e24aa', sym: '\u25C6' },
    { name: 'Amber',  hex: '#fbc02d', sym: '\u2605' }
  ];

  const COLS = COLORS.length;       // one column per colour
  const STORAGE_KEY = 'bcp.v1';
  const SCRAMBLE_PER_CELL = 24;     // scramble slides, scaled by board size

  const el = {
    guide:    document.getElementById('guide'),
    board:    document.getElementById('board'),
    time:     document.getElementById('stat-time'),
    moves:    document.getElementById('stat-moves'),
    best:     document.getElementById('stat-best'),
    win:      document.getElementById('win'),
    winStats: document.getElementById('win-stats'),
    winBest:  document.getElementById('win-best'),
    help:     document.getElementById('help'),
    undo:     document.getElementById('btn-undo'),
    hints:    document.getElementById('opt-hints'),
    symbols:  document.getElementById('opt-symbols'),
    sound:    document.getElementById('opt-sound'),
    haptics:  document.getElementById('opt-haptics'),
    hapticsWrap: document.getElementById('opt-haptics-wrap'),
    confetti: document.getElementById('confetti')
  };

  const FX = window.BCPFX;

  const state = {
    rows: 5,
    guide: [],        // COLS entries: target colour index per column
    board: [],        // rows*COLS entries: colour index, or null for the gap
    initial: null,    // snapshot for Restart
    gap: 0,
    moves: 0,
    history: [],      // gap positions, newest last
    tiles: [],        // cell index -> tile element (or null)
    startedAt: 0,
    elapsed: 0,
    timerId: null,
    solved: false
  };

  /* ---------------- persistence ---------------- */

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }

  function saveStore(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch { /* private mode - ignore */ }
  }

  function bestKey() { return 'best' + state.rows; }

  function getBest() { return loadStore()[bestKey()] || null; }

  function recordBest(ms, moves) {
    const store = loadStore();
    const prev = store[bestKey()];
    if (prev && prev.ms <= ms) return false;
    store[bestKey()] = { ms, moves };
    saveStore(store);
    return true;
  }

  function loadPrefs() {
    const store = loadStore();
    el.hints.checked = !!store.hints;
    el.symbols.checked = !!store.symbols;
    // Sound and vibration are on unless explicitly turned off.
    el.sound.checked = store.sound !== false;
    el.haptics.checked = store.haptics !== false;
    if (store.rows && [4, 5, 6].includes(store.rows)) state.rows = store.rows;
    applyFxPrefs();
  }

  function savePrefs() {
    const store = loadStore();
    store.hints = el.hints.checked;
    store.symbols = el.symbols.checked;
    store.sound = el.sound.checked;
    store.haptics = el.haptics.checked;
    store.rows = state.rows;
    saveStore(store);
  }

  function applyFxPrefs() {
    FX.sound.enabled = el.sound.checked;
    FX.haptics.enabled = el.haptics.checked;
  }

  /* ---------------- helpers ---------------- */

  const rowOf = i => Math.floor(i / COLS);
  const colOf = i => i % COLS;
  const cellCount = () => state.rows * COLS;

  function shuffled(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  /* ---------------- puzzle generation ---------------- */

  function buildSolved() {
    // Randomise which colour sits above which column so the layout varies.
    state.guide = shuffled(COLORS.map((_, i) => i));

    const board = new Array(cellCount());
    for (let i = 0; i < board.length; i++) board[i] = state.guide[colOf(i)];

    // Remove one block to create the gap; that colour ends up one short.
    const gap = Math.floor(Math.random() * board.length);
    board[gap] = null;

    state.board = board;
    state.gap = gap;
  }

  function neighbours(index) {
    const r = rowOf(index);
    const c = colOf(index);
    const out = [];
    if (r > 0) out.push(index - COLS);
    if (r < state.rows - 1) out.push(index + COLS);
    if (c > 0) out.push(index - 1);
    if (c < COLS - 1) out.push(index + 1);
    return out;
  }

  function scramble() {
    const steps = cellCount() * SCRAMBLE_PER_CELL;
    let previousGap = -1;

    for (let n = 0; n < steps; n++) {
      const options = neighbours(state.gap).filter(i => i !== previousGap);
      const pick = options[Math.floor(Math.random() * options.length)];
      previousGap = state.gap;
      state.board[state.gap] = state.board[pick];
      state.board[pick] = null;
      state.gap = pick;
    }
  }

  function isSolved() {
    for (let i = 0; i < state.board.length; i++) {
      const v = state.board[i];
      if (v === null) continue;
      if (v !== state.guide[colOf(i)]) return false;
    }
    return true;
  }

  /* ---------------- rendering ---------------- */

  function renderGuide() {
    el.guide.innerHTML = '';
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'guide-cell';
      cell.style.setProperty('--c', COLORS[state.guide[c]].hex);
      cell.textContent = el.symbols.checked ? COLORS[state.guide[c]].sym : '';
      cell.title = COLORS[state.guide[c]].name;
      el.guide.appendChild(cell);
    }
  }

  function renderBoard() {
    el.board.innerHTML = '';
    state.tiles = new Array(cellCount()).fill(null);

    // Static backing slots so empty cells read as recesses in the frame.
    for (let i = 0; i < cellCount(); i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.transform = translateFor(i);
      el.board.appendChild(slot);
    }

    for (let i = 0; i < cellCount(); i++) {
      const colour = state.board[i];
      if (colour === null) continue;

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.style.setProperty('--c', COLORS[colour].hex);
      tile.style.transform = translateFor(i);
      tile.dataset.index = String(i);
      tile.dataset.colour = String(colour);
      tile.textContent = el.symbols.checked ? COLORS[colour].sym : '';
      tile.setAttribute('aria-label', COLORS[colour].name);
      tile.addEventListener('click', () => {
        if (fromSwipe()) return;
        slideTo(Number(tile.dataset.index), true);
      });

      el.board.appendChild(tile);
      state.tiles[i] = tile;
    }

    layout();
    refreshTileState();
  }

  function metrics() {
    const wrap = el.board.parentElement;
    const cs = getComputedStyle(wrap);
    const inset = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const wrapWidth = wrap.clientWidth - inset;
    const gutter = state.rows >= 6 ? 5 : 6;
    const cell = Math.floor((wrapWidth - gutter * (COLS - 1)) / COLS);
    return { cell: Math.max(34, Math.min(cell, 78)), gutter };
  }

  function translateFor(index) {
    const { cell, gutter } = metrics();
    const x = colOf(index) * (cell + gutter);
    const y = rowOf(index) * (cell + gutter);
    return `translate(${x}px, ${y}px)`;
  }

  function layout() {
    const { cell, gutter } = metrics();
    const root = document.documentElement;
    root.style.setProperty('--cell', cell + 'px');
    root.style.setProperty('--gutter', gutter + 'px');
    root.style.setProperty('--cols', String(COLS));
    root.style.setProperty('--rows', String(state.rows));

    el.board.querySelectorAll('.slot').forEach((slot, i) => {
      slot.style.transform = translateFor(i);
    });
    state.tiles.forEach((tile, i) => {
      if (tile) tile.style.transform = translateFor(i);
    });
  }

  function refreshTileState() {
    const showHints = el.hints.checked;
    const gapRow = rowOf(state.gap);
    const gapCol = colOf(state.gap);

    state.tiles.forEach((tile, i) => {
      if (!tile) return;
      const movable = rowOf(i) === gapRow || colOf(i) === gapCol;
      tile.classList.toggle('is-movable', movable && !state.solved);
      const wrong = Number(tile.dataset.colour) !== state.guide[colOf(i)];
      tile.classList.toggle('is-wrong', showHints && wrong && !state.solved);
    });

    el.board.classList.toggle('is-solved', state.solved);
    el.undo.disabled = state.history.length === 0 || state.solved;
  }

  /* ---------------- moves ---------------- */

  // Shake a block that cannot go anywhere, so a dead tap still feels answered.
  function nudge(index) {
    const tile = state.tiles[index];
    if (tile) {
      tile.classList.remove('is-nudge');
      void tile.offsetWidth;
      tile.classList.add('is-nudge');
    }
    FX.sound.bump();
    FX.haptics.bump();
  }

  function slideTo(target, record) {
    if (state.solved) return;
    if (target === state.gap) return;

    const sameRow = rowOf(target) === rowOf(state.gap);
    const sameCol = colOf(target) === colOf(state.gap);
    if (!sameRow && !sameCol) {
      nudge(target);
      return;
    }

    const gapBefore = state.gap;
    const stride = sameRow ? 1 : COLS;
    const step = target < state.gap ? -stride : stride;

    let cursor = state.gap;
    let moved = 0;
    while (cursor !== target) {
      const next = cursor + step;
      const tile = state.tiles[next];

      state.board[cursor] = state.board[next];
      state.board[next] = null;
      state.tiles[cursor] = tile;
      state.tiles[next] = null;

      tile.dataset.index = String(cursor);
      tile.style.transform = translateFor(cursor);

      cursor = next;
      moved++;
    }

    state.gap = target;

    if (record) {
      state.history.push(gapBefore);
      state.moves += moved;
      FX.sound.slide(moved);
      FX.haptics.slide(moved);
      startTimer();
      updateHud();
    }

    if (isSolved()) finish();
    else refreshTileState();

    return moved;
  }

  function undo() {
    if (!state.history.length || state.solved) return;
    // A slide is its own inverse: pushing the gap back where it came from
    // restores every tile in the run, so we only need the previous gap index.
    const target = state.history.pop();
    const moved = slideTo(target, false) || 0;
    state.moves = Math.max(0, state.moves - moved);
    FX.sound.click();
    FX.haptics.slide(1);
    updateHud();
    refreshTileState();
  }

  /* ---------------- timer + hud ---------------- */

  function startTimer() {
    if (state.timerId) return;
    state.startedAt = Date.now() - state.elapsed;
    state.timerId = setInterval(() => {
      state.elapsed = Date.now() - state.startedAt;
      el.time.textContent = formatTime(state.elapsed);
    }, 250);
  }

  function stopTimer() {
    if (!state.timerId) return;
    clearInterval(state.timerId);
    state.timerId = null;
    state.elapsed = Date.now() - state.startedAt;
  }

  function updateHud() {
    el.moves.textContent = String(state.moves);
    el.time.textContent = formatTime(state.elapsed);
    const best = getBest();
    el.best.textContent = best ? formatTime(best.ms) : '\u2014';
  }

  function finish() {
    state.solved = true;
    stopTimer();
    refreshTileState();

    const isNewBest = recordBest(state.elapsed, state.moves);
    el.winStats.textContent = `${formatTime(state.elapsed)}  ·  ${state.moves} moves`;
    el.winBest.hidden = !isNewBest;
    el.win.hidden = false;
    updateHud();

    FX.sound.win();
    FX.haptics.win();
    FX.confetti.burst(COLORS.map(c => c.hex));
  }

  /* ---------------- lifecycle ---------------- */

  function newGame() {
    stopTimer();
    state.elapsed = 0;
    state.moves = 0;
    state.history = [];
    state.solved = false;
    el.win.hidden = true;
    FX.confetti.clear();

    buildSolved();
    scramble();
    if (isSolved()) scramble();

    state.initial = { board: state.board.slice(), gap: state.gap, guide: state.guide.slice() };

    renderGuide();
    renderBoard();
    updateHud();
  }

  function restart() {
    if (!state.initial) return;
    stopTimer();
    state.elapsed = 0;
    state.moves = 0;
    state.history = [];
    state.solved = false;
    el.win.hidden = true;
    FX.confetti.clear();

    state.board = state.initial.board.slice();
    state.gap = state.initial.gap;
    state.guide = state.initial.guide.slice();

    renderGuide();
    renderBoard();
    updateHud();
  }

  /* ---------------- input wiring ---------------- */

  document.getElementById('btn-new').addEventListener('click', newGame);
  document.getElementById('btn-restart').addEventListener('click', restart);
  document.getElementById('btn-win-new').addEventListener('click', newGame);
  el.undo.addEventListener('click', undo);

  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.rows = Number(btn.dataset.rows);
      savePrefs();
      newGame();
    });
  });

  el.hints.addEventListener('change', () => { savePrefs(); refreshTileState(); });
  el.sound.addEventListener('change', () => {
    savePrefs();
    applyFxPrefs();
    if (el.sound.checked) FX.sound.click();
  });
  el.haptics.addEventListener('change', () => {
    savePrefs();
    applyFxPrefs();
    if (el.haptics.checked) FX.haptics.slide(2);
  });
  el.symbols.addEventListener('change', () => {
    savePrefs();
    renderGuide();
    state.tiles.forEach(tile => {
      if (tile) tile.textContent = el.symbols.checked ? COLORS[Number(tile.dataset.colour)].sym : '';
    });
  });

  document.getElementById('btn-help').addEventListener('click', () => { el.help.hidden = false; });
  document.getElementById('btn-help-close').addEventListener('click', () => { el.help.hidden = true; });
  el.help.addEventListener('click', e => { if (e.target === el.help) el.help.hidden = true; });

  // Arrow keys push a block in the pressed direction, into the gap.
  document.addEventListener('keydown', e => {
    const map = {
      ArrowRight: -1,
      ArrowLeft:  1,
      ArrowDown:  -COLS,
      ArrowUp:    COLS
    };
    if (!(e.key in map)) return;

    const source = state.gap + map[e.key];
    if (source < 0 || source >= cellCount()) return;
    // Horizontal moves must stay on the gap's row.
    if (Math.abs(map[e.key]) === 1 && rowOf(source) !== rowOf(state.gap)) return;

    e.preventDefault();
    slideTo(source, true);
  });

  window.addEventListener('resize', () => { layout(); FX.confetti.resize(); });

  /* ---------------- swipe ---------------- */

  const SWIPE_MIN = 18;         // px before a drag counts as a swipe
  let swipe = null;
  let swipeEndedAt = 0;

  // A swipe fires pointerup then click; ignore the click that trails a swipe.
  function fromSwipe() { return Date.now() - swipeEndedAt < 400; }

  el.board.addEventListener('pointerdown', e => {
    if (state.solved) return;
    const tile = e.target.closest('.tile');
    swipe = {
      x: e.clientX,
      y: e.clientY,
      index: tile ? Number(tile.dataset.index) : -1
    };
  });

  el.board.addEventListener('pointerup', e => {
    if (!swipe) return;
    const start = swipe;
    swipe = null;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) < SWIPE_MIN) return;   // a tap - let the click handler run

    swipeEndedAt = Date.now();
    applySwipe(dx, dy, start.index);
  });

  el.board.addEventListener('pointercancel', () => { swipe = null; });
  el.board.addEventListener('pointerleave', () => { swipe = null; });

  function applySwipe(dx, dy, startIndex) {
    if (state.solved) return;

    const horizontal = Math.abs(dx) > Math.abs(dy);
    const gapRow = rowOf(state.gap);
    const gapCol = colOf(state.gap);

    // A drag that starts on a block only ever moves that block's own run.
    // If the block cannot reach the gap, nothing else on the board may move -
    // otherwise dragging a dead tile would shove some unrelated block instead.
    if (startIndex >= 0) {
      if (startIndex === state.gap) return;

      const aligned = horizontal
        ? rowOf(startIndex) === gapRow
        : colOf(startIndex) === gapCol;
      if (!aligned) { nudge(startIndex); return; }

      const towardGap = state.gap > startIndex ? 1 : -1;
      if (Math.sign(horizontal ? dx : dy) !== towardGap) { nudge(startIndex); return; }

      slideTo(startIndex, true);
      return;
    }

    // Swiping empty board space pushes one block in, exactly like the arrow keys.
    const step = horizontal ? (dx > 0 ? -1 : 1) : (dy > 0 ? -COLS : COLS);
    const source = state.gap + step;

    if (source < 0 || source >= cellCount()) { rejectSwipe(); return; }
    if (horizontal && rowOf(source) !== gapRow) { rejectSwipe(); return; }

    slideTo(source, true);
  }

  function rejectSwipe() {
    FX.sound.bump();
    FX.haptics.bump();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });
  }

  /* ---------------- boot ---------------- */

  FX.confetti.attach(el.confetti);
  if (FX.haptics.supported) el.hapticsWrap.hidden = false;

  loadPrefs();
  document.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('is-active', Number(b.dataset.rows) === state.rows);
  });
  newGame();
})();
