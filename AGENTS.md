# Working on this repo

Notes for whoever picks this up next, human or agent. `README.md` covers what the game
is and why it is built the way it is. This file covers the things that will waste your
time if you do not know them.

## Orientation

| | |
| --- | --- |
| Live site | https://adamsdenniskariuki.github.io/block-color-puzzle/ |
| Remote | `adamsdenniskariuki/block-color-puzzle` — public, **personal** account |
| Local | `Q:\inno\game\block-color-puzzle` — standalone repo, unrelated to any worktree it is edited from |
| Hosting | GitHub Pages, builds automatically on push to `main` |
| Stack | No build step, no framework, no bundler. Static files served as-is. |

Because there is no build step, what is in the repo is exactly what ships. Editing a
file is deploying it.

## Deploying

Two traps, both silent.

### 1. Bump the service worker cache or nothing ships

`sw.js` starts with `const CACHE = 'bcp-vN'`. Returning visitors are served from that
cache. **If you change any file in its `ASSETS` list and do not bump `N`, your deploy is
invisible** to everyone who has already opened the app. It will look fine to you in a
fresh incognito window, which is what makes it easy to miss.

Bump it in the same commit as the change. Docs and tests are not in `ASSETS`, so they do
not need one.

Even with a bump, users see new assets on the visit *after* the one that discovers the
new worker. `sw.js` calls `skipWaiting()` on install and `clients.claim()` plus old-cache
deletion on activate, so it is one reload, not several — but it is not instant.

### 2. The shell's GitHub token is the wrong account

Every fresh PowerShell process has `GH_TOKEN` and `GITHUB_TOKEN` set to a **work**
token. Pushing with those either fails or pushes as the wrong identity. Remove both in
*every* command that touches the remote:

```powershell
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
$t = gh auth token
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$t"))
git -c http.extraheader="AUTHORIZATION: basic $b64" push origin main
```

Commit with `git -c user.name="Adams Dennis" commit ...` for the same reason.

Confirm a deploy landed:

```powershell
gh api repos/adamsdenniskariuki/block-color-puzzle/pages/builds/latest `
  --jq '{status, commit, created_at, error: .error.message}'
```

Allow 30s–2min for the build.

## Tests

```powershell
npm install       # jsdom + playwright, dev-only
npm run test:all  # 184 tests, about 15s
```

| Command | Tests | Needs a browser |
| --- | --- | --- |
| `npm run test:unit` | 17 | no |
| `npm run test:integration` | 59 | no |
| `npm run test:palette` | 4 | no |
| `npm test` | 80 | no |
| `npm run test:layout` | 104 | yes, headless Chromium |
| `npm run test:all` | 184 | yes |

`node --test` runs files in parallel but the tests *inside* a file serially. The two
big suites each take about 13s, so `test:all` costs about what the slowest file costs.
Splitting a file buys nothing until one of them dominates.

Tests drive the **real shipped files** through a `window.__bcp` hook that `game.js`
publishes only on `127.0.0.1`/`localhost`, so it never exists in production. There is no
duplicated copy of the logic to drift out of sync.

### Gotchas

- **`node --test tests/` fails.** It picks up `tests/helpers/*.mjs`, which are not test
  files. Use the npm scripts or explicit paths.
- **Difficulty buttons live inside the closed `#settings` modal.** A Playwright locator
  for `.seg-btn` will hang until you click `#btn-settings` first. Use the suite's
  `setDifficulty()` helper.
- **node:test has no default timeout.** Always call `context.setDefaultTimeout(...)` on
  a Playwright context or a hang becomes an indefinite hang.
- **Block the service worker per page** with `page.route('**/sw.js', r => r.abort())`,
  or a cached asset from an earlier run will be served mid-suite.
- **Settle with two `requestAnimationFrame` calls** after anything that triggers a
  re-layout. One is not enough.
- **`playwright` is pinned exactly**, no caret. npm's `latest` dist-tag currently points
  at a prerelease, so a range would drift unpredictably.
- **jsdom fires animation frames on a ~16ms timer**, not the microtask queue. Anything
  the game defers into rAF — the hint search does, so the button can repaint before the
  solver blocks the thread — must be awaited with a predicate, never a fixed tick count.
  Counting ticks was flaky about one run in six.
- **jsdom clicks buttons inside `hidden` parents.** Once a control moves into a sheet,
  `h.click('#btn-restart')` still fires and proves nothing about whether a user could
  reach it. Assert containment (`$('#more').contains(...)`) and the open path instead.
