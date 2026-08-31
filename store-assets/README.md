# LoloShop reels — app download

Four finished reels, all 1080×1920 / 30 fps / h264 + AAC 192k, all rendered locally
with **no API and no credits**: headless Chrome screenshots a deterministic `seek(t)`
HTML composition frame by frame, numpy synthesises the score, ffmpeg encodes.

| file | dur | BPM | direction |
|---|---|---|---|
| `loloshop-reel-1080x1920.mp4` | 16.5 s | 120 | the first cut — warm paper, centred device, seven scenes |
| `loloshop-reel-a-film.mp4` | 15.5 s | 80 | **«الوعد»** — ink-graded editorial film. Six photographic plates, dissolves only, device withheld to the last 3 s |
| `loloshop-reel-b-steps.mp4` | 16.5 s | 105 | **«أربع خطوات»** — one continuous take. Zero cuts; a single camera move down an 8900 px canvas in three parallax layers |
| `loloshop-reel-c-grid.mp4` | 15.5 s | 128 | **«٥٤ موديل»** — Swiss poster motion. Tiles on 8th notes, poster numerals, grid collapses into the device |

Each `*-silent.mp4` is the picture without the bed, in case a client wants a
different track. Sources: `reel-src/` (the first cut) and `reel-a-film/`,
`reel-b-steps/`, `reel-c-grid/` — each is an `index.html` plus a `music.py`.

## `shared/` — the kit everything after the first reel is built on

- **`device.css` / `device.html` — iPhone 17 Pro Max drawn to spec.** 440×956 pt
  screen (2.1727), uniform 2.35 mm bezel, 55 pt screen radius, Dynamic Island at
  125×36.7 pt, 62 pt status bar, 140 pt home indicator, action button + volume pair
  + power + Camera Control. Every dimension is a fraction of one `--dw` variable, so
  scaling it cannot make it lie. Finishes: `dev-ti`, `dev-blue`, `dev-orange`
  (Cosmic Orange).
- **`app/` — the real app.** Screens captured off lolo-shop96.com in production at
  **440×894 pt** — 956 minus the status bar, because headless Chrome has no
  safe-area insets and the device draws the status bar itself. That is why the app
  header never sits under the Island. `shots.mjs` gets the *in-app* UI by setting
  `window.androidBridge` at document start (the native signal `lib/app-gate.ts`
  checks for); without it the mobile UA is bounced to the store listing.
  `strip-shop.jpg` is a 2400 CSS px tall strip with the fixed chrome hidden, so the
  catalogue genuinely scrolls under `chrome-header.jpg` / `chrome-tabbar.jpg`.
- **`lolo.css`** — tokens lifted verbatim from `frontend/app/globals.css @theme`,
  plus a `--night` register for dark reels. Self-hosted Amiri / Cairo / Playfair
  extracted from the Next build.
- **`timeline.js`** — the engine: easings (`eSoft` is the cinematic one, no
  overshoot), `tw` / `vis` / `hit` / `drift`, `arNum` for Arabic-Indic numerals with
  the U+066C mark, `grainAt` (deterministic from the frame index — never RNG), and
  **`makeGrid(SC_A, SC_B)`**.
- **`FACTS.md`** — every verified number and every line of live copy. Nothing in a
  reel may contradict it and nothing may be invented.
- **`PIPELINE.md`** — commands, the `seek(t)` contract, and the self-review checklist.
- **`verify_audio.py`** — the measurement gate. `music-template.py` — a scored bed
  to start from.

## Two rules that decide whether a reel reads as professional

**Cut to the beat.** Pick a BPM, then make every scene a whole number of beats.
Animate freehand against `SC_A` and remap onto the grid with `makeGrid` — the whole
film moves onto the beat without a single keyframe being re-timed. `music.py` carries
the mirror image as `g()`; change one, change both.

**Measure the audio, never listen to it on a laptop speaker.** `verify_audio.py`
must print ALL PASS. Two detector bugs are already fixed in it and both cost real
time: a click is *not* a big sample-to-sample step (a clean 8 kHz tone at 0.7 steps
~0.74 per sample at 44.1 kHz), it is an impulse measured against local statistics;
and envelope frames must be 10 ms, not 1 ms, or a 100 Hz pad is a fraction of a cycle
and the frame RMS is pure phase noise.

## Re-render any reel
```bash
cd store-assets
python3 -m http.server 8899 --bind 127.0.0.1 &
google-chrome --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9341 --user-data-dir=/tmp/chr-l1 about:blank &
cd reel-a-film   # or reel-b-steps / reel-c-grid
node ../shared/render.mjs --port 9341 --url http://127.0.0.1:8899/reel-a-film/index.html \
  --out frames --fmt jpeg --q 96 --fps 30 --dur 15
python3 music.py && python3 ../shared/verify_audio.py
# then the two ffmpeg passes in ../shared/PIPELINE.md, then: rm -rf frames
```
~8 fps capture, so a 15 s reel is about a minute of rendering. **Kill Chrome and the
server afterwards** — three headless instances is most of this laptop's spare RAM.

## Before re-posting any of these
Prices and the ٢٬٠١٧ signup count are live values read on 2026-08-22. Re-check them
against the site if the reels sit unused for a few weeks.
