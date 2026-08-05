/*
 * Sortile - solver
 * ---------------------------
 * The board only cares about colour, not identity: a column is correct when
 * every block in it matches the guide colour above it. Because the guide is a
 * permutation of the five colours, each colour has exactly one target column,
 * so a block's row never matters - only how far it is from its column.
 *
 * That gives a cheap admissible heuristic: one elementary slide moves a single
 * block one cell, so it can close at most one unit of column distance.
 *
 *     h = sum over blocks of |column(block) - targetColumn(colour(block))|
 *
 * Optimal search is out of reach for a full 6-row scramble, so this is a beam
 * search: it keeps the best `width` states at each depth. The result is a good
 * solution rather than a provably shortest one, which is all that hints and
 * move pars need. It is fully deterministic, so every player gets the same par.
 */
(() => {
  'use strict';

  const GAP = -1;

  function targetsFor(guide) {
    // guide[column] = colour, so invert it to colour -> column.
    const targets = new Int8Array(guide.length);
    for (let c = 0; c < guide.length; c++) targets[guide[c]] = c;
    return targets;
  }

  function heuristic(board, cols, targets) {
    let sum = 0;
    for (let i = 0; i < board.length; i++) {
      const v = board[i];
      if (v === GAP) continue;
      const col = i % cols;
      sum += Math.abs(col - targets[v]);
    }
    return sum;
  }

  function misplacedCount(board, cols, targets) {
    let n = 0;
    for (let i = 0; i < board.length; i++) {
      const v = board[i];
      if (v !== GAP && targets[v] !== i % cols) n++;
    }
    return n;
  }

  // FNV-1a over the board, used only as a deterministic tie-break so equally
  // scored states are ordered consistently instead of by insertion accident.
  function hash(board) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < board.length; i++) {
      h ^= board[i] + 1;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function keyOf(board) {
    let s = '';
    for (let i = 0; i < board.length; i++) s += String.fromCharCode(board[i] + 1);
    return s;
  }

  function neighbours(index, cols, cells) {
    const out = [];
    const row = Math.floor(index / cols);
    if (index - cols >= 0) out.push(index - cols);
    if (index + cols < cells) out.push(index + cols);
    if (index % cols !== 0 && Math.floor((index - 1) / cols) === row) out.push(index - 1);
    if ((index + 1) % cols !== 0 && Math.floor((index + 1) / cols) === row) out.push(index + 1);
    return out;
  }

  function rebuildPath(node) {
    const moves = [];
    for (let n = node; n && n.move >= 0; n = n.parent) moves.push(n.move);
    return moves.reverse();
  }

  /**
   * Search for a sequence of elementary slides that solves the board.
   *
   * @param {number[]} board  cells, colour index per cell, -1 for the gap
   * @param {number[]} guide  target colour per column
   * @param {number}   cols   columns on the board
   * @param {object}   [opts] { width, maxDepth }
   * @returns {number[]|null} cell indices the gap moves through, or null
   */
  function solve(board, guide, cols, opts) {
    const options = opts || {};
    const width = options.width || 260;
    const maxDepth = options.maxDepth || 260;
    const cells = board.length;
    const targets = targetsFor(guide);

    const start = Int8Array.from(board);
    const gap = board.indexOf(GAP);
    if (gap < 0) return null;

    const startH = heuristic(start, cols, targets);
    if (startH === 0) return [];

    let beam = [{ board: start, gap, h: startH, parent: null, move: -1, from: -1 }];

    for (let depth = 0; depth < maxDepth; depth++) {
      const next = [];
      // Deduping per depth keeps memory flat; a global visited set on a 6-row
      // board would run to hundreds of thousands of keys.
      const seen = new Set();

      for (let b = 0; b < beam.length; b++) {
        const node = beam[b];
        const moves = neighbours(node.gap, cols, cells);

        for (let m = 0; m < moves.length; m++) {
          const source = moves[m];
          if (source === node.from) continue;      // never undo the last slide

          const child = Int8Array.from(node.board);
          child[node.gap] = child[source];
          child[source] = GAP;

          const key = keyOf(child);
          if (seen.has(key)) continue;
          seen.add(key);

          const h = heuristic(child, cols, targets);
          const entry = {
            board: child, gap: source, h,
            parent: node, move: source, from: node.gap,
            wrong: misplacedCount(child, cols, targets),
            tie: hash(child)
          };
          if (h === 0) return rebuildPath(entry);
          next.push(entry);
        }
      }

      if (!next.length) return null;

      next.sort((x, y) => x.h - y.h || x.wrong - y.wrong || x.tie - y.tie);
      beam = next.length > width ? next.slice(0, width) : next;
    }

    return null;
  }

  /**
   * Solve, widening the beam if a narrow pass fails. Slower but far more
   * reliable on deep scrambles, and still deterministic.
   */
  function solveHard(board, guide, cols) {
    const passes = [
      { width: 120, maxDepth: 200 },
      { width: 400, maxDepth: 300 },
      { width: 1200, maxDepth: 400 }
    ];
    for (let i = 0; i < passes.length; i++) {
      const found = solve(board, guide, cols, passes[i]);
      if (found) return found;
    }
    return null;
  }

  window.BCPSolver = { solve, solveHard, heuristic, targetsFor, neighbours };
})();