- **A `disabled` button silently makes a test vacuous** for the opposite reason: the
  click never fires, so any assertion after it passes by default. The daily-mode test
  spent months "proving" the daily does not reroll while clicking a dead button.
- **`state.seed` does not exist.** Free play uses `Math.random`; daily and levels build
  an RNG from `mulberry32(seedFrom(...))` and keep no seed. Asserting on it compares
  `undefined` to `undefined` and always passes. Compare `state.board` instead.
- **An assertion whose expected value equals the default is vacuous.** The cursor defaults
  to the gap, so "the cursor follows the block it just slid" passed even with the follow
  logic disabled — the block ends up *in* the old gap, which is where a dead cursor already
  was. It needed a second assertion at a position the default cannot produce.
- **jsdom always reports `document.visibilityState` as `'visible'`.** Dispatching a bare
  `visibilitychange` does nothing to a handler that guards on the state, so the test looks
  like it exercised the exit path when it never entered the branch. Force it first:
  `Object.defineProperty(h.doc, 'visibilityState', { value: 'hidden', configurable: true })`.
- **A failing jsdom test hangs the runner after it reports.** The failure throws before
  `h.close()`, so the window's timers keep the process alive and `node --test` prints its
  summary and then sits there. Pass `--test-timeout=20000` when running a mutation, and be
  ready to `stop_powershell`.
- **A guard that a cheaper guard already covers is untested by definition.** "A saved board
  that does not match its own size is discarded" passed with the size check deleted, because
  truncating the board also pushed the gap out of range and the *gap* check caught it. Feed a
  case only the guard under test can reject — here, appending a cell rather than removing one.

### Layout tests assert invariants, never pixels

Exact numbers change with any style tweak and prove nothing. The assertions are: the
controls never fall below the fold, the page never scrolls in either direction, the cell
stays inside its 34–78px clamp, the guide never overlaps the board, slots never overlap,
and every slot sits where the grid arithmetic says. Eleven viewports, three difficulties.

### Verify a regression test fails on the broken code before keeping it

This is not a platitude here — it has already caught two worthless tests.

The help modal once let its text show through the sticky dismiss button. Two obvious
assertions **both passed on the broken CSS**:

1. `document.elementFromPoint()` at the footer returns the footer even when it is
   visually transparent. Background transparency does not affect hit testing, so a
   hit test fundamentally cannot see show-through.
2. Comparing the scroll container's `getBoundingClientRect().bottom` against the
   footer's `.top` also passes, because an `overflow: visible` child's *box* still ends
   where the next flex sibling begins. Only its painted content escapes.

The symptom was visual, so the assertion had to be visual: screenshot the footer band at
three scroll positions and require the PNG buffers to be byte-identical. No image
decoding, no extra dependency.

**It no longer bites, though.** The markup has since moved to a `flex: none` `.modal-foot`
that is a *sibling* of `.modal-scroll` rather than an overlay on top of it, so no content
can pass behind the band by construction. Forcing `background: transparent` on the footer
leaves the test green. Treat it as a structural guard, not proof — if the footer ever goes
back to overlaying the scroll area, rebuild the assertion and re-verify it fails first.

It used to be the one test sensitive to machine load: under a full parallel run the
compositor could still be a frame behind when the screenshot was taken, so the band differed
for reasons that had nothing to do with the CSS. It now re-shoots the band until two
consecutive frames match before recording. That is safe because a real bleed is a
*steady-state* difference between scroll positions, not a transient one.

## CSS traps

- **`prefers-reduced-motion` blocks are opt-in lists, not blanket rules.** There are two
  of   them (at lines 432 and 744 of `styles.css`) and each names individual selectors.
  A new transition is *not* covered automatically — add it by hand or you have shipped an
  accessibility regression that nothing will catch.
- **A flex child that should scroll needs `min-height: 0`.** Without it it refuses to
  shrink below its content height and the scroll never engages. This is why
  `.modal-scroll` has it.
- **The scrolling element in the help modal is `.modal-scroll`, not `.modal-card`.**
  Any `scrollTop` manipulation must target it.
- **The landscape grid uses `minmax(0, 1fr)`, never `auto`.** An `auto` column sizes
  itself to the board, whose size is derived from the column width. That loop does not
  converge.
