# Block Color Puzzle

A sliding block puzzle inspired by the homemade board game in `../board-game-image.jpg`.

Zero dependencies — plain HTML, CSS and JavaScript. Runs offline and installs to a phone
home screen as a PWA.

## The rules

The board is **5 columns wide**. The top row is a **locked colour guide**: it never moves and
shows which colour belongs in the column beneath it.

Below the guide are the playable rows (5 by default) filled with coloured blocks and **one empty
slot**. Tap any block sharing a row or column with the empty slot and the whole run of blocks
slides across at once — exactly like pushing blocks on the physical board.

**You win when every block sits in the column matching its guide colour.** One colour is one block
short; that column ends up holding the empty slot.

## Controls

| Action | How |
| --- | --- |
| Slide blocks | Tap/click any block in the empty slot's row or column |
| Slide with keyboard | Arrow keys push a block into the empty slot |
| Undo | **Undo** button — steps back one tap |
| Reshuffle the same layout | **Restart** — replays the identical starting board |
| Fresh puzzle | **New** |
| Difficulty | Easy (4 rows) / Normal (5) / Hard (6) |
| Colour hints | Toggle — dims every block that is in the wrong column |
| Symbols | Toggle — adds a shape to each colour for colourblind play |

Best time is tracked per difficulty in `localStorage`.

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

Serve the folder over HTTPS (or a tunnel), open it in Chrome on Android, then use
**Add to home screen**. It launches fullscreen and works with no connection.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and app shell |
| `styles.css` | Theme, board frame, tile animation |
| `game.js` | Board model, sliding, win detection, timer, persistence |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Offline cache (stale-while-revalidate) |
| `tools/make-icons.js` | Regenerates the PNG icons — no image libraries needed |

Regenerate icons after changing the artwork:

```powershell
node tools/make-icons.js
```

## Design notes

**Every puzzle is guaranteed solvable.** The board is built in its solved state and then scrambled
using only legal slides, so the scramble is always reversible. No parity check is required.

**Undo is exact.** A slide is its own inverse, so pushing the empty slot back to its previous
position restores the whole run. History therefore stores only the previous gap index.

**Moves count blocks, not taps** — sliding a run of three counts as three, matching how the
physical race is scored.

Bumping `CACHE` in `sw.js` forces clients onto a new build.
