/*
 * Sortile
 * -------
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

  // Symbols are keyed by colour index, not by palette, so switching palette
  // never changes what a shape means.
  const SYMBOLS = ['\u25CF', '\u25B2', '\u25A0', '\u25C6', '\u2605'];

  // Every palette needs five colours that stay distinguishable at tile size, and
  // the palettes need to be distinguishable from *each other* or switching just
  // looks like a saturation slider. Both are enforced by tests/palette.test.mjs,
  // which measures CIELAB distance -- the original Ocean set failed the first
  // rule (its blue and indigo were dE 20 apart) because "ocean" forces five
  // cool hues into a corner of the wheel. "Accessible" is the Okabe-Ito set,
  // chosen so the three common forms of colour blindness still separate all
  // five, and it is exempt from the within-palette floor for that reason.
  const PALETTES = {
    classic: {
      name: 'Classic',
      colours: [
        { name: 'Red',    hex: '#e53935' },
        { name: 'Green',  hex: '#00897b' },
        { name: 'Blue',   hex: '#1e88e5' },
        { name: 'Purple', hex: '#8e24aa' },
        { name: 'Amber',  hex: '#fbc02d' }
      ]
    },
    accessible: {
      name: 'Accessible',
      colours: [
        { name: 'Vermillion', hex: '#d55e00' },
        { name: 'Teal',       hex: '#009e73' },
        { name: 'Sky',        hex: '#56b4e9' },
        { name: 'Mauve',      hex: '#cc79a7' },
        { name: 'Sand',       hex: '#e69f00' }
      ]
    },
    candy: {
      name: 'Candy',
      colours: [
        { name: 'Bubblegum', hex: '#ff8387' },
        { name: 'Lemon',     hex: '#ffd24a' },
        { name: 'Mint',      hex: '#00ca98' },
        { name: 'Aqua',      hex: '#00c4ff' },
        { name: 'Lilac',     hex: '#d099ff' }
      ]
    },
    jewel: {
      name: 'Jewel',
      colours: [
        { name: 'Bronze',   hex: '#bf6c2b' },
        { name: 'Moss',     hex: '#529034' },
        { name: 'Teal',     hex: '#0098a7' },
        { name: 'Sapphire', hex: '#1483e2' },
        { name: 'Rose',     hex: '#cf5597' }
      ]
    }
  };

  // Palettes renamed after release, same forwarding rule as APPEARANCE_ALIASES:
  // loadPrefs validates against PALETTES, so a saved id that no longer exists
  // would silently drop the player back to classic.
  const PALETTE_ALIASES = { ocean: 'jewel' };

  const APPEARANCES = {
    dark:     'Dark',
    midnight: 'Midnight',
    slate:    'Slate',
    forest:   'Forest',
    plum:     'Plum',
    amber:    'Amber',
    light:    'Light',
    paper:    'Paper'
  };

  // Themes renamed after release. A saved id that no longer exists fails the
  // lookup in loadPrefs and silently drops the user back to dark, so anything
  // renamed has to keep a forwarding entry here.
  const APPEARANCE_ALIASES = { sand: 'amber' };

  const COLS = 5;                   // one column per colour
  const APP_VERSION = '1.0.0';
  const BUILD_ID = 'bcp-v35';       // must match CACHE in sw.js
  const FEEDBACK_EMAIL = 'sortilefeedback@gmail.com';
  const STORAGE_KEY = 'bcp.v1';
  const EXPORT_FORMAT = 'sortile-settings-and-stats';
  const EXPORT_VERSION = 1;
  const MAX_IMPORT_BYTES = 256 * 1024;
  const SCRAMBLE_PER_CELL = 24;     // scramble slides, scaled by board size
  const DAILY_ROWS = 5;             // the daily puzzle is always Normal
  const LEVEL_COUNT = 24;           // campaign length
  const HINTS_PER_GAME = 3;         // solver nudges allowed per puzzle
  const GUIDE_RATIO = 0.42;         // guide row height as a fraction of a cell,
                                    // mirrors .guide-cell height in styles.css
  const SITE_URL = 'https://adamsdenniskariuki.github.io/block-color-puzzle/';

  // A level is defined by its board size and how far it is scrambled.
  // Depth climbs geometrically within each block of eight, so level 1 is a
  // handful of slides and level 8 is as random as free play, then the board
  // grows and the ramp starts again.
  function levelSpec(n) {
    const rows = n <= 8 ? 4 : n <= 16 ? 5 : 6;
    const cells = rows * COLS;
    const step = ((n - 1) % 8) / 7;                 // 0 .. 1 across the block
    const factor = 0.3 * Math.pow(SCRAMBLE_PER_CELL / 0.3, step);
    return { rows, depth: Math.max(4, Math.round(cells * factor)) };
  }

  const el = {
    guide:    document.getElementById('guide'),
    board:    document.getElementById('board'),
    boardStatus: document.getElementById('board-status'),
    time:     document.getElementById('stat-time'),
    moves:    document.getElementById('stat-moves'),
    best:     document.getElementById('stat-best'),
    bestLabel: document.getElementById('stat-best-label'),
    modeNote: document.getElementById('mode-note'),
    win:      document.getElementById('win'),
    winStats: document.getElementById('win-stats'),
    winBest:  document.getElementById('win-best'),
    winStreak: document.getElementById('win-streak'),
    winStars: document.getElementById('win-stars'),
    winNew:   document.getElementById('btn-win-new'),
    share:    document.getElementById('btn-share'),
    newBtn:   document.getElementById('btn-new'),
    newLabel: document.getElementById('new-label'),
    levels:   document.getElementById('levels'),
    levelsGrid: document.getElementById('levels-grid'),
    levelsSummary: document.getElementById('levels-summary'),
    help:     document.getElementById('help'),
    settings: document.getElementById('settings'),
    colours: document.getElementById('colours'),
    coloursTitle: document.getElementById('colours-title'),
    appearanceDialog: document.getElementById('appearance'),
    appearanceTitle: document.getElementById('appearance-title'),
    options: document.getElementById('options'),
    optionsTitle: document.getElementById('options-title'),
    dataBackup: document.getElementById('data-backup'),
    dataBackupTitle: document.getElementById('data-backup-title'),
    feedback: document.getElementById('feedback'),
    feedbackTitle: document.getElementById('feedback-title'),
    feedbackPuzzleRow: document.getElementById('feedback-puzzle-row'),
    feedbackPuzzle: document.getElementById('feedback-puzzle'),
    feedbackPuzzleNote: document.getElementById('feedback-puzzle-note'),
    feedbackPreview: document.getElementById('feedback-preview'),
    feedbackText: document.getElementById('feedback-text'),
    feedbackStatus: document.getElementById('feedback-status'),
    feedbackSend: document.getElementById('btn-send-feedback'),
    confirmNew: document.getElementById('confirm-new'),
    confirmImport: document.getElementById('confirm-import'),
    importSummary: document.getElementById('import-summary'),
    importFile: document.getElementById('import-file'),
    exportData: document.getElementById('btn-export-data'),
    importData: document.getElementById('btn-import-data'),
    dataStatus: document.getElementById('data-status'),
    stats:    document.getElementById('stats'),
    statsGrid: document.getElementById('stats-grid'),
    statsSince: document.getElementById('stats-since'),
    palette:  document.getElementById('palette-row'),
    appearance: document.getElementById('appearance-row'),
    diffNote: document.getElementById('diff-note'),
    undo:     document.getElementById('btn-undo'),
    hint:     document.getElementById('btn-hint'),
    hintBadge: document.getElementById('hint-badge'),
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
    mode: 'free',     // 'free', 'daily' or 'levels'
    palette: 'classic',
    appearance: 'dark',
    dailyKey: null,   // YYYY-MM-DD of the puzzle on the board
    level: 1,         // level on the board when mode is 'levels'
    par: 0,           // move par for the current level
    guide: [],        // COLS entries: target colour index per column
    board: [],        // rows*COLS entries: colour index, or null for the gap
    initial: null,    // snapshot for Restart
    gap: 0,
    moves: 0,
    history: [],      // gap positions, newest last
    tiles: [],        // cell index -> tile element (or null)
    slots: [],        // cell index -> backing slot element
    focusCell: -1,    // keyboard cursor, -1 when the board is not being driven by keys
    cell: 56,         // px, recomputed by metrics() on layout and resize
    gutter: 6,
    startedAt: 0,
    elapsed: 0,
    timerId: null,
    bankedMoves: 0,   // activity already written to lifetime stats for this board
    bankedMs: 0,
    counted: false,   // has this board been counted as "started" yet
    hintsLeft: HINTS_PER_GAME,
    hintCell: -1,     // cell the current hint points at, -1 when none
    solved: false
  };

  /* ---------------- palette and appearance ---------------- */

  function palette() {
    return (PALETTES[state.palette] || PALETTES.classic).colours;
  }

  function colourHex(i) { return palette()[i].hex; }
  function colourName(i) { return palette()[i].name; }

  // Screen readers get no spatial sense of the grid from a flat list of buttons,
  // so every block and the gap itself carry their 1-based coordinates.
  function positionLabel(i) { return `row ${rowOf(i) + 1}, column ${colOf(i) + 1}`; }

  // A live region ignores an unchanged string, so a repeated message - landing on
  // the gap twice, say - would be silent. Compare against what is actually in the
  // DOM and alternate a trailing space, so consecutive repeats still fire.
  function announce(text) {
    if (!el.boardStatus) return;
    el.boardStatus.textContent = text === el.boardStatus.textContent ? text + ' ' : text;
  }

  function applyTheme() {
    const root = document.documentElement;
    root.dataset.appearance = state.appearance;
    root.dataset.palette = state.palette;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content',
        getComputedStyle(root).getPropertyValue('--bg').trim() || '#12161c');
    }
  }

  // Repaints existing tiles in place so switching palette mid-game does not
  // disturb the board or the timer.
  function repaintColours() {
    renderGuide();
    for (const tile of state.tiles) {
      if (!tile) continue;
      const i = Number(tile.dataset.colour);
      tile.style.setProperty('--c', colourHex(i));
      tile.setAttribute('aria-label', colourName(i));
    }
  }

  /* ---------------- lifetime stats ---------------- */

  // Everything here is cumulative and mode-scoped. Times are only added on a
  // solve, so an abandoned board never drags the averages down.
  function loadStats() {
    const s = loadStore().stats || {};
    return {
      started: s.started || 0,
      solved:  s.solved || 0,
      moves:   s.moves || 0,
      ms:      s.ms || 0,
      hints:   s.hints || 0,
      undos:   s.undos || 0,
      byMode:  s.byMode || {},        // mode -> { started, solved, moves, ms }
      firstAt: s.firstAt || null
    };
  }

  function saveStats(stats) {
    const store = loadStore();
    store.stats = stats;
    saveStore(store);
  }

  function bumpStats(fields, mode) {
    const stats = loadStats();
    if (!stats.firstAt) stats.firstAt = Date.now();
    const bucket = stats.byMode[mode] || (stats.byMode[mode] = {});
    for (const [k, v] of Object.entries(fields)) {
      // Deltas can be negative - undo un-counts a move, and activity is banked
      // mid-board whenever the app is backgrounded. A lifetime total must never
      // dip below zero on the way back.
      stats[k] = Math.max(0, (stats[k] || 0) + v);
      bucket[k] = Math.max(0, (bucket[k] || 0) + v);
    }
    saveStats(stats);
  }

  function totalStars() {
    const results = loadLevels().results;
    return Object.values(results).reduce((sum, r) => sum + (r.stars || 0), 0);
  }

  function statsRows() {
    const stats = loadStats();
    const daily = loadDaily();
    const levels = loadLevels();
    const solvedCount = Object.keys(levels.results).length;
    const rate = stats.started ? Math.round((stats.solved / stats.started) * 100) : 0;
    const avg = stats.solved ? stats.ms / stats.solved : 0;

    return [
      ['Puzzles solved', String(stats.solved)],
      ['Started', String(stats.started)],
      ['Finish rate', stats.started ? rate + '%' : '\u2014'],
      ['Total moves', stats.moves.toLocaleString()],
      ['Time played', formatLong(stats.ms)],
      ['Average solve', stats.solved ? formatTime(Math.round(avg)) : '\u2014'],
      ['Hints used', String(stats.hints)],
      ['Undos', String(stats.undos)],
      ['Daily streak', String(daily.streak)],
      ['Best streak', String(daily.best)],
      ['Dailies solved', String(Object.keys(daily.results).length)],
      ['Levels cleared', solvedCount + ' / ' + LEVEL_COUNT],
      ['Stars', totalStars() + ' / ' + LEVEL_COUNT * 3]
    ];
  }

  function bestRows() {
    const store = loadStore();
    const labels = { 4: 'Easy', 5: 'Normal', 6: 'Hard' };
    return [4, 5, 6].map(rows => {
      const best = store['best' + rows];
      return [labels[rows] + ' best',
        best ? formatTime(best.ms) + ' \u00b7 ' + best.moves + ' moves' : '\u2014'];
    });
  }

  function formatLong(ms) {
    if (!ms) return '\u2014';
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + (total % 60) + 's';
    return total + 's';
  }

  function renderStats() {
    const cards = statsRows().concat(bestRows());
    el.statsGrid.innerHTML = cards
      .map(([label, value]) =>
        '<div class="stat-card"><span class="stat-card-label"></span>' +
        '<span class="stat-card-value"></span></div>')
      .join('');

    // Values come from storage, so they are written as text rather than markup.
    const nodes = el.statsGrid.children;
    cards.forEach(([label, value], i) => {
      nodes[i].firstChild.textContent = label;
      nodes[i].lastChild.textContent = value;
    });

    const stats = loadStats();
    el.statsSince.textContent = stats.firstAt
      ? 'Since ' + new Date(stats.firstAt).toLocaleDateString()
      : 'No games yet \u2014 solve one and this fills in.';
  }

  /* ---------------- persistence ---------------- */

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }

  function saveStore(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch { /* private mode - ignore */ }
  }

  function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys, label) {
    if (!plainObject(value)) throw new Error(label + ' must be an object.');
    const actual = Object.keys(value).sort();
    const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
      throw new Error(label + ' has unknown or missing fields.');
    }
  }

  function nonNegativeInt(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(label + ' must be a non-negative whole number.');
    }
  }

  function positiveInt(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(label + ' must be a positive whole number.');
    }
  }

  function validDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validTimestamp(value) {
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
  }

  function validateResult(result, label, withStars = false) {
    const keys = withStars ? ['stars', 'moves', 'ms'] : ['moves', 'ms'];
    exactKeys(result, keys, label);
    positiveInt(result.moves, label + '.moves');
    positiveInt(result.ms, label + '.ms');
    if (withStars && ![1, 2, 3].includes(result.stars)) {
      throw new Error(label + '.stars must be 1, 2 or 3.');
    }
  }

  function normalizedModeStats(byMode) {
    const fields = ['started', 'solved', 'moves', 'ms', 'hints', 'undos'];
    const out = {};
    for (const mode of ['free', 'daily', 'levels']) {
      const source = plainObject(byMode && byMode[mode]) ? byMode[mode] : {};
      out[mode] = Object.fromEntries(fields.map(key => [key, source[key] || 0]));
    }
    return out;
  }

  function buildExportData(now = new Date()) {
    const store = loadStore();
    const stats = loadStats();
    const daily = loadDaily();
    const levels = loadLevels();
    const paletteId = PALETTE_ALIASES[store.palette] || store.palette;
    const appearanceId = APPEARANCE_ALIASES[store.appearance] || store.appearance;

    const data = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      settings: {
        rows: [4, 5, 6].includes(store.rows) ? store.rows : 5,
        fadeUnsorted: !!store.hints,
        symbols: !!store.symbols,
        sound: store.sound !== false,
        vibrate: store.haptics !== false,
        palette: PALETTES[paletteId] ? paletteId : 'classic',
        appearance: APPEARANCES[appearanceId] ? appearanceId : 'dark'
      },
      stats: {
        lifetime: {
          started: stats.started,
          solved: stats.solved,
          moves: stats.moves,
          ms: stats.ms,
          hints: stats.hints,
          undos: stats.undos,
          firstAt: stats.firstAt,
          byMode: normalizedModeStats(stats.byMode)
        },
        best: {
          easy: store.best4 || null,
          normal: store.best5 || null,
          hard: store.best6 || null
        },
        daily: {
          last: daily.last,
          streak: daily.streak,
          best: daily.best,
          results: daily.results
        },
        levels: {
          unlocked: levels.unlocked,
          current: levels.current,
          results: levels.results
        }
      }
    };
    validateImportData(data);
    return data;
  }

  function validateImportData(data) {
    exactKeys(data, ['format', 'version', 'exportedAt', 'settings', 'stats'], 'Export');
    if (data.format !== EXPORT_FORMAT) throw new Error('This is not a Sortile settings and stats export.');
    if (data.version !== EXPORT_VERSION) throw new Error('This export version is not supported.');
    if (!validTimestamp(data.exportedAt)) {
      throw new Error('Export.exportedAt is not a valid UTC timestamp.');
    }

    const settings = data.settings;
    exactKeys(settings,
      ['rows', 'fadeUnsorted', 'symbols', 'sound', 'vibrate', 'palette', 'appearance'],
      'Settings');
    if (![4, 5, 6].includes(settings.rows)) throw new Error('Settings.rows must be 4, 5 or 6.');
    for (const key of ['fadeUnsorted', 'symbols', 'sound', 'vibrate']) {
      if (typeof settings[key] !== 'boolean') throw new Error('Settings.' + key + ' must be true or false.');
    }
    if (!PALETTES[settings.palette]) throw new Error('Settings.palette is not supported.');
    if (!APPEARANCES[settings.appearance]) throw new Error('Settings.appearance is not supported.');

    exactKeys(data.stats, ['lifetime', 'best', 'daily', 'levels'], 'Stats');
    const lifetime = data.stats.lifetime;
    exactKeys(lifetime,
      ['started', 'solved', 'moves', 'ms', 'hints', 'undos', 'firstAt', 'byMode'],
      'Stats.lifetime');
    for (const key of ['started', 'solved', 'moves', 'ms', 'hints', 'undos']) {
      nonNegativeInt(lifetime[key], 'Stats.lifetime.' + key);
    }
    if (lifetime.solved > lifetime.started) throw new Error('Solved puzzles cannot exceed started puzzles.');
    if (lifetime.firstAt !== null) positiveInt(lifetime.firstAt, 'Stats.lifetime.firstAt');
    exactKeys(lifetime.byMode, ['free', 'daily', 'levels'], 'Stats.lifetime.byMode');
    for (const mode of ['free', 'daily', 'levels']) {
      const bucket = lifetime.byMode[mode];
      exactKeys(bucket, ['started', 'solved', 'moves', 'ms', 'hints', 'undos'],
        'Stats.lifetime.byMode.' + mode);
      for (const key of ['started', 'solved', 'moves', 'ms', 'hints', 'undos']) {
        nonNegativeInt(bucket[key], 'Stats.lifetime.byMode.' + mode + '.' + key);
      }
      if (bucket.solved > bucket.started) {
        throw new Error('Solved ' + mode + ' puzzles cannot exceed started puzzles.');
      }
    }

    exactKeys(data.stats.best, ['easy', 'normal', 'hard'], 'Stats.best');
    for (const key of ['easy', 'normal', 'hard']) {
      if (data.stats.best[key] !== null) validateResult(data.stats.best[key], 'Stats.best.' + key);
    }

    const daily = data.stats.daily;
    exactKeys(daily, ['last', 'streak', 'best', 'results'], 'Stats.daily');
    if (daily.last !== null && !validDay(daily.last)) throw new Error('Stats.daily.last is not a valid date.');
    nonNegativeInt(daily.streak, 'Stats.daily.streak');
    nonNegativeInt(daily.best, 'Stats.daily.best');
    if (daily.best < daily.streak) throw new Error('Best daily streak cannot be shorter than the current streak.');
    if (!plainObject(daily.results) || Object.keys(daily.results).length > 60) {
      throw new Error('Stats.daily.results must contain at most 60 days.');
    }
    for (const [day, result] of Object.entries(daily.results)) {
      if (!validDay(day)) throw new Error('Stats.daily.results contains an invalid date.');
      validateResult(result, 'Stats.daily.results.' + day);
    }

    const levels = data.stats.levels;
    exactKeys(levels, ['unlocked', 'current', 'results'], 'Stats.levels');
    if (!Number.isSafeInteger(levels.unlocked) || levels.unlocked < 1 || levels.unlocked > LEVEL_COUNT) {
      throw new Error('Stats.levels.unlocked is outside the campaign.');
    }
    if (!Number.isSafeInteger(levels.current) || levels.current < 1 || levels.current > levels.unlocked) {
      throw new Error('Stats.levels.current must be an unlocked level.');
    }
    if (!plainObject(levels.results) || Object.keys(levels.results).length > LEVEL_COUNT) {
      throw new Error('Stats.levels.results is not valid.');
    }
    for (const [level, result] of Object.entries(levels.results)) {
      const n = Number(level);
      if (!Number.isSafeInteger(n) || n < 1 || n > LEVEL_COUNT || String(n) !== level) {
        throw new Error('Stats.levels.results contains an invalid level.');
      }
      validateResult(result, 'Stats.levels.results.' + level, true);
    }
    return data;
  }

  function parseImportText(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Choose a non-empty JSON export.');
    if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error('The import file is too large.');
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('The selected file is not valid JSON.'); }
    return validateImportData(data);
  }

  function storeFromImport(data) {
    const next = {
      rows: data.settings.rows,
      hints: data.settings.fadeUnsorted,
      symbols: data.settings.symbols,
      sound: data.settings.sound,
      haptics: data.settings.vibrate,
      palette: data.settings.palette,
      appearance: data.settings.appearance,
      stats: data.stats.lifetime,
      daily: data.stats.daily,
      levels: data.stats.levels
    };
    const bestKeys = { easy: 'best4', normal: 'best5', hard: 'best6' };
    for (const [name, key] of Object.entries(bestKeys)) {
      if (data.stats.best[name]) next[key] = data.stats.best[name];
    }
    const current = loadStore();
    if (current.inplay) next.inplay = current.inplay;
    return next;
  }

  function replaceImportedData(data) {
    validateImportData(data);
    const next = storeFromImport(data);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error('Sortile could not save the imported data on this device.'); }
    return next;
  }

  function showDataStatus(message, state = 'idle') {
    el.dataStatus.textContent = message;
    el.dataStatus.dataset.state = state;
    el.dataStatus.hidden = !message;
  }

  function setDataBusy(busy) {
    el.exportData.disabled = busy;
    el.importData.disabled = busy;
    if (busy) el.dataBackup.setAttribute('aria-busy', 'true');
    else el.dataBackup.removeAttribute('aria-busy');
  }

  function afterDataStatusPaint() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  async function exportDataFile() {
    setDataBusy(true);
    showDataStatus('Preparing export...', 'progress');
    try {
      await afterDataStatusPaint();
      const data = buildExportData();
      const text = JSON.stringify(data, null, 2) + '\n';
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sortile-data-' + data.exportedAt.slice(0, 10) + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showDataStatus('Export ready.', 'success');
    } catch (error) {
      showDataStatus(error.message || 'Sortile could not create the export file.', 'error');
    } finally {
      setDataBusy(false);
    }
  }

  let pendingImport = null;

  function stageImportText(text) {
    try {
      pendingImport = parseImportText(text);
      el.importSummary.textContent = 'Exported ' +
        new Date(pendingImport.exportedAt).toLocaleString() + '.';
      el.settings.hidden = true;
      el.dataBackup.hidden = true;
      el.confirmImport.hidden = false;
      document.getElementById('confirm-import-title').focus();
      return true;
    } catch (error) {
      pendingImport = null;
      el.settings.hidden = true;
      el.dataBackup.hidden = false;
      showDataStatus(error.message, 'error');
      return false;
    }
  }

  function cancelImport() {
    pendingImport = null;
    el.confirmImport.hidden = true;
    el.settings.hidden = true;
    el.dataBackup.hidden = false;
    document.getElementById('btn-import-data').focus();
  }

  function applyImportedPreferences(data) {
    el.hints.checked = data.settings.fadeUnsorted;
    el.symbols.checked = data.settings.symbols;
    el.sound.checked = data.settings.sound;
    el.haptics.checked = data.settings.vibrate;
    state.palette = data.settings.palette;
    state.appearance = data.settings.appearance;
    applyTheme();
    applyFxPrefs();
    syncThemeUi();
    syncOptionsSummary();
    repaintColours();
    state.tiles.forEach(tile => {
      if (tile) tile.textContent = el.symbols.checked ? SYMBOLS[Number(tile.dataset.colour)] : '';
    });
    refreshTileState();
  }

  function confirmImport() {
    if (!pendingImport) return false;
    try {
      replaceImportedData(pendingImport);
    } catch (error) {
      el.confirmImport.hidden = true;
      el.settings.hidden = true;
      el.dataBackup.hidden = false;
      showDataStatus(error.message, 'error');
      document.getElementById('btn-import-data').focus();
      return false;
    }
    const data = pendingImport;
    pendingImport = null;
    el.confirmImport.hidden = true;
    el.settings.hidden = true;
    el.dataBackup.hidden = false;
    applyImportedPreferences(data);
    syncModeUi();
    showDataStatus('Imported. Difficulty applies to your next Free play board.', 'success');
    document.getElementById('btn-import-data').focus();
    return true;
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
    const savedPalette = PALETTE_ALIASES[store.palette] || store.palette;
    if (savedPalette && PALETTES[savedPalette]) state.palette = savedPalette;
    const saved = APPEARANCE_ALIASES[store.appearance] || store.appearance;
    if (saved && APPEARANCES[saved]) state.appearance = saved;
    applyTheme();
    applyFxPrefs();
  }

  function savePrefs() {
    const store = loadStore();
    store.hints = el.hints.checked;
    store.symbols = el.symbols.checked;
    store.sound = el.sound.checked;
    store.haptics = el.haptics.checked;
    store.palette = state.palette;
    store.appearance = state.appearance;
    // Daily forces Normal, so it must not clobber the free-play difficulty.
    if (state.mode === 'free') store.rows = state.rows;
    saveStore(store);
  }

  function applyFxPrefs() {
    FX.sound.enabled = el.sound.checked;
    FX.haptics.enabled = el.haptics.checked;
  }

  /* ---------------- daily challenge ---------------- */

  // UTC so everyone on the planet gets the same board on the same date.
  function todayKey() {
    const d = new Date();
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  function isPreviousDay(earlier, later) {
    const a = Date.parse(earlier + 'T00:00:00Z');
    const b = Date.parse(later + 'T00:00:00Z');
    return b - a === 86400000;
  }

  function loadDaily() {
    const d = loadStore().daily || {};
    return {
      last: d.last || null,
      streak: d.streak || 0,
      best: d.best || 0,
      results: d.results || {}
    };
  }

  function saveDaily(daily) {
    const store = loadStore();
    store.daily = daily;
    saveStore(store);
  }

  function recordDaily(key, ms, moves) {
    const daily = loadDaily();
    if (daily.results[key]) return daily;   // already banked today

    daily.results[key] = { ms, moves };
    daily.streak = (daily.last && isPreviousDay(daily.last, key)) ? daily.streak + 1 : 1;
    daily.last = key;
    daily.best = Math.max(daily.best, daily.streak);

    // Keep the history bounded; nothing reads more than a couple of months back.
    const keys = Object.keys(daily.results).sort();
    while (keys.length > 60) delete daily.results[keys.shift()];

    saveDaily(daily);
    return daily;
  }

  /* ---------------- level campaign ---------------- */

  function loadLevels() {
    const saved = loadStore().levels || {};
    return {
      unlocked: Math.min(Math.max(saved.unlocked || 1, 1), LEVEL_COUNT),
      current: Math.min(Math.max(saved.current || 1, 1), LEVEL_COUNT),
      results: saved.results || {}     // level number -> { stars, moves, ms }
    };
  }

  function saveLevels(levels) {
    const store = loadStore();
    store.levels = levels;
    saveStore(store);
  }

  // Three stars for beating par, two for staying close, one for finishing.
  function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= Math.round(par * 1.6)) return 2;
    return 1;
  }

  function recordLevel(n, ms, moves, par) {
    const levels = loadLevels();
    const stars = starsFor(moves, par);
    const previous = levels.results[n];

    // Keep the player's best attempt rather than the most recent one.
    if (!previous || stars > previous.stars || (stars === previous.stars && moves < previous.moves)) {
      levels.results[n] = { stars, moves, ms };
    }
    levels.unlocked = Math.max(levels.unlocked, Math.min(n + 1, LEVEL_COUNT));
    saveLevels(levels);
    return { stars, best: levels.results[n], improved: !previous || stars > previous.stars };
  }

  // A tiny seeded generator so a given date always builds the same board.
  function seedFrom(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- helpers ---------------- */

  const rowOf = i => Math.floor(i / COLS);
  const colOf = i => i % COLS;
  const cellCount = () => state.rows * COLS;

  function shuffled(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
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

  function buildSolved(rng) {
    // Randomise which colour sits above which column so the layout varies.
    state.guide = shuffled(SYMBOLS.map((_, i) => i), rng);

    const board = new Array(cellCount());
    for (let i = 0; i < board.length; i++) board[i] = state.guide[colOf(i)];

    // Remove one block to create the gap; that colour ends up one short.
    const gap = Math.floor(rng() * board.length);
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

  function scramble(rng, steps) {
    const total = steps || cellCount() * SCRAMBLE_PER_CELL;
    let previousGap = -1;

    for (let n = 0; n < total; n++) {
      const options = neighbours(state.gap).filter(i => i !== previousGap);
      const pick = options[Math.floor(rng() * options.length)];
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

  function misplaced() {
    let n = 0;
    for (let i = 0; i < state.board.length; i++) {
      const v = state.board[i];
      if (v !== null && v !== state.guide[colOf(i)]) n++;
    }
    return n;
  }

  // The solver returns a good (not provably shortest) solution, so par is that
  // length plus a margin. If the solver is unavailable or gives up, fall back to
  // the old estimate: every misplaced block must move at least once.
  function parFor() {
    const path = solveFromHere();
    if (path) return Math.max(10, Math.round(path.length * 1.25));
    return Math.max(10, Math.round(misplaced() * 2.4));
  }

  /* ---------------- solver bridge ---------------- */

  // The board stores the gap as null; the solver wants -1.
  function solverBoard() {
    return state.board.map(v => (v === null ? -1 : v));
  }

  function solveFromHere() {
    const solver = window.BCPSolver;
    if (!solver) return null;
    try { return solver.solveHard(solverBoard(), state.guide, COLS); }
    catch { return null; }
  }

  function clearHint() {
    if (state.hintCell < 0) return;
    const tile = state.tiles[state.hintCell];
    if (tile) tile.classList.remove('is-hint');
    state.hintCell = -1;
  }

  function syncHintButton() {
    const left = state.hintsLeft;
    // The badge is decorative; the button carries the count for screen readers.
    el.hintBadge.hidden = left <= 0;
    el.hintBadge.textContent = String(left);
    el.hint.setAttribute('aria-label',
      left > 0 ? 'Hint, ' + left + ' remaining'
        : state.hintCell >= 0 ? 'Repeat hint, none remaining' : 'Hint, none remaining');
    el.hint.disabled = state.solved || (left <= 0 && state.hintCell < 0);
  }

  function showHint() {
    if (state.solved) return;

    // A hint belongs to the current board position. Repeating it before a move
    // should reinforce the same answer, not charge for solving the same state
    // again. Removing the class for one frame restarts the visual pulse.
    if (state.hintCell >= 0) {
      const cell = state.hintCell;
      const tile = state.tiles[cell];
      if (tile) {
        tile.classList.remove('is-hint');
        requestAnimationFrame(() => {
          if (state.hintCell !== cell || state.tiles[cell] !== tile) return;
          tile.classList.add('is-hint');
          FX.sound.click();
          FX.haptics.slide(1);
        });
        return;
      }
    }

    if (state.hintsLeft <= 0) return;
    clearHint();

    el.hint.disabled = true;
    // Yield a frame so the button repaints before the search blocks the thread.
    requestAnimationFrame(() => {
      const path = solveFromHere();
      const cell = path && path.length ? path[0] : -1;
      const tile = cell >= 0 ? state.tiles[cell] : null;

      if (tile) {
        state.hintCell = cell;
        tile.classList.add('is-hint');
        state.hintsLeft--;
        bumpStats({ hints: 1 }, state.mode);
        FX.sound.click();
        FX.haptics.slide(1);
      } else {
        nudge(state.gap);
      }
      syncHintButton();
      // Hints do not touch the board, so they never reach updateHud.
      saveInplay();
    });
  }

  /* ---------------- keyboard cursor ---------------- */

  // The board is a grid, so it gets one tab stop and a cursor the arrow keys
  // move, rather than 24 tab stops. The gap is part of the grid - skipping it
  // would teleport the cursor past the one cell the player is hunting for - so
  // its backing slot is made focusable while it is the gap.
  function cellEl(i) {
    if (i < 0 || i >= cellCount()) return null;
    return state.tiles[i] || (i === state.gap ? state.slots[i] : null);
  }

  function syncGapSlot() {
    state.slots.forEach((slot, i) => {
      if (!slot) return;
      if (i === state.gap) {
        slot.setAttribute('aria-label', `Empty slot, ${positionLabel(i)}`);
      } else {
        slot.removeAttribute('aria-label');
        slot.removeAttribute('tabindex');
      }
    });
    adoptCursorFromDom();
  }

  // Exactly one cell is tabbable at a time. Default to the gap, which is where a
  // player's attention already is.
  function syncCursor() {
    if (!cellEl(state.focusCell)) state.focusCell = state.gap;
    const cursor = state.focusCell;

    state.tiles.forEach((tile, i) => { if (tile) tile.tabIndex = i === cursor ? 0 : -1; });
    const gapSlot = state.slots[state.gap];
    if (gapSlot) gapSlot.tabIndex = state.gap === cursor ? 0 : -1;
  }

  // A slide renumbers the tiles under a still-focused element, and clicking or
  // tabbing moves focus without going through moveCursor, so the DOM is the
  // authority whenever the board actually holds focus.
  function adoptCursorFromDom() {
    const active = document.activeElement;
    if (active && el.board.contains(active)) {
      state.focusCell = active.classList.contains('slot')
        ? state.gap
        : Number(active.dataset.index);
    }
    syncCursor();
  }

  function moveCursor(dRow, dCol) {
    const row = rowOf(state.focusCell) + dRow;
    const col = colOf(state.focusCell) + dCol;
    if (row < 0 || row >= state.rows || col < 0 || col >= COLS) return false;

    state.focusCell = row * COLS + col;
    syncCursor();
    const target = cellEl(state.focusCell);
    if (target) target.focus();
    // A focused tile is announced natively; a plain div is not reliably, so the
    // gap goes through the live region.
    if (state.focusCell === state.gap) announce(`Empty slot, ${positionLabel(state.gap)}.`);
    return true;
  }

  function boardHasFocus() {
    return !!document.activeElement && el.board.contains(document.activeElement);
  }

  /* ---------------- rendering ---------------- */

  function renderGuide() {
    el.guide.innerHTML = '';
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'guide-cell';
      cell.style.setProperty('--c', colourHex(state.guide[c]));
      cell.textContent = el.symbols.checked ? SYMBOLS[state.guide[c]] : '';
      cell.title = colourName(state.guide[c]);
      el.guide.appendChild(cell);
    }
  }

  function renderBoard() {
    el.board.innerHTML = '';
    state.tiles = new Array(cellCount()).fill(null);
    state.slots = new Array(cellCount()).fill(null);
    announcedGap = -1;

    // Static backing slots so empty cells read as recesses in the frame.
    for (let i = 0; i < cellCount(); i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.transform = translateFor(i);
      slot.addEventListener('focus', () => { adoptCursorFromDom(); });
      el.board.appendChild(slot);
      state.slots[i] = slot;
    }

    for (let i = 0; i < cellCount(); i++) {
      const colour = state.board[i];
      if (colour === null) continue;

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.style.setProperty('--c', colourHex(colour));
      tile.style.transform = translateFor(i);
      tile.dataset.index = String(i);
      tile.dataset.colour = String(colour);
      tile.tabIndex = -1;   // the board is one tab stop; syncCursor promotes one cell
      tile.textContent = el.symbols.checked ? SYMBOLS[colour] : '';
      // aria-label is owned by refreshTileState, which runs at the end of this
      // function - it needs the movable state, which changes every move.
      tile.addEventListener('click', e => {
        if (fromSwipe()) return;
        const index = Number(tile.dataset.index);
        // A keyboard activation reports detail 0. A real click should not leave
        // focus parked on the board, or plain arrows would silently switch from
        // pushing blocks to moving a cursor under a mouse user.
        if (e.detail > 0) tile.blur();
        slideTo(index, true);
      });
      tile.addEventListener('focus', () => { adoptCursorFromDom(); });

      el.board.appendChild(tile);
      state.tiles[i] = tile;
    }

    layout();
    refreshTileState();
  }

  // Cell size comes from the frame width, then gets clamped again so the whole
  // board still fits the viewport height. Without that second clamp a short,
  // wide window - a tablet in landscape, or a small desktop window - pushes the
  // buttons below the fold.
  //
  // The vertical budget is measured from things that do not depend on the cell
  // size: where the stage starts, and what sits below it. Deriving it by
  // subtracting the board's own height would be circular, and would collapse to
  // the minimum on first paint when the board has no height yet.
  function metrics() {
    const wrap = el.board.parentElement;
    const cs = getComputedStyle(wrap);
    const inset = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const wrapWidth = wrap.clientWidth - inset;
    const gutter = state.rows >= 6 ? 5 : 6;

    const byWidth = Math.floor((wrapWidth - gutter * (COLS - 1)) / COLS);
    const byHeight = Math.floor(
      (verticalBudget() - gutter * (state.rows - 1)) / (state.rows + GUIDE_RATIO)
    );

    const cell = Math.max(34, Math.min(byWidth, byHeight > 0 ? byHeight : byWidth, 78));
    state.cell = cell;
    state.gutter = gutter;
    return { cell, gutter };
  }

  // Height available to the guide row plus the board, in px.
  function verticalBudget() {
    const app = document.querySelector('.app');
    const stage = el.board.closest('.stage');
    const controls = document.querySelector('.controls');
    if (!app || !stage || !controls) return Infinity;

    const appCs = getComputedStyle(app);
    const appGap = parseFloat(appCs.rowGap) || 0;

    // Everything inside the frame that is not the guide or the board: padding,
    // border, the divider and its margins. Measuring the leftover is far more
    // robust than adding those up by hand -- .frame is display:block, so its
    // rowGap is 0 and the real spacing lives in margins that are easy to miss.
    //
    // This is not circular. The board's own height is subtracted straight back
    // out, so the result is pure chrome and does not move when the cell size
    // does. Before first paint the children measure 0 and the frame is chrome
    // only, which gives the same answer.
    const frame = el.board.parentElement;
    const chrome = frame.getBoundingClientRect().height
      - el.guide.getBoundingClientRect().height
      - el.board.getBoundingClientRect().height;

    // Where the stage begins is fixed by the header, mode panel (including its
    // permanently reserved note) and HUD above it.
    const stageRect = stage.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const stageTop = stageRect.top + window.scrollY;

    // In the landscape two-column layout the controls sit beside the stage
    // rather than under it, so they cost no height. Detect that from geometry
    // instead of re-testing the media query, so CSS and JS cannot drift apart.
    // A zero-width stage means we are measuring before first paint; treat that
    // as stacked, which is the conservative guess.
    const beside = stageRect.width > 0 && (
      controlsRect.left >= stageRect.right - 1 ||
      controlsRect.right <= stageRect.left + 1
    );

    const below = beside
      ? parseFloat(appCs.paddingBottom)
      : controlsRect.height + parseFloat(appCs.paddingBottom) + appGap;

    // 2px absorbs sub-pixel rounding; the terms above are now exact.
    return window.innerHeight - stageTop - below - chrome - 2;
  }

  function translateFor(index) {
    const cell = state.cell;
    const gutter = state.gutter;
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

  // Reset so the next refresh always re-announces, even if a new puzzle happens
  // to drop the gap on the square it was already on.
  let announcedGap = -1;

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

      const label = `${colourName(Number(tile.dataset.colour))}, ${positionLabel(i)}`;
      tile.setAttribute('aria-label', movable && !state.solved ? `${label}, movable` : label);
    });

    if (announcedGap !== state.gap) {
      announcedGap = state.gap;
      announce(`Empty slot ${positionLabel(state.gap)}.`);
    }

    syncGapSlot();

    el.board.classList.toggle('is-solved', state.solved);
    el.undo.disabled = state.history.length === 0 || state.solved;
    syncHintButton();
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

    clearHint();

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
      // A puzzle counts as started on the first move, not when it is dealt.
      // Opening the app and closing it again should not dent the finish rate.
      if (!state.counted) {
        state.counted = true;
        bumpStats({ started: 1 }, state.mode);
      }
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
    bumpStats({ undos: 1 }, state.mode);
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

    if (state.mode === 'daily') {
      const daily = loadDaily();
      el.bestLabel.textContent = 'Streak';
      el.best.textContent = daily.streak ? String(daily.streak) : '\u2014';
    } else if (state.mode === 'levels') {
      el.bestLabel.textContent = 'Par';
      el.best.textContent = String(state.par);
    } else {
      const best = getBest();
      el.bestLabel.textContent = 'Best';
      el.best.textContent = best ? formatTime(best.ms) : '\u2014';
    }

    el.newBtn.classList.toggle('btn-danger', state.mode === 'free' && state.moves > 0);

    // Every board mutation lands here, so this is the one hook that cannot go
    // stale as the game grows. The timer writes el.time directly and does not
    // come through updateHud, so this is not a once-a-tick write.
    saveInplay();
  }

  function starMarkup(stars) {
    let out = '';
    for (let i = 1; i <= 3; i++) {
      out += '<span class="' + (i <= stars ? 'earned' : 'missed') + '">\u2605</span>';
    }
    return out;
  }

  function updateModeNote() {
    if (state.mode === 'daily') {
      const daily = loadDaily();
      const done = daily.results[state.dailyKey];
      const bits = ['<strong>Daily</strong> \u00b7 ' + state.dailyKey];
      if (done) bits.push('solved in ' + formatTime(done.ms));
      if (daily.streak) bits.push('streak ' + daily.streak);
      el.modeNote.innerHTML = '<span class="mode-note-text">' + bits.join(' \u00b7 ') + '</span>';
      return;
    }

    if (state.mode === 'levels') {
      const best = loadLevels().results[state.level];
      const bits = ['<strong>Level ' + state.level + '</strong> of ' + LEVEL_COUNT,
        'par ' + state.par + ' moves'];
      if (best) bits.push(starMarkup(best.stars) + ' best ' + best.moves);
      el.modeNote.innerHTML = '<span class="mode-note-text">' + bits.join(' \u00b7 ') + '</span>';
      return;
    }

    el.modeNote.textContent = '';
  }

  function finish() {
    state.solved = true;
    stopTimer();
    refreshTileState();
    // A board finished without a recorded move (test harness, or a scramble that
    // was already solved) would otherwise drag the lifetime average toward zero.
    if (state.moves > 0) bumpStats({ solved: 1 }, state.mode);
    flushActivity();

    el.winStats.textContent = `${formatTime(state.elapsed)}  \u00b7  ${state.moves} moves`;

    if (state.mode === 'daily') {
      const alreadyDone = !!loadDaily().results[state.dailyKey];
      const daily = recordDaily(state.dailyKey, state.elapsed, state.moves);
      el.winBest.hidden = true;
      el.winStars.hidden = true;
      el.winStreak.textContent = alreadyDone
        ? 'Replay \u2014 today was already counted. Streak ' + daily.streak + '.'
        : 'Streak ' + daily.streak + (daily.best > daily.streak ? ' \u00b7 best ' + daily.best : '');
      el.winStreak.hidden = false;
      el.share.hidden = false;
      el.share.textContent = 'Share';
      updateModeNote();
    } else if (state.mode === 'levels') {
      const outcome = recordLevel(state.level, state.elapsed, state.moves, state.par);
      el.winBest.hidden = true;
      el.winStreak.textContent = outcome.stars === 3
        ? 'Beat par of ' + state.par + ' moves!'
        : 'Par is ' + state.par + ' moves \u00b7 best ' + outcome.best.moves;
      el.winStreak.hidden = false;
      el.winStars.innerHTML = starMarkup(outcome.stars);
      el.winStars.hidden = false;
      el.share.hidden = true;
      el.winNew.textContent = state.level < LEVEL_COUNT ? 'Next level' : 'Level select';
      updateModeNote();
    } else {
      el.winBest.hidden = !recordBest(state.elapsed, state.moves);
      el.winStreak.hidden = true;
      el.winStars.hidden = true;
      el.share.hidden = true;
    }

    el.win.hidden = false;
    updateHud();

    FX.sound.win();
    FX.haptics.win();
    FX.confetti.burst(palette().map(c => c.hex));
  }

  /* ---------------- sharing ---------------- */

  const SHARE_EMOJI = ['\u{1F7E5}', '\u{1F7E9}', '\u{1F7E6}', '\u{1F7EA}', '\u{1F7E8}'];

  function shareText() {
    const result = loadDaily().results[state.dailyKey] || { ms: state.elapsed, moves: state.moves };
    const streak = loadDaily().streak;
    // The guide order is the day's fingerprint, so the strip differs daily.
    const strip = state.guide.map(i => SHARE_EMOJI[i]).join('');
    return [
      'Sortile \u2014 ' + state.dailyKey,
      strip,
      formatTime(result.ms) + ' \u00b7 ' + result.moves + ' moves \u00b7 streak ' + streak,
      SITE_URL
    ].join('\n');
  }

  async function shareResult() {
    const text = shareText();

    if (navigator.share) {
      try { await navigator.share({ text }); return; }
      catch { return; }   // cancelled, or the sheet was dismissed
    }

    try {
      await navigator.clipboard.writeText(text);
      el.share.textContent = 'Copied!';
      setTimeout(() => { el.share.textContent = 'Share'; }, 1600);
    } catch {
      el.share.textContent = 'Copy failed';
      setTimeout(() => { el.share.textContent = 'Share'; }, 1600);
    }
  }

  /* ---------------- feedback ---------------- */

  function difficultyLabel(rows = state.rows) {
    return ({ 4: 'Easy', 5: 'Normal', 6: 'Hard' })[rows] || `${rows} rows`;
  }

  function deviceLabel(width = window.innerWidth) {
    if (width < 600) return 'Phone';
    if (width < 1024) return 'Tablet';
    return 'Desktop';
  }

  function browserLabel(userAgent = navigator.userAgent) {
    const checks = [
      ['Edge', /\bEdg\/(\d+)/],
      ['Firefox', /\bFirefox\/(\d+)/],
      ['Chrome', /\b(?:Chrome|CriOS)\/(\d+)/],
      ['Safari', /\bVersion\/(\d+).*\bSafari\//]
    ];
    for (const [name, pattern] of checks) {
      const match = userAgent.match(pattern);
      if (match) return `${name} ${match[1]}`;
    }
    return 'Other';
  }

  function feedbackPuzzleId() {
    if (state.mode === 'daily' && state.dailyKey) return `daily:${state.dailyKey}`;
    if (state.mode === 'levels') return `level:${String(state.level).padStart(2, '0')}`;
    return null;
  }

  function feedbackDiagnostics(includePuzzle = false) {
    const diagnostics = {
      appVersion: APP_VERSION,
      buildId: BUILD_ID,
      mode: ({ free: 'Free play', daily: 'Daily', levels: 'Levels' })[state.mode],
      difficulty: `${difficultyLabel()} (${state.rows} rows)`,
      device: deviceLabel(),
      browser: browserLabel()
    };
    const puzzleId = includePuzzle ? feedbackPuzzleId() : null;
    if (puzzleId) diagnostics.puzzleId = puzzleId;
    return diagnostics;
  }

  function buildFeedbackText(includePuzzle = false) {
    const d = feedbackDiagnostics(includePuzzle);
    const lines = [
      'Sortile feedback',
      '',
      'What happened, or what would you like to suggest?',
      '[Write your feedback here]',
      '',
      'Steps to reproduce (if relevant):',
      '1.',
      '2.',
      '',
      '---',
      'Diagnostics included automatically',
      `App: Sortile ${d.appVersion}`,
      `Build: ${d.buildId}`,
      `Mode: ${d.mode}`,
      `Difficulty: ${d.difficulty}`,
      `Device: ${d.device}`,
      `Browser: ${d.browser}`
    ];
    if (d.puzzleId) lines.push(`Puzzle: ${d.puzzleId}`);
    return lines.join('\n');
  }

  function updateFeedbackDraft() {
    const text = buildFeedbackText(el.feedbackPuzzle.checked);
    el.feedbackText.value = text;
    el.feedbackSend.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Sortile feedback')}` +
      `&body=${encodeURIComponent(text)}`;
    return text;
  }

  function showFeedbackStatus(message) {
    el.feedbackStatus.textContent = message;
  }

  let feedbackReturnFocus = null;

  function openFeedback() {
    feedbackReturnFocus = document.getElementById('btn-feedback');
    const puzzleId = feedbackPuzzleId();
    el.feedbackPuzzle.checked = false;
    el.feedbackPuzzleRow.hidden = !puzzleId;
    el.feedbackPuzzleNote.textContent = puzzleId ? `Adds ${puzzleId}` : '';
    el.feedbackPreview.open = false;
    showFeedbackStatus('');
    updateFeedbackDraft();
    el.settings.hidden = true;
    el.feedback.hidden = false;
    el.feedbackTitle.focus();
  }

  function closeFeedback() {
    el.feedback.hidden = true;
    el.settings.hidden = false;
    const target = feedbackReturnFocus || document.getElementById('btn-feedback');
    feedbackReturnFocus = null;
    target.focus();
  }

  function revealManualFeedback(message) {
    el.feedbackPreview.open = true;
    showFeedbackStatus(message);
    el.feedbackText.focus();
    el.feedbackText.select();
  }

  async function copyFeedbackText() {
    const text = updateFeedbackDraft();
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      showFeedbackStatus('Feedback text copied. Paste it into any email app.');
    } catch {
      revealManualFeedback('Copy was blocked. Select and copy the text below manually.');
    }
  }

  function trapModalTab(modal, e) {
    const focusable = [...modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), summary, textarea'
    )].filter(node => !node.closest('[hidden]') &&
      !(node.tagName !== 'SUMMARY' && node.closest('details:not([open])')));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }

  /* ---------------- lifecycle ---------------- */

  function newGame() {
    abandonBoard();
    stopTimer();
    state.elapsed = 0;
    state.moves = 0;
    state.bankedMoves = 0;
    state.bankedMs = 0;
    state.counted = false;
    state.history = [];
    state.solved = false;
    state.hintsLeft = HINTS_PER_GAME;
    state.hintCell = -1;
    el.win.hidden = true;
    FX.confetti.clear();

    const daily = state.mode === 'daily';
    const levels = state.mode === 'levels';
    if (!daily && !levels) {
      const savedRows = loadStore().rows;
      state.rows = [4, 5, 6].includes(savedRows) ? savedRows : 5;
    }
    state.dailyKey = daily ? todayKey() : null;
    if (daily) state.rows = DAILY_ROWS;

    let depth = 0;
    if (levels) {
      const spec = levelSpec(state.level);
      state.rows = spec.rows;
      depth = spec.depth;
    }

    // Free play rolls fresh every time; the daily and each level are pinned to
    // a seed, so they rebuild the same board every visit.
    const rng = daily ? mulberry32(seedFrom('bcp-' + state.dailyKey))
      : levels ? mulberry32(seedFrom('bcp-level-' + state.level))
      : Math.random;

    buildSolved(rng);
    scramble(rng, depth);
    if (isSolved()) scramble(rng, depth || undefined);

    state.par = levels ? parFor() : 0;
    state.initial = { board: state.board.slice(), gap: state.gap, guide: state.guide.slice() };

    // The note sits above the board, so it has to settle before layout measures
    // how much vertical room the board actually has.
    updateModeNote();
    renderGuide();
    renderBoard();
    updateHud();
  }

  // Activity totals (moves, time) are flushed incrementally rather than once at
  // the end, because a board can be banked more than once: backgrounding the app
  // mid-game banks it, and solving the same board later must not count it twice.
  // Deltas can be negative because undo un-counts a move; bumpStats clamps.
  function flushActivity() {
    const moves = state.moves - state.bankedMoves;
    const ms = state.elapsed - state.bankedMs;
    if (moves === 0 && ms === 0) return;
    state.bankedMoves = state.moves;
    state.bankedMs = state.elapsed;
    bumpStats({ moves, ms }, state.mode);
  }

  // Kept as its own name because it reads at the call sites, and because a board
  // walked away from is the case this exists for.
  function abandonBoard() {
    if (state.solved) return;
    stopTimer();
    flushActivity();
    // After the flush, so the snapshot carries the updated banking markers and
    // the elapsed time stopTimer just recomputed.
    saveInplay();
  }

  /* ---------------- resume ---------------- */

  // The whole position is stored, not a seed. Free play has no seed to rebuild
  // from, and even the seeded modes would only rebuild the *starting* board,
  // throwing away every move the player had already made - which is the entire
  // thing worth keeping.
  function saveInplay() {
    if (!state.board.length) return;
    if (state.solved) { clearInplay(); return; }

    const store = loadStore();
    store.inplay = {
      mode: state.mode,
      rows: state.rows,
      level: state.level,
      par: state.par,
      dailyKey: state.dailyKey,
      board: state.board.slice(),
      guide: state.guide.slice(),
      gap: state.gap,
      initial: state.initial,
      moves: state.moves,
      elapsed: state.elapsed,
      history: state.history.slice(),
      hintsLeft: state.hintsLeft,
      // Without these the resumed board would bank its moves a second time on
      // the way out, inflating the lifetime totals on every app switch.
      bankedMoves: state.bankedMoves,
      bankedMs: state.bankedMs,
      counted: state.counted
    };
    saveStore(store);
  }

  function clearInplay() {
    const store = loadStore();
    if (!store.inplay) return;
    delete store.inplay;
    saveStore(store);
  }

  // Returns true when a board was put back, so boot knows to skip the deal.
  function restoreInplay() {
    const saved = loadStore().inplay;
    if (!saved || !Array.isArray(saved.board) || !Array.isArray(saved.guide)) return false;

    // A board written by an older build, or half-written by a storage failure,
    // must never reach the renderer.
    const rows = Number(saved.rows);
    if (!(rows > 0) || saved.board.length !== rows * COLS || saved.guide.length !== COLS) {
      clearInplay();
      return false;
    }
    if (saved.gap < 0 || saved.gap >= saved.board.length || saved.board[saved.gap] !== null) {
      clearInplay();
      return false;
    }
    // Yesterday's daily is a different puzzle. Keep the player in daily mode -
    // that is where they were - but let boot deal today's board.
    if (saved.mode === 'daily' && saved.dailyKey !== todayKey()) {
      clearInplay();
      state.mode = 'daily';
      return false;
    }

    state.mode = saved.mode || 'free';
    state.rows = rows;
    state.level = saved.level || 1;
    state.par = saved.par || 0;
    state.dailyKey = saved.dailyKey || null;
    state.board = saved.board.slice();
    state.guide = saved.guide.slice();
    state.gap = saved.gap;
    state.initial = saved.initial || { board: state.board.slice(), gap: state.gap, guide: state.guide.slice() };
    state.moves = saved.moves || 0;
    state.elapsed = saved.elapsed || 0;
    state.history = Array.isArray(saved.history) ? saved.history.slice() : [];
    state.hintsLeft = Number.isFinite(saved.hintsLeft) ? saved.hintsLeft : HINTS_PER_GAME;
    state.bankedMoves = saved.bankedMoves || 0;
    state.bankedMs = saved.bankedMs || 0;
    state.counted = !!saved.counted;
    state.solved = false;
    state.hintCell = -1;

    // The clock stays stopped: it resumes on the next move, exactly as it does
    // after the app is backgrounded mid-board.
    updateModeNote();
    renderGuide();
    renderBoard();
    updateHud();
    syncHintButton();
    return true;
  }

  function restart() {
    if (!state.initial) return;
    abandonBoard();
    stopTimer();
    state.elapsed = 0;
    state.moves = 0;
    state.bankedMoves = 0;
    state.bankedMs = 0;
    state.counted = false;
    state.history = [];
    state.solved = false;
    state.hintsLeft = HINTS_PER_GAME;
    state.hintCell = -1;
    el.win.hidden = true;
    FX.confetti.clear();

    state.board = state.initial.board.slice();
    state.gap = state.initial.gap;
    state.guide = state.initial.guide.slice();

    renderGuide();
    renderBoard();
    updateHud();
  }

  /* ---------------- theme pickers ---------------- */

  // Each swatch previews its own palette, so the choice is visible before the
  // board changes. Switching repaints in place rather than dealing a new board.
  function buildPalettePicker() {
    el.palette.innerHTML = '';
    for (const [id, def] of Object.entries(PALETTES)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (id === state.palette ? ' is-active' : '');
      btn.dataset.palette = id;
      btn.setAttribute('aria-pressed', String(id === state.palette));
      btn.title = def.name;

      const chips = document.createElement('span');
      chips.className = 'swatch-chips';
      for (const colour of def.colours) {
        const chip = document.createElement('span');
        chip.style.background = colour.hex;
        chips.appendChild(chip);
      }

      const label = document.createElement('span');
      label.className = 'swatch-name';
      label.textContent = def.name;

      btn.append(chips, label);
      btn.addEventListener('click', () => setPalette(id));
      el.palette.appendChild(btn);
    }
  }

  function setPalette(id) {
    if (!PALETTES[id] || state.palette === id) return;
    state.palette = id;
    applyTheme();
    repaintColours();
    refreshTileState();
    savePrefs();
    syncThemeUi();
    FX.sound.click();
  }

  // Names like "Dark" and "Midnight" tell you nothing about what you are
  // choosing, so each theme previews itself: page, surface and accent, drawn
  // with that theme's own variables rather than a duplicated colour list.
  function buildAppearancePicker() {
    el.appearance.innerHTML = '';
    for (const [id, name] of Object.entries(APPEARANCES)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch swatch-theme' + (id === state.appearance ? ' is-active' : '');
      btn.dataset.appearance = id;
      btn.setAttribute('aria-pressed', String(id === state.appearance));
      btn.title = name;

      const dot = document.createElement('span');
      dot.className = 'theme-dot';

      const label = document.createElement('span');
      label.className = 'swatch-name';
      label.textContent = name;

      btn.append(dot, label);
      btn.addEventListener('click', () => setAppearance(id));
      el.appearance.appendChild(btn);
    }
  }

  function setAppearance(id) {
    if (!APPEARANCES[id] || state.appearance === id) return;
    state.appearance = id;
    applyTheme();
    savePrefs();
    syncThemeUi();
    FX.sound.click();
  }

  function syncThemeUi() {
    for (const btn of el.palette.children) {
      const on = btn.dataset.palette === state.palette;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    for (const btn of el.appearance.children) {
      const on = btn.dataset.appearance === state.appearance;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    document.getElementById('colours-summary').textContent = PALETTES[state.palette].name + ' selected';
    document.getElementById('appearance-summary').textContent = APPEARANCES[state.appearance] + ' selected';
  }

  /* ---------------- input wiring ---------------- */

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;

    if (mode === 'free') {
      // Restore whatever difficulty the player had chosen for free play.
      const saved = loadStore().rows;
      state.rows = [4, 5, 6].includes(saved) ? saved : 5;
    }

    if (mode === 'levels') state.level = loadLevels().current;

    document.querySelectorAll('.seg-mode .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    });
    syncModeUi();
    newGame();
  }

  // Neither the daily nor a level is rerollable, so difficulty is locked off in
  // both. In levels mode the New button becomes the level picker instead.
  function syncModeUi() {
    const free = state.mode === 'free';
    const levels = state.mode === 'levels';
    const savedRows = loadStore().rows;
    const preferredRows = free && [4, 5, 6].includes(savedRows) ? savedRows : state.rows;

    document.querySelectorAll('.seg-diff .seg-btn').forEach(b => {
      b.disabled = !free;
      b.classList.toggle('is-active', free && Number(b.dataset.rows) === preferredRows);
    });

    const daily = state.mode === 'daily';
    el.newBtn.hidden = daily;
    // Write the label, not the button: textContent would wipe the icon.
    el.newLabel.textContent = levels ? 'Choose level' : 'New board';
    el.newBtn.setAttribute('aria-label', levels ? 'Choose level' : 'New board');
    el.winNew.textContent = levels ? 'Next level' : 'New puzzle';
    el.diffNote.hidden = free;
  }

  function playLevel(n) {
    state.level = Math.min(Math.max(n, 1), LEVEL_COUNT);
    const levels = loadLevels();
    levels.current = state.level;
    saveLevels(levels);
    newGame();
  }

  function renderLevelPicker() {
    const levels = loadLevels();
    el.levelsGrid.innerHTML = '';

    for (let n = 1; n <= LEVEL_COUNT; n++) {
      const result = levels.results[n];
      const locked = n > levels.unlocked;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-btn';
      btn.disabled = locked;
      btn.classList.toggle('is-current', n === state.level && !locked);
      btn.innerHTML = '<span class="level-num">' + (locked ? '\u{1F512}' : n) + '</span>' +
        '<span class="level-stars">' + (result ? starMarkup(result.stars) : '') + '</span>';
      btn.setAttribute('aria-label', locked ? 'Level ' + n + ', locked'
        : 'Level ' + n + (result ? ', ' + result.stars + ' stars' : ', not yet solved'));
      btn.addEventListener('click', () => {
        el.levels.hidden = true;
        playLevel(n);
      });
      el.levelsGrid.appendChild(btn);
    }

    el.levelsSummary.innerHTML = '<strong>' + totalStars() + '</strong> of ' +
      (LEVEL_COUNT * 3) + ' stars \u00b7 ' + levels.unlocked + ' of ' + LEVEL_COUNT + ' unlocked';
  }

  function openLevelPicker() {
    renderLevelPicker();
    el.levels.hidden = false;
  }

  document.querySelectorAll('.seg-mode .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => { setMode(btn.dataset.mode); });
  });

  const confirmNew = document.getElementById('confirm-new');

  document.getElementById('btn-new').addEventListener('click', () => {
    if (state.mode === 'levels') { openLevelPicker(); return; }
    // Only a free board with moves on it has anything to lose: the daily never
    // rerolls, and an untouched board has no progress to discard.
    if (state.moves > 0) { confirmNew.hidden = false; return; }
    newGame();
  });
  document.getElementById('btn-confirm-new').addEventListener('click', () => {
    confirmNew.hidden = true;
    newGame();
  });
  document.getElementById('btn-confirm-cancel').addEventListener('click', () => { confirmNew.hidden = true; });
  confirmNew.addEventListener('click', e => { if (e.target === confirmNew) confirmNew.hidden = true; });

  document.getElementById('btn-restart').addEventListener('click', () => {
    restart();
  });
  document.getElementById('btn-levels-close').addEventListener('click', () => { el.levels.hidden = true; });
  el.levels.addEventListener('click', e => { if (e.target === el.levels) el.levels.hidden = true; });

  document.getElementById('btn-win-new').addEventListener('click', () => {
    if (state.mode === 'daily') { el.win.hidden = true; FX.confetti.clear(); return; }
    if (state.mode === 'levels') {
      el.win.hidden = true;
      FX.confetti.clear();
      if (state.level < LEVEL_COUNT) playLevel(state.level + 1);
      else openLevelPicker();
      return;
    }
    newGame();
  });
  el.share.addEventListener('click', shareResult);
  el.undo.addEventListener('click', undo);

  document.querySelectorAll('.seg-diff .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-diff .seg-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.rows = Number(btn.dataset.rows);
      savePrefs();
      el.settings.hidden = true;
      newGame();
    });
  });

  function syncOptionsSummary() {
    const enabled = [
      el.hints.checked && 'Fade unsorted',
      el.symbols.checked && 'Symbols',
      el.sound.checked && 'Sound',
      !el.hapticsWrap.hidden && el.haptics.checked && 'Vibrate'
    ].filter(Boolean);
    document.getElementById('options-summary').textContent =
      enabled.length ? enabled.join(', ') : 'All options off';
  }

  el.hints.addEventListener('change', () => { savePrefs(); refreshTileState(); syncOptionsSummary(); });
  el.sound.addEventListener('change', () => {
    savePrefs();
    applyFxPrefs();
    if (el.sound.checked) FX.sound.click();
    syncOptionsSummary();
  });
  el.haptics.addEventListener('change', () => {
    savePrefs();
    applyFxPrefs();
    if (el.haptics.checked) FX.haptics.slide(2);
    syncOptionsSummary();
  });
  el.symbols.addEventListener('change', () => {
    savePrefs();
    renderGuide();
    state.tiles.forEach(tile => {
      if (tile) tile.textContent = el.symbols.checked ? SYMBOLS[Number(tile.dataset.colour)] : '';
    });
    syncOptionsSummary();
  });

  document.getElementById('btn-help').addEventListener('click', () => {
    el.help.querySelectorAll('details[open]').forEach(d => { d.open = false; });
    const scroller = el.help.querySelector('.modal-scroll');
    if (scroller) scroller.scrollTop = 0;
    el.help.hidden = false;
  });
  document.getElementById('btn-help-close').addEventListener('click', () => { el.help.hidden = true; });
  el.help.addEventListener('click', e => { if (e.target === el.help) el.help.hidden = true; });

  el.hint.addEventListener('click', showHint);

  document.getElementById('btn-settings').addEventListener('click', () => {
    syncModeUi();
    const scroller = el.settings.querySelector('.modal-scroll');
    if (scroller) scroller.scrollTop = 0;
    el.settings.hidden = false;
  });
  document.getElementById('btn-settings-close').addEventListener('click', () => { el.settings.hidden = true; });
  el.settings.addEventListener('click', e => { if (e.target === el.settings) el.settings.hidden = true; });

  document.getElementById('btn-feedback').addEventListener('click', openFeedback);
  document.getElementById('btn-feedback-back').addEventListener('click', closeFeedback);
  document.getElementById('btn-copy-feedback').addEventListener('click', copyFeedbackText);
  el.feedbackPuzzle.addEventListener('change', updateFeedbackDraft);
  el.feedbackSend.addEventListener('click', () => {
    updateFeedbackDraft();
    el.feedbackPreview.open = true;
    showFeedbackStatus('If your email app did not open, copy the text below and email it to ' + FEEDBACK_EMAIL + '.');
  });
  el.feedback.addEventListener('click', e => { if (e.target === el.feedback) closeFeedback(); });

  const settingsDialogs = [
    { modal: el.colours, title: el.coloursTitle, trigger: 'btn-colours', back: 'btn-colours-back' },
    { modal: el.appearanceDialog, title: el.appearanceTitle, trigger: 'btn-appearance', back: 'btn-appearance-back' },
    { modal: el.options, title: el.optionsTitle, trigger: 'btn-options', back: 'btn-options-back' },
    { modal: el.dataBackup, title: el.dataBackupTitle, trigger: 'btn-data-backup', back: 'btn-data-backup-back' },
    { modal: el.feedback, title: el.feedbackTitle, trigger: 'btn-feedback', back: 'btn-feedback-back' }
  ];

  function openSettingsDialog(config) {
    if (config.modal === el.dataBackup) showDataStatus('');
    if (config.modal === el.feedback) {
      openFeedback();
      return;
    }
    el.settings.hidden = true;
    config.modal.hidden = false;
    config.title.focus();
  }

  function closeSettingsDialog(config) {
    config.modal.hidden = true;
    el.settings.hidden = false;
    document.getElementById(config.trigger).focus();
  }

  for (const config of settingsDialogs.filter(item => item.modal !== el.feedback)) {
    document.getElementById(config.trigger).addEventListener('click', () => openSettingsDialog(config));
    document.getElementById(config.back).addEventListener('click', () => closeSettingsDialog(config));
    config.modal.addEventListener('click', e => {
      if (e.target === config.modal) closeSettingsDialog(config);
    });
  }
  el.exportData.addEventListener('click', exportDataFile);
  el.importData.addEventListener('click', () => {
    showDataStatus('Choose a Sortile export file.');
    el.importFile.click();
  });
  el.importFile.addEventListener('change', async () => {
    const file = el.importFile.files && el.importFile.files[0];
    el.importFile.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showDataStatus('The import file is too large.', 'error');
      return;
    }
    setDataBusy(true);
    showDataStatus('Checking import...', 'progress');
    try {
      stageImportText(await file.text());
    } catch {
      showDataStatus('Sortile could not read the selected file.', 'error');
    } finally {
      setDataBusy(false);
    }
  });
  document.getElementById('btn-confirm-import').addEventListener('click', confirmImport);
  document.getElementById('btn-import-cancel').addEventListener('click', cancelImport);
  el.confirmImport.addEventListener('click', e => { if (e.target === el.confirmImport) cancelImport(); });

  document.getElementById('btn-stats').addEventListener('click', () => {
    renderStats();
    el.stats.hidden = false;
  });
  document.getElementById('btn-stats-close').addEventListener('click', () => { el.stats.hidden = true; });
  el.stats.addEventListener('click', e => { if (e.target === el.stats) el.stats.hidden = true; });

  // Arrow keys push a block in the pressed direction, into the gap.
  document.addEventListener('keydown', e => {
    const openModal = !el.feedback.hidden ? el.feedback
      : !el.confirmImport.hidden ? el.confirmImport
      : !el.dataBackup.hidden ? el.dataBackup
      : !el.options.hidden ? el.options
      : !el.appearanceDialog.hidden ? el.appearanceDialog
      : !el.colours.hidden ? el.colours
      : !el.confirmNew.hidden ? el.confirmNew
      : !el.levels.hidden ? el.levels
      : !el.stats.hidden ? el.stats
      : !el.settings.hidden ? el.settings
      : !el.help.hidden ? el.help : null;
    if (openModal) {
      // A modal owns the keyboard while it is up, so the board must not move.
      if (e.key === 'Escape') {
        if (openModal === el.feedback) closeFeedback();
        else if (openModal === el.confirmImport) cancelImport();
        else {
          const settingsDialog = settingsDialogs.find(item => item.modal === openModal);
          if (settingsDialog) closeSettingsDialog(settingsDialog);
          else openModal.hidden = true;
        }
        e.preventDefault();
      } else if ((openModal === el.confirmImport ||
                  settingsDialogs.some(item => item.modal === openModal)) && e.key === 'Tab') {
        trapModalTab(openModal, e);
      }
      return;
    }

    const map = {
      ArrowRight: -1,
      ArrowLeft:  1,
      ArrowDown:  -COLS,
      ArrowUp:    COLS
    };
    if (!(e.key in map)) return;

    // Two arrow-key modes, chosen by where focus is. Tab into the board and the
    // arrows drive a cursor you then activate with Enter, which is the only way
    // to play without sight. Focus anywhere else and they keep their original
    // meaning: push the neighbouring block into the gap.
    if (boardHasFocus()) {
      const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (moveCursor(step[0], step[1])) e.preventDefault();
      return;
    }

    const source = state.gap + map[e.key];
    if (source < 0 || source >= cellCount()) return;
    // Horizontal moves must stay on the gap's row.
    if (Math.abs(map[e.key]) === 1 && rowOf(source) !== rowOf(state.gap)) return;

    e.preventDefault();
    slideTo(source, true);
  });

  window.addEventListener('resize', () => { layout(); FX.confetti.resize(); });

  // Closing or backgrounding the app is the exit path players use most, and it
  // used to be the only one that dropped the board's moves and time on the floor.
  // Safari and most mobile browsers can skip 'pagehide' entirely, so both events
  // are wired; flushActivity banks a delta, so firing twice is harmless. This
  // also stops the clock while the app is hidden, which is what a player expects.
  window.addEventListener('pagehide', abandonBoard);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') abandonBoard();
  });

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
  syncOptionsSummary();
  buildPalettePicker();
  buildAppearancePicker();
  syncThemeUi();
  // Put a half-finished board back before the mode UI syncs, since restoring
  // sets the mode the UI has to reflect.
  const resumed = restoreInplay();
  syncModeUi();
  if (!resumed) newGame();

  // Local-only hook so the game can be driven from a test harness.
  // Never present on the deployed site.
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    window.__bcp = {
      state, el, finish, isSolved, todayKey, isPreviousDay,
      moveCursor, syncCursor, cellEl,
      loadDaily, recordDaily, shareText,
      loadLevels, saveLevels, recordLevel, starsFor, levelSpec, playLevel,
      openLevelPicker, parFor, misplaced, setMode, newGame, restart, LEVEL_COUNT,
      showHint, solveFromHere, solverBoard, clearHint, slideTo, HINTS_PER_GAME,
      loadStats, saveStats, bumpStats, renderStats, statsRows, bestRows,
      abandonBoard, flushActivity,
      saveInplay, clearInplay, restoreInplay,
      formatLong, formatTime, totalStars,
      setPalette, setAppearance, palette, colourHex, PALETTES, APPEARANCES,
      PALETTE_ALIASES, APPEARANCE_ALIASES,
      loadStore, saveStore, getBest, recordBest, loadPrefs, savePrefs,
      buildExportData, validateImportData, parseImportText, storeFromImport,
      replaceImportedData, stageImportText, confirmImport, EXPORT_FORMAT, EXPORT_VERSION,
      seedFrom, mulberry32, shuffled, neighbours, buildSolved, scramble,
      renderBoard, renderGuide, layout,
      feedbackDiagnostics, buildFeedbackText, feedbackPuzzleId, browserLabel, deviceLabel,
      APP_VERSION, BUILD_ID, FEEDBACK_EMAIL,
      undo, applySwipe, syncHintButton, COLS, STORAGE_KEY, SCRAMBLE_PER_CELL
    };
  }
})();