- **The landscape breakpoint is `min-width: 520px`, not 600px.** A 568×320 landscape
  iPhone SE sits between the two; at 600px it fell back to the stacked layout and
  overflowed the viewport by 67px at six rows.
- **A single unbreakable word does not wrap -- it spills clean outside its flex item.**
  This is why the one-line settings swatches have a `max-width: 379px` fallback that puts
  the palette card back to stacked. The width budget was measured, not guessed: at 360px
  a swatch cell gives 107px of inner room, five 12px chips overlapped at -4px cost 44px,
  and "Accessible" costs 63px, so it is exactly borderline at 360 and overflows at 320.
  iPhone SE 320x568 is in the supported matrix, so that fallback is load-bearing.
  Ellipsis was rejected deliberately -- the label exists to be read.
- **Sibling-specific spacing rules rot.** `.seg + .field-label` silently gave zero top
  margin to every heading that happened to follow a new section type. Prefer a general
  `.field-label` margin plus `:first-child` / `h2 +` exceptions.

## Theme traps

- **Theme rules are bare attribute selectors (`[data-appearance="forest"]`), not
  `:root[data-appearance=...]`.** That is deliberate: putting `data-appearance` on *any*
  element re-scopes those variables to it and its descendants, which is how each swatch in
  the settings picker paints itself in the theme it offers while the card around it stays
  in the current theme. Do not "tidy" these into `:root[...]` — it silently breaks the
  previews.
- **`dark` needs its own `[data-appearance="dark"]` block even though `:root` already
  holds that palette.** `:root` is the same element the active theme sits on, so a nested
  dark preview would inherit the *current* theme and preview the wrong thing. `:root`
  keeps the palette so the first paint is right before JS runs; the duplicate block makes
  the preview right. Both are load-bearing.
- **A theme block must define every colour token it wants, even ones `:root` already
  has.** Because previews are nested, an undefined token does *not* fall back to `:root` —
  it inherits from the surrounding theme, so the swatch shows a colour belonging to a
  different theme. Slate shipped with no `--accent`: correct at root, wrong in every
  preview. `a theme previewed inside another theme still looks like itself` in
  `tests/layout.test.mjs` compares each theme nested vs. at root and names the missing
  token. Geometry tokens (`--radius`, `--gutter`, `--cell`, `--slot`) and the deliberately
  theme-independent ones (`--gold`, `--danger`) are correctly left undefined.
- **Never rename a theme id that has shipped.** `loadPrefs` validates the saved id against
  `APPEARANCES` and silently falls back to dark, so everyone using that theme loses it on
  their next refresh with no clue why. Renaming `sand` → `amber` did exactly this. Add a
  forwarding entry to `APPEARANCE_ALIASES` in `game.js` instead; there are tests covering
  both the alias and the genuinely-unknown case.
- **Anything drawn *on* the accent must not use `--text`.** `--text` inverts with the
  theme, so a switch knob that is white on dark themes turns near-black on light ones
  while its track stays coloured. Use `--frame` (near-white in every theme) or
  `--on-accent`.
- **Any new colour must be a token, not a literal.** Four literals are deliberate
  exceptions — the white tile outline, the tile label `rgba(255,255,255,0.92)`, the
  win-banner green and the star gold. All four sit on saturated tiles or coloured banners
  and are theme-independent. Everything else must go through a variable or it will break
  on `light` and `paper`.
- **White-alpha washes invert.** `rgba(255,255,255,0.06)` is invisible on a light theme.
  Use `var(--wash)`, which flips to black-alpha in `light` and `paper`.
- **Themes are separated by hue, not brightness.** The original three were one blue-grey
  at three lightnesses and users read them as a single theme with a dimmer switch. A new
  theme that only changes lightness is not a new theme.
- **jsdom cannot resolve custom properties**, so theme coverage lives in
  `tests/layout.test.mjs` (real Chromium). It asserts every appearance applies, has a
  unique background, and clears 4.5:1 for both body text and text-on-accent. A typo'd
  selector shows up as a duplicate background.

## Palette traps

- **Palettes are separated by hue rotation, not saturation.** All four originally walked
  the same red-green-blue-purple-yellow wheel and differed only in saturation and
  lightness, so switching read as one palette with a slider. Each now sits at its own
  rotation. `tests/palette.test.mjs` measures CIELAB distance between palettes slot for
  slot and fails below dE 30.
