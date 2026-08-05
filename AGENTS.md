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
npm run test:all  # 111 tests, about 11s
```

| Command | Tests | Needs a browser |
| --- | --- | --- |
| `npm run test:unit` | 17 | no |
| `npm run test:integration` | 34 | no |
| `npm test` | 51 | no |
| `npm run test:layout` | 60 | yes, headless Chromium |
| `npm run test:all` | 111 | yes |

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
decoding, no extra dependency. Reintroducing the bug turns it red.

Because it compares raw pixels, this is the one test sensitive to machine load — it has
gone red once under a concurrent `npx` call and once during a full parallel run, then
passed on every isolated re-run. If it fails alone, believe it. If it fails only inside
`test:all`, re-run `npm run test:layout` before touching any CSS.

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
