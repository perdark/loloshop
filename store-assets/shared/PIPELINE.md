# How to build a reel in this kit

Your composition is ONE self-contained `index.html` in your own folder, next to a
`music.py`. Everything shared lives one directory up in `../shared/`.

```html
<link rel="stylesheet" href="../shared/lolo.css">
<link rel="stylesheet" href="../shared/device.css">
<script src="../shared/timeline.js"></script>
```
Asset paths are then `../shared/assets/…` and `../shared/app/…`.
⚠️ `lolo.css` declares `@font-face` with paths like `assets/cairo-ar.woff2`, which
resolve **relative to the stylesheet**, i.e. `../shared/assets/…`. That is correct —
do not copy the font declarations into your own file.

## Contract with the renderer
At the bottom of your composition:
```js
publish(seek, { dur: 15.0, fps: 30 });   // from ../shared/timeline.js
```
`seek(t)` must be a **pure function of t** — same t, same frame, always. Never call
`Math.random()` or `Date.now()`. Deterministic jitter comes from the frame index
(`grainAt(el, Math.round(tReal*30))`).

## Commands (a static server is already running on 8899 at store-assets/)
```bash
cd <your-folder>
node ../shared/render.mjs --port <YOUR_PORT> \
  --url http://127.0.0.1:8899/<your-folder>/index.html \
  --out probe --fmt jpeg --q 92 --only 0.4,2.0,5.0,9.0,13.0     # probe first, always

node ../shared/render.mjs --port <YOUR_PORT> \
  --url http://127.0.0.1:8899/<your-folder>/index.html \
  --out frames --fmt jpeg --q 96 --fps 30 --dur <DUR>

python3 music.py && python3 ../shared/verify_audio.py          # must print ALL PASS

ffmpeg -y -framerate 30 -i frames/%05d.jpg -c:v libx264 -preset slow -crf 18 \
  -pix_fmt yuv420p -movflags +faststart ../<NAME>-silent.mp4
ffmpeg -y -i ../<NAME>-silent.mp4 -i bed.wav \
  -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=<TAIL>[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart -shortest ../<NAME>.mp4
rm -rf frames                # 480 jpgs is ~170 MB and the disk is at 95%
```
`verify_audio.py` reads `bed.wav` from the CWD, so run it from your folder.

## Reviewing your own work — do this, it is not optional
Build a contact sheet and LOOK at it before you call anything done:
```bash
ffmpeg -y -i ../<NAME>.mp4 -vf "select='not(mod(n\,15))',scale=170:-1,tile=8x4:padding=5:color=0x222222" -frames:v 1 sheet.png
```
Read `sheet.png` with the Read tool. Things that must be true on every cell:
- **no near-empty frame.** The commonest defect in this pipeline is a handover where
  the outgoing element has left before the incoming one arrives. Overlap them.
  Measure it, don't eyeball it: `ink = (|luma - median| > 18).mean()`. Under **6%**
  is a hole. `ad-walk` build 1 shipped two at 3% and they were invisible to me on
  the sheet until the number said so.
- frame 0 already carries something — reels autoplay and it is the cover frame.
  ⚠️ A reveal that starts at t=0 means frame 0 is BLANK. Start scene 0 at a
  negative time so t=0 is already part-way in. (`ad-walk` starts it at -0.30.)
  Reel A's cover frame was its darkest frame, luma 40; that is the same bug wearing
  a different hat.
- **nothing important above y=108, below y=1600, right of x=960, or left of x=60.**
  ⚠️ **The RIGHT edge was missing from this file until 2026-08-25 and two shipped
  reels put their biggest element in it.** Instagram's like/comment/share column
  owns the rightmost ~120px — and in an RTL reel that is where every Arabic line
  BEGINS, so it costs more here than in a Latin composition. `reel-c-grid` sets its
  slugs at `right:78px`, i.e. underneath the buttons. Use a right margin of >=140px.
  The old «y=200 / y=1560» pair is fine — it is stricter than the real bands.
- no element clipped by, or colliding with, the device silhouette.
- **nothing sits still — and check it with a number.** Count half-seconds whose
  frame-to-frame delta is under 6. More than ~10 of 31 and the reel is a slideshow.
  A held screenshot with a drifting phone still counts as static: it was 15/31 on
  `ad-walk` build 1, WORSE than the reels it was built to beat. Give every held
  image its own slow move that starts before it arrives and ends after it leaves.

## Non-negotiables
1. **Everything real.** Copy and numbers come from `FACTS.md`. No invented prices,
   no invented claims, no lorem, no English filler in an Arabic frame.
2. **Tokens only.** Colours come from `lolo.css`. Orange is earned: action and
   emotional peaks, ≤10% of visual weight. Shadows are ink-toned, never orange.
3. **Cut to the beat.** Pick a BPM, then make every scene a whole number of beats.
   Animate freehand against `SC_A` and remap with `makeGrid(SC_A, SC_B)`; mirror the
   same map as `g()` in `music.py` so picture-locked accents stay locked.
4. **The device is the shared iPhone 17 Pro Max** in `device.css` / `device.html`.
   Do not draw your own phone and do not change its proportions — only `--dw`, the
   finish class, and its transform.
5. **Nothing sits still.** Every held element needs slow drift, parallax or a grade
   move. Static frames read as a slideshow.
6. Output 1080×1920, 30 fps, h264 + AAC 192k.
7. **Numbers come from `FACTS.md`, and `FACTS.md` gets re-read before every render.**
   Its own header now carries the one-line command. On 2026-08-25 three of its four
   category prices were stale by exactly 5,000 د.ع — the discount round had been
   ended on prod *after* the file was pulled — and all four compositions had the old
   numbers baked in. A reel that quotes a price below what the shop charges is worse
   than an ugly reel.
8. **Sound design comes from `../shared/sfx.py`.** It carries the click-detector
   limits in its header; the one that is not obvious is that a smooth attack is not
   enough, because the detector's second difference scales with f² and HF noise trips
   it on its own. Cap the noise bands, don't soften the envelope.