- **A palette whose colours sit close together is a difficulty bug, not a style choice.**
  The whole game is telling five colours apart. The original `Ocean` shipped with a blue
  and an indigo dE 20.5 apart against Classic's 59.2, which made it materially harder to
  play, and nothing caught it because no test looked at the colours. The same file now
  enforces a within-palette floor of dE 45.
- **"Ocean" is why that happened, and the lesson generalises**: a palette named after
  something monochrome forces five hues into one corner of the wheel and they collide.
  It was renamed `Jewel` so the colours could spread out. Check a palette concept admits
  five well-separated hues *before* picking the name.
- **`Accessible` is the Okabe-Ito set and must not be retuned.** It buys colour-blind
  safety at the cost of raw separation (dE 33 within, 28 against Classic), so it has its
  own lower floors in the tests. Everything else gets the higher ones.
- **Renaming a palette id breaks saved prefs** exactly like renaming a theme id does --
  `loadPrefs` validates against `PALETTES` and silently drops the player back to
  `classic`. Add a `PALETTE_ALIASES` entry, same as `APPEARANCE_ALIASES`.

## Board traps

- **The empty slot is game state, not decoration.** It is the one thing a player has to
  find every turn, and it is a pure CSS artefact — a translucent fill plus inset shadows,
  with no element of its own (`renderBoard` skips the gap, so there is nothing to label).
  It shipped at **1.25:1** against the frame, i.e. very nearly invisible, because the
  token value was reviewed but the rendering never was.
- **Test the rendered pixels, not the token.** The fill on its own is only ~1.4:1; the rim
  and top shadow carry the 3:1 that WCAG 1.4.11 wants. `tests/layout.test.mjs` screenshots
  the gap, decodes it through the page's own canvas (no dependency), and takes the darkest
  pixel. A fill-based assertion would have passed the broken version.
- **Raised and recessed are opposite shadows.** Tiles read as raised via a dark lip at the
  *bottom* (`inset 0 -3px 0`); the slot reads as a hole via a dark edge at the *top*.
  Adding a light bottom highlight to the slot flips it straight back to looking like a
  block — it was tried and rejected.
- **`aria-label` on a tile is owned by `refreshTileState`, not `renderBoard`.** It carries
  the movable state, which changes every move. Setting it in both places is how it rots.
- **Assistive tech cannot see the gap at all** without `#board-status`. `role="application"`
  on the board means the app owns every announcement, so nothing is reported for free.

## Stats traps

- **The lifetime totals split into two kinds of counter.** *Activity* — moves, time, hints,
  undos, started — is earned by playing and is banked whenever you leave a board. *Achievement*
  — solved, finish rate, average, best — needs a completed board. Adding a counter means
  deciding which half it belongs to; putting an activity counter behind `finish()` is the bug
  this section exists to prevent.
- **Activity is banked as a delta, never as a flag.** `flushActivity()` writes
  `state.moves - state.bankedMoves` and then moves the marker. A one-shot "already banked"
  boolean cannot work, because `visibilitychange` fires **every time** a mobile user switches
  away and back, so the same board is flushed many times before it is solved.
- **Move deltas can be negative.** `undo()` decrements `state.moves`, so a background-flush
  followed by undos produces a negative delta. That is correct — it un-counts a move the game
  itself no longer counts — so `bumpStats` clamps the *stored* total with `Math.max(0, …)`
  rather than rejecting the delta.
- **Both `pagehide` and `visibilitychange` are wired.** Safari and several mobile browsers skip
  `pagehide`, and desktop tab-close does not always fire `visibilitychange`. Delta banking makes
  the double-fire harmless, so wiring both is cheaper than working out which one you have.
- **`abandonBoard()` must `stopTimer()` before it flushes.** `stopTimer` is what recomputes
  `state.elapsed`; flushing first banks a stale figure. It also pauses the clock while the app is
  hidden, which is what a player expects — `startTimer()` resumes correctly because it sets
  `state.startedAt = Date.now() - state.elapsed`.
- **"Started" counts on the first move, not on the deal.** Opening the app and closing it again
  used to log a started puzzle and drag the finish rate down for free. The bump lives in
  `slideTo()` behind `if (!state.counted)`.

## Resume traps

- **`saveInplay()` hangs off `updateHud()`.** That looks like a layering mistake and is not:
  `updateHud` is called from exactly the five board-mutating sites (`slideTo`, `undo`, `finish`,
  `newGame`, `restart`), so any future mutation persists for free instead of quietly failing to.
  The timer writes `el.time.textContent` directly and never routes through `updateHud`, so this
  is not a four-times-a-second localStorage write. `showHint` does not touch the board, so it
  calls `saveInplay()` itself.
