# Sortile

Colour block puzzle — a sliding block game inspired by the homemade board in
`../board-game-image.jpg`. Published to the Microsoft Store as
*Sortile — Colour Block Puzzle*.

Zero dependencies — plain HTML, CSS and JavaScript. Runs offline and installs to a phone
home screen as a PWA.

## Play it

**[adamsdenniskariuki.github.io/block-color-puzzle](https://adamsdenniskariuki.github.io/block-color-puzzle/)**

Scan to open it on your phone:

<img src="qr.png" alt="QR code linking to the game" width="220">


## The rules

The board is **5 columns wide**. The top row is a **locked colour guide**: it never moves and
shows which colour belongs in the column beneath it.

Below the guide are the playable rows (5 by default) filled with coloured blocks and **one empty
slot**. Tap any block sharing a row or column with the empty slot and the whole run of blocks
slides across at once — exactly like pushing blocks on the physical board.

**You win when every block sits in the column matching its guide colour.** One colour is one block
short; that column ends up holding the empty slot.

## The daily challenge

**Daily** builds one puzzle per UTC date from a seeded generator, so everyone
gets the same board on the same day. It is always Normal (5 rows), and the
**New board** button is hidden so the board cannot be rerolled — **Restart** replays it.

Solving it banks a result and extends your streak. Miss a day and the streak
resets, but your best streak is kept. **Share** copies a spoiler-free summary:

```
Sortile — 2026-08-04
🟩🟥🟦🟪🟨
1:24 · 37 moves · streak 5
```

The emoji strip is that day's guide-row order, so it is a fingerprint of the
puzzle without giving the solution away. On phones it opens the native share
sheet; elsewhere it falls back to the clipboard.

## Levels

**Levels** is a 24-puzzle campaign. Difficulty climbs in three blocks of eight:
the board grows from 4 rows to 6, and within each block the scramble depth ramps
geometrically from a handful of slides to a full random shuffle. Every level is
seeded by its number, so it is the same puzzle for everyone, every time.

Each level carries a **move par**. Beat it for three stars, stay within about
1.6× for two, finish at all for one. Solving a level unlocks the next, and your
best attempt is kept — a sloppy replay never costs you stars.

Par is derived from an actual solution: the solver searches the level's seeded
board and par is set 25% above the length it finds. Because every level is
seeded, that figure is identical for every player.

## Hints

Stuck? **Hint** runs the solver from the position you are actually in and rings
the one block you should move next. You get **three per puzzle**, and a badge on
the button counts down what is left. Pressing Hint again before making a move
repeats the same answer without spending another one. Restarting or dealing a
new board resets them.

The solver is a beam search over legal slides, guided by the total column
distance of every block from its target column. It typically answers in well
under a tenth of a second.

## Stats and themes

The **📊** button in the topbar opens a lifetime record — puzzles solved, finish
rate, total moves, time played, average solve, hints and undos, your daily
streak, levels cleared and stars earned, plus your best run in each difficulty.
Counters are written at board boundaries rather than on every slide, so playing
stays cheap. A puzzle counts as *started* on your first move, not when it is
dealt, and the effort you put into a board is banked whenever you leave it —
including closing or backgrounding the app. Walking away therefore still adds to
your moves, time, hints and undos; only the *solved* counters, and the finish
rate and average built on them, need a completed board.

The settings sheet carries two appearance controls:

- **Colours** — four palettes, each on a different part of the colour wheel so
  switching changes the board rather than just its saturation. `Classic` is the
  original board, `Accessible` uses the Okabe-Ito set chosen for maximum
  separation under the common forms of colour blindness, plus the bright `Candy`
  and the deeper `Jewel`. Switching repaints the blocks in place, so your board
  and timer survive the change. `tests/palette.test.mjs` holds every palette to a
  measured minimum separation, both within itself and against the others.
- **Appearance** — eight themes, from `Dark` and `Midnight` through `Slate`,
  `Forest`, `Plum` and `Amber` to the light `Light` and `Paper`, re-tinting the
  surfaces around the board. The board frame itself stays light in every theme
  because the block colours are tuned against it.

Symbols are keyed to the colour's *slot*, not the palette, so a shape always
means the same column no matter which palette you pick. Both choices persist.

## Controls

Mode sits above the HUD so **Daily**, **Levels** and **Free play** are always one
tap away. **New board** sits beside it in Free play, becomes **Choose level** in
Levels, and disappears in Daily because that puzzle cannot be rerolled.

Four buttons sit under the board — **Undo**, **Hint**, **Restart**, and **⚙**.
The gear opens a settings sheet holding difficulty, colours, appearance and the
four set-and-forget toggles.

The **Saved data** section in Settings exports those preferences together with
lifetime statistics, daily history and level progress as a readable JSON file.
Import validates the whole file first, then asks before replacing the saved
settings and statistics in one step. The puzzle currently in progress is not
included in an export and stays open through an import.

The **Feedback** row opens a preflight before launching your email app.
The prepared message goes to `sortilefeedback@gmail.com` and includes only the
Sortile version/build, current mode and board size, and a broad device/browser
description. Daily and Levels can optionally add their non-personal puzzle ID.
Statistics, saved data, board position, moves, timing and hints are never added.
If an email app or clipboard is unavailable, the same text stays selectable for
manual copying.

| Action | How |
| --- | --- |
| Slide blocks | Tap/click any block in the empty slot's row or column |
| Swipe | Drag on the board — a swipe toward the empty slot slides the whole run at once |
| Slide with keyboard | Arrow keys push a block into the empty slot |
| Navigate the board | **Tab** onto the board, then arrow keys move a cursor cell by cell (including onto the empty slot); **Enter**/**Space** slides the selected block |
| Undo | **Undo** button — steps back one tap |
| Ask for a nudge | **Hint** — rings the next block to move, three per puzzle |
| Reshuffle the same layout | **Restart** — replays the identical starting board |
| Fresh puzzle | **New board** beside the mode control |
| Lifetime stats | **📊** in the topbar |
| Mode | Main screen — Free play (endless random boards), Daily (one shared puzzle a day), or Levels (24-puzzle campaign) |
| Difficulty | ⚙ — Easy (4 rows) / Normal (5) / Hard (6) — free play only |
| Colours | ⚙ — Classic / Accessible / Candy / Jewel |
| Appearance | ⚙ — Dark / Midnight / Slate / Forest / Plum / Amber / Light / Paper |
| Saved data | ⚙ — export or import settings, statistics and progress |
| Feedback | ⚙ — prepare an email with a small, privacy-safe diagnostic summary |
| Fade unsorted | ⚙ toggle — drains the colour from every block that is in the wrong column, so the ones already home are the only colour left on the board |
| Symbols | ⚙ toggle — adds a shape to each colour for colourblind play |
| Sound | ⚙ toggle — synthesised slide/bump/win tones, no audio files |
| Vibrate | ⚙ toggle — haptic taps on mobile (hidden where unsupported) |

Solving the board fires a confetti burst. Everything respects
`prefers-reduced-motion`, which skips the confetti entirely.

**You never lose a board.** Close the tab, background the app or reload, and the
position, move count, elapsed time, undo history and remaining hints all come
back exactly as you left them — no "continue?" prompt, you are simply back in the
puzzle. Free play needs this most, since its boards are random and could not be
rebuilt otherwise, but Daily and Levels get it too so you are never made to redo
work on a puzzle you cannot reroll. A daily left over from a previous day is the
one thing dropped: you stay in Daily and get that day's puzzle instead.

The empty slot is the one piece of state you need every turn, so it is drawn as a
recess — a dark inner top edge and rim, the inverse of the raised lip on the blocks —
and held above 3:1 against the frame in every theme by a test that samples the
rendered pixels. It carries no "Empty" label: the gap is the only cell without a
block, so the word would name an absence and add nothing. For assistive tech, where
the gap genuinely is invisible, every block announces its colour, its row and column,
and whether it can currently move, and a live region reports where the empty slot
lands after each move.

Best time is tracked per difficulty in `localStorage`, alongside your daily
streak and the last 60 daily results.

## Running it

Any static file server works. It must be served over `http://` or `https://` — opening
`index.html` from the filesystem will not register the service worker.

```powershell
cd block-color-puzzle
python -m http.server 8123 --bind 127.0.0.1
# then open http://127.0.0.1:8123
```

Or with Node:

```powershell
npx --yes serve -l 8123 .
```

## Installing on a phone

Open the [live site](https://adamsdenniskariuki.github.io/block-color-puzzle/) in Chrome on
Android — scan the QR code above — then use **Add to home screen**. It launches fullscreen and
works with no connection.

To install from your own copy, serve the folder over HTTPS (or a tunnel) and do the same.

An original **Block Puzzle** install in Chrome, Edge or Android should rename itself to
**Sortile** after the browser refreshes the manifest; close every app window and allow up to
24 hours. Android may also wait for Wi-Fi and charging. If it was installed during the brief
period when the manifest used the wrong app identity, uninstall and reinstall once. iPhone
and iPad home-screen labels do not reliably refresh, so remove the old icon and add it again.

## Tests

The suite boots the real shipped files inside jsdom and drives them the way a player would,
so it tests the deployed code rather than a copy of its logic.

```powershell
npm install   # jsdom and playwright, both dev-only
npm test
```

| Command | What it runs |
| --- | --- |
| `npm test` | Unit, integration and palette — 83 tests, no browser needed |
| `npm run test:unit` | Pure logic: RNG, formatting, level curve, geometry, solvability |
| `npm run test:integration` | Real DOM: tapping, keys, undo, hints, modals, modes, persistence |
| `npm run test:layout` | Sizing in headless Chromium across eleven viewports — 105 tests |
| `npm run test:all` | All of the above |

The unit tests cover the parts with no DOM: seeding and the deterministic RNG, time
formatting, the streak date maths, the star thresholds, the level difficulty curve, board
geometry, and the solvability invariant — a board is built solved and scrambled only by legal
slides, so a solver replay must always finish it.

The integration tests click and type: they slide blocks, check a run slide counts blocks
rather than taps, undo it in one step, spend all three hints, open each modal and close it
with Escape, switch palette and confirm the board is repainted in place rather than reshuffled,
play the daily and a level through to a win, and reboot from saved storage to prove
preferences, stats and progress survive.

Anything the game defers into `requestAnimationFrame` — the hint search, which yields a frame
so the button can repaint before the solver blocks the thread — is awaited with a predicate
rather than a fixed delay. jsdom fires animation frames on a ~16ms timer, not the microtask
queue, so counting ticks makes a test flaky roughly one run in six.

### Layout

Sizing needs a real box model, so those tests run in headless Chromium instead. They start
their own static server on a spare port, then walk eleven viewports — from a 320px iPhone SE to a
1280px desktop, including four landscape phones — at all three difficulties.

They assert invariants, never pixel values. Exact numbers change with any style tweak and prove
nothing; what matters is that the controls never fall below the fold, the page never scrolls in
either direction, the cell stays inside its 34–78px clamp, the guide never overlaps the board,
slots never overlap each other, and every slot sits exactly where the grid arithmetic says it
should. One test resizes back and forth to prove the sizing converges rather than oscillates,
which is what would happen if the budget ever started measuring the board it is sizing.

Writing them immediately turned up two real bugs. `verticalBudget()` was adding up the frame's
padding, gap and divider by hand, but `.frame` is `display:block`, so its `rowGap` was always 0
and the divider's 16px of margins and the frame's 2px border went unaccounted for — enough to
push the controls a few pixels off screen at six rows. It now measures the frame's chrome as a
single leftover instead. Separately, landscape phones could not fit six rows above the 34px
minimum tile at all, so they now get a two-column layout with the board at full height.

Animations stay untested — they are visual by nature.

Tests reach the internals through a `window.__bcp` hook that `game.js` only publishes on
`localhost`, so it is never present on the deployed site.

`AGENTS.md` has the traps that are not obvious from the test code — why `node --test tests/`
fails, why the difficulty buttons hang a locator, and why two reasonable-looking regression
tests both passed on genuinely broken CSS.

## Files

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Deploy recipe, test gotchas and CSS traps — read before changing anything |
| `index.html` | Markup and app shell |
| `styles.css` | Theme, board frame, tile animation |
| `game.js` | Board model, sliding, swipes, win detection, timer, persistence |
| `solver.js` | Beam-search solver behind hints and level par |
| `fx.js` | Sound, haptics and confetti — self-contained, zero assets |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Offline cache (stale-while-revalidate) |
| `qr.png`, `qr.svg` | QR code for the live site |
| `tests/helpers/boot.mjs` | Boots the game in jsdom and stubs the browser APIs it lacks |
| `tests/helpers/serve.mjs` | Throwaway static server for the layout tests |
| `tests/unit.test.mjs` | Pure logic tests |
| `tests/integration.test.mjs` | DOM-driven behaviour tests |
| `tests/layout.test.mjs` | Sizing tests in headless Chromium |
| `tools/make-icons.js` | Regenerates the PNG icons — no image libraries needed |
| `tools/make-qr.js` | Regenerates the QR code (needs `npm i --no-save qrcode`) |

Regenerate icons after changing the artwork:

```powershell
node tools/make-icons.js
```

Regenerate the QR code if the site URL changes:

```powershell
npm install --no-save qrcode
node tools/make-qr.js https://your-new-url/
```

## Design notes

**Every puzzle is guaranteed solvable.** The board is built in its solved state and then scrambled
using only legal slides, so the scramble is always reversible. No parity check is required.

**Undo is exact.** A slide is its own inverse, so pushing the empty slot back to its previous
position restores the whole run. History therefore stores only the previous gap index.

**Moves count blocks, not taps** — sliding a run of three counts as three, matching how the
physical race is scored.

**Blocks of the same colour are interchangeable**, and the guide is a permutation of the five
colours, so each colour has exactly one target column and a block's row never matters. That gives
the solver an admissible heuristic — the total column distance of every block from its target —
since one slide closes at most one unit of it.

**The board scales to the viewport height, not just its width.** A short, wide window — a tablet
or phone in landscape, or a small desktop window — would otherwise push the buttons below the
fold. Vertical room is measured from where the board starts and what sits below it, never from the
board's own height, which would be circular. The frame's own chrome is measured as a single
leftover — frame height minus guide minus board — rather than added up from padding, border, gap
and margins, because that list is easy to get wrong and silently drifts when the CSS changes.

**Landscape phones get their own layout.** Below 480px of height there is no way to fit six rows
above the 34px minimum tile while stacking everything vertically, and all that width goes to
waste. So the board takes a full-height column of its own with the header, stats and buttons
stacked beside it, which roughly doubles the tile size. `verticalBudget()` recognises that case
from geometry — are the controls beside the stage or under it — rather than re-testing the media
query, so the CSS and the JavaScript cannot fall out of step.

The breakpoint is 520px wide, not 600px, because a 568×320 landscape iPhone SE falls between the
two: at 600px it dropped back to the stacked layout and overflowed the viewport by 67px at six
rows. The manifest deliberately does not lock orientation either — an installed PWA honours that
setting, so `portrait` would make this whole layout unreachable for the users most likely to
want it.

**Palette and shape are separate axes.** Symbols are keyed to the colour slot rather than bundled
into the palette, so switching palette can never change what a shape means. Switching repaints the
existing blocks instead of dealing a new board, so a mid-game change costs nothing.

**Stats are written at board boundaries only** — start, solve, and walking away from an unfinished
board — plus hints and undos. Writing to `localStorage` on every slide would be far too chatty. A
solve with no recorded moves is skipped entirely so it cannot drag the lifetime average toward zero.

**The tests run the shipped files, not a copy.** Extracting the logic into a shared module to make
it importable would have meant testing something the browser never loads. Instead `game.js`
publishes a `window.__bcp` hook on `localhost` only, and the test harness boots jsdom at
`127.0.0.1` to switch it on. The three browser APIs jsdom lacks — `matchMedia`, `AudioContext` and
a canvas 2D context — are stubbed in the harness; nothing in the game is stubbed or branched for
tests.

Bumping `CACHE` in `sw.js` forces clients onto a new build.
