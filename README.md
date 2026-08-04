# Block Color Puzzle

A sliding block puzzle inspired by the homemade board game in `../board-game-image.jpg`.

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
**New** button is locked so the board cannot be rerolled — **Restart** replays it.

Solving it banks a result and extends your streak. Miss a day and the streak
resets, but your best streak is kept. **Share** copies a spoiler-free summary:

```
Block Color Puzzle — 2026-08-04
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

> The par is currently derived from the number of misplaced blocks, which is a
> true lower bound but only an estimate of the real optimum. It will be replaced
> with an exact figure once the solver lands.

## Controls

| Action | How |
| --- | --- |
| Slide blocks | Tap/click any block in the empty slot's row or column |
| Swipe | Drag on the board — a swipe toward the empty slot slides the whole run at once |
| Slide with keyboard | Arrow keys push a block into the empty slot |
| Undo | **Undo** button — steps back one tap |
| Reshuffle the same layout | **Restart** — replays the identical starting board |
| Fresh puzzle | **New** |
| Mode | Free play (endless random boards), Daily (one shared puzzle a day), or Levels (24-puzzle campaign) |
| Difficulty | Easy (4 rows) / Normal (5) / Hard (6) — free play only |
| Colour hints | Toggle — dims every block that is in the wrong column |
| Symbols | Toggle — adds a shape to each colour for colourblind play |
| Sound | Toggle — synthesised slide/bump/win tones, no audio files |
| Vibrate | Toggle — haptic taps on mobile (hidden where unsupported) |

Solving the board fires a confetti burst. Everything respects
`prefers-reduced-motion`, which skips the confetti entirely.

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

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and app shell |
| `styles.css` | Theme, board frame, tile animation |
| `game.js` | Board model, sliding, swipes, win detection, timer, persistence |
| `fx.js` | Sound, haptics and confetti — self-contained, zero assets |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Offline cache (stale-while-revalidate) |
| `qr.png`, `qr.svg` | QR code for the live site |
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

Bumping `CACHE` in `sw.js` forces clients onto a new build.