- **`abandonBoard()` saves *after* it flushes.** The snapshot has to carry the banking markers
  `flushActivity()` just moved and the `elapsed` that `stopTimer()` just recomputed. Saving first
  writes a snapshot that will double-count on resume.
- **The whole position is stored, not a seed.** Free play has no seed at all, and for daily and
  levels a seed only rebuilds the *starting* board — which throws away exactly the thing worth
  keeping. `state.initial` is stored alongside it so Restart still works after a resume.
- **A restored board must be validated before it reaches the renderer.** `restoreInplay()` checks
  the row count, `board.length === rows * COLS`, `guide.length === COLS`, and that `gap` is in
  range *and* actually null. An older build's board otherwise reaches `renderBoard()` and throws
  during boot, which bricks the app with no way for the user to clear it.
- **A stale daily keeps the mode and drops the board.** Returning `false` from `restoreInplay()`
  after setting `state.mode = 'daily'` lets boot deal today's puzzle in the mode the player was
  already in. Mode is not otherwise persisted.
- **`finish()` clears the snapshot through `saveInplay()`, not by calling `clearInplay()`.**
  `saveInplay()` short-circuits to `clearInplay()` when `state.solved`, so the single hook on
  `updateHud` covers both directions.

## Fade unsorted traps

- **It is a progress display, not a hint.** Roughly three quarters of the blocks on a fresh
  board are in the wrong column (measured: 13-22 of 24), so it can never point at the block to
  move next. It shipped as an outline on every wrong block, which is why nobody could see it -
  a badge on almost everything is a badge on nothing. The affordance runs the other way now:
  `.tile.is-wrong { filter: grayscale(0.92); }` drains the wrong ones so the settled ones are
  the only colour left. The toggle was called "Highlight misplaced" and is now "Fade unsorted",
  because nothing gets highlighted.
- **grayscale, not opacity.** Symbols mode paints the colourblind glyph as `tile.textContent`
  (`game.js` ~765), and blanket opacity would fade that glyph on three quarters of the board.
  `grayscale()` leaves white alone and holds luminance, so the block also keeps the contrast
  against the board that every theme was tuned for.
- **The filter must not go back on `outline`.** `.tile:focus-visible` owns the outline for the
  keyboard cursor, so the old `outline-color` treatment was erased the moment a flagged block
  was focused.
- **A screenshot test has to wait for the transition.** `.tile` transitions `filter` over 130ms,
  and two `requestAnimationFrame` waits photograph the board about a fifth of the way in - the
  first version of the layout test measured `grayscale(0.13)` and read the pixels as barely
  touched. Poll `getComputedStyle(tile).filter` until it stops changing before screenshotting.
- **`getComputedStyle` cannot see this feature working.** The declared `background` never
  changes, so only real pixels prove it. The layout test screenshots `#board`, decodes the PNG
  through the page's own canvas, and compares chroma (`max(rgb) - min(rgb)`) between the two
  groups - not luminance, which the filter preserves on purpose.
- **`store.hints` and `store.stats.hints` are different things.** The first is the toggle
  preference (boolean, top level), the second is the lifetime hint counter. They do not collide.

## Keyboard cursor traps

- **The arrow keys mean two different things.** Inside `#board` they move the cursor; anywhere
  else they keep the original meaning (push the neighbouring block into the gap). The branch is
  `boardHasFocus()` in the keydown handler. A mouse click on a tile would silently flip the user
  into cursor mode, so the tile click handler **blurs when `e.detail > 0`** — keyboard activation
  reports `detail === 0`, a real pointer click reports `> 0`.
- **`syncCursor()` must stay pure.** The first version re-derived `focusCell` from
  `document.activeElement`, so `moveCursor` set the new cell and `syncCursor` immediately reset it
  from the *still-focused old* element. Arrows did nothing while every intermediate value looked
  right. Re-deriving lives in `adoptCursorFromDom()`, called from focus listeners and after slides.
- **The cursor has to be able to land on the gap** — skipping it steps over the one cell the game
  is about. The gap has no tile, so its backing `.slot` div is the focus target; exactly one slot
  is focusable at a time and it is labelled only while it is the gap.
- **A live region ignores an unchanged string.** `announce()` alternates a trailing space, and it
  must compare against `el.boardStatus.textContent`, **not** a remembered variable. The variable
  version deadlocked at `"X "` and stopped announcing entirely.
- **`.tile { outline: 2px solid transparent }` suppresses the default focus ring**, so keyboard
  focus on the board was invisible before this existed. `.is-wrong` reuses that outline slot, so
  the ring has to be drawn explicitly. `.slot` uses `:focus` (it is focused programmatically and
  `:focus-visible` heuristics are unreliable there); tiles use `:focus-visible`.
- **Tiles keep DOM identity across slides** — `slideTo` rewrites `tile.dataset.index`. Focus follows
  the moved block for free, but `state.focusCell` goes stale, hence `adoptCursorFromDom()`.
- **A board test that hardcodes a direction is a random-board flake.** The board is shuffled on
  every boot, so `ArrowRight` is a no-op whenever the gap lands in column 0. Derive the direction
  from `gap % COLS`.

## SVG icon traps

The action row and the board menu use an inline `<symbol>` sprite at the top of
`index.html`, referenced with `<use href="#i-…">`.

- **A descendant selector cannot reach into a `<use>`.** `.icon circle { fill: … }` does
  nothing, because `<use>` clones its content into a shadow tree. Inherited properties
  (`fill`, `stroke`) *do* pass through from the `<use>` element, and an element's own
  presentation attribute beats an inherited value — so set per-shape fills as attributes
  on the `<symbol>` itself.
- **`.sprite` must not be `display: none`.** That kills `<use>` in some browsers. Hide it
  with `position: absolute; width: 0; height: 0; overflow: hidden`.
- **Never write `textContent` on a button that contains an icon** — it wipes the `<svg>`
  child. Every such button has a dedicated label span (`#new-label`); write to that.

## Manifest

`orientation` must **not** be `portrait`. An installed PWA honours it, which silently
makes the entire landscape layout unreachable for the users most likely to want it.
There is a test guarding this.

## PowerShell

- No heredoc. For multi-line strings use a here-string: `@'` on its own line, content,
  then `'@` at **column 0**.
- Multi-line `.Replace()` on file content is unreliable. Use a proper editor tool for
  precise CSS mutations rather than string surgery.
- `&&` only chains native commands. Use `;` before PowerShell keywords.
- **Double quotes interpolate `${...}`.** Passing a JS template-literal fragment such as
  `", ${positionLabel(i)}"` as a double-quoted argument silently expands to `", "`, so a
  mutation test edits the wrong text and appears to pass. Use single quotes for anything
  containing `$`, and make the mutation script fail loudly when the token is not found.

## Mutation testing

Every new test in this repo has to be proven to fail when the behaviour is broken; six
vacuous ones have been found here already.

- **Never restore with `git checkout -- <file>` while the feature is uncommitted** — it
  reverts the work along with the mutation. Copy the file to `$env:TEMP` first and restore
  from that.
- **Assert the mutation applied** before trusting the result. A here-string written as LF
  will not match a CRLF file, and a swallowed `$` will not match either; both look like a
  passing test on unmutated code.
- Prefer newline-free single-line token swaps over multi-line replacements.

## Where things live

`README.md` has a full file table. The ones you will actually touch:

| File | Why you would open it |
| --- | --- |
| `game.js` | Board model, input, layout sizing. `verticalBudget()` and `metrics()` are the sizing core. |
| `styles.css` | Breakpoint tiers, then the landscape block, then reduced-motion. |
| `index.html` | The DOM contract the tests depend on. Changing IDs breaks tests. |
| `sw.js` | Bump `CACHE` on every change to a file in its `ASSETS` list. |
| `tests/layout.test.mjs` | Read `measure()` first — it defines everything the assertions can see. |

## Status

Shipped: core game, daily challenge, level campaign, solver hints, stats, themes,
accessibility settings, offline PWA, landscape layout.

Open threads:

- **App stores.** Microsoft Store via PWABuilder is the only route that takes the PWA
  as-is. Google Play needs a TWA plus `assetlinks.json` at the **origin root**
  (`adamsdenniskariuki.github.io/.well-known/`) — this repo publishes under
  `/block-color-puzzle/` and *cannot* serve that, so it needs a separate
  `adamsdenniskariuki.github.io` repo or a custom domain; new personal accounts also owe
  12 testers for 14 continuous days. Apple wants a Mac, $99/yr, and rejects thin web
  wrappers under Guideline 4.2.
- The game is already installable via Add to Home Screen. Stores buy discoverability,
  not capability.
