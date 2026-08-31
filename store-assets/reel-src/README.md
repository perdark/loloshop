# LoloShop app-download reel — source

`../loloshop-reel-1080x1920.mp4` · 1080×1920 · 30 fps · 16.55 s · h264 + AAC 192k
Cover frame: `../loloshop-reel-cover.jpg`

Deterministic HTML→video. **No API, no credits, no npm install.** Every frame is a
function of `t`, so renders are reproducible. Same pipeline as
`khatuna-build/store-assets/teaser-src`, with two things that one did not have:
the app footage is **captured off the live app**, and the picture is **cut to the beat**.

---

## Rebuild

```bash
cd reel-src
python3 -m http.server 8899 --bind 127.0.0.1 &
google-chrome --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9334 --user-data-dir=/tmp/chr-lolo about:blank &

node render.mjs --out frames --fmt jpeg --q 96 --fps 30 --dur 16 --port 9334
python3 music.py && python3 verify_audio.py          # must print ALL PASS

ffmpeg -y -framerate 30 -i frames/%05d.jpg -c:v libx264 -preset slow -crf 18 \
  -pix_fmt yuv420p -movflags +faststart ../loloshop-reel-1080x1920-silent.mp4
ffmpeg -y -i ../loloshop-reel-1080x1920-silent.mp4 -i bed.wav \
  -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=0.55[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart -shortest ../loloshop-reel-1080x1920.mp4
```

Probe a few frames instead of all 480:
`node render.mjs --out probe --fmt jpeg --only 1.4,6.2,9.1,13.4 --port 9334`
Render cost on this laptop: ~8 fps capture, so ~60 s for the full 480 frames.
**Kill Chrome and the server when you are done** — hardware rules.

## The footage is the real app, not a mockup

`assets/app/*.jpg` are screenshots of **lolo-shop96.com in production**, captured by
`shots.mjs` over CDP at 390×844 @ DPR 3.

The catch: `frontend/lib/app-gate.ts` bounces any mobile *browser* to the store
listing, and the storefront only renders its native chrome (tab bar, safe areas)
when it sees a native signal. `shots.mjs` therefore sets `window.androidBridge` at
document start — the same signal `Bridge.java` injects — so what is captured is the
in-app UI, not the web fallback. It also stubs `loloshop_profile` and the
`loloshop_discount_popup_seen` session key so onboarding and the countdown popup
stay out of frame, and freezes all CSS animation so no frame lands mid-transition.

```bash
node shots.mjs --port 9334 --out assets/shots --dpr 3 --pages shots.json
```

`strip-shop.jpg` is the one that matters: `/shop` captured with `header, nav` hidden
and `captureBeyondViewport` on, so it is a **2160 CSS px tall strip of real catalogue**
that scrolls inside the phone under `chrome-header.jpg` / `chrome-tabbar.jpg`
(cropped from the plain viewport shot). That is why the scroll beat looks like the
app and not like a slideshow. Header is 65 CSS px, tab bar 70 — measured, not guessed.

⚠️ `assets/shots/` (the raw PNGs) is deleted after each capture; the pipeline reads
only the derived `assets/app/*.jpg`, so the render stays reproducible even after the
live site changes.

## Cut plan — 120 BPM, every scene a whole number of beats

| t | beats | beat |
|---|---|---|
| 0.0–1.5 | 3 | logo splash · أوشحة وروبات وقبعات التخرّج |
| 1.5–3.5 | 4 | hook · تخرّجك مرة وحدة بالعمر / خلّي اسمك **مطرّز** عليه |
| 3.5–6.0 | 5 | the device lands · ٢٬٠١٧ طالب وطالبة سجّلوا معنا (counts up) |
| 6.0–9.0 | 6 | the catalogue scrolls · ٥٤ موديل · price chips |
| 9.0–11.0 | 4 | design it · the sash page + two product tiles |
| 11.0–13.0 | 4 | ليش لولو شوب؟ · the four real trust rows |
| 13.0–16.0 | 6 | **حمّل تطبيق لولو شوب** · App Store + Google Play · @lolo_shop96 |

`index.html` was animated freehand against `SC_A`; `grid()` remaps the whole film
onto `SC_B` (the beat grid) at render time, so **no keyframe below the remap knows
about the grid**. `music.py` carries the mirror-image map in `g()`, which is how a
picture-locked accent stays locked after the snap. Change one, change both.

Cuts are deliberately not all the same: bloom on the two brand cuts, a push on the
device entrance, a vertical whip on the headline swaps, and two **in-screen
navigations fired by a visible tap** (the ripple lands one beat before the screen
changes — that ordering is what sells it).

## Where things live in `index.html`
- Palette + type tokens: `:root` — lifted verbatim from `frontend/app/globals.css`
  `@theme`, including the DESIGN.md "Ink-Not-Orange Shadow Rule"
- Fonts: self-hosted Amiri + Cairo + Playfair, extracted from `frontend/.next/static/media`
- Copy: the `<section id="s1..s7">` blocks
- Device geometry: `#phoneWrap` (perspective) → `#tilt` (the 3D move) → `#phone`
- Timing: `SC` / `CUTS` / `SC_A` / `SC_B` and `seek(t)` at the bottom

## Every number in it is real

Pulled from production on 2026-08-22, not invented:

| claim | source |
|---|---|
| ٢٬٠١٧ طالب وطالبة سجّلوا معنا | the live home hero |
| ٥٤ موديل | `/shop` header (11 وشاح + 21 روب + 5 قبعة + 17 شال) |
| الوشاح من ١٥٬٠٠٠ · الروب من ٢٠٬٠٠٠ · القبعة من ١٠٬٠٠٠ د.ع | min `basePrice` per type in the live catalogue |
| the four «ليش لولو شوب؟» rows | copied word for word off the live home page |
| وشاح مثلث ملكي ٢٥٬٠٠٠ · قبعة ملكة ١٥٬٠٠٠ | the products' own records + their own photos |

If prices or the signup count move, re-check them before re-posting the reel.

## Music bed — `music.py`

Synthesised from scratch with numpy (no samples, no library, no API): felt piano,
glass bells, plucked harp, soft sub kick, brushed offbeats, reverb built from sparse
feedback combs.

`D(add9) → Bm7 → Gmaj9 → Em7 → Asus4 → D` — a ii–V–I that **resolves exactly on the
CTA cut at 13.0 s**, because the ask is the point of the film and the harmony should
stop leaning forward at the same instant the picture does. 120 BPM, 8 bars.

Every accent is scored to a real event: the six cuts, the mark settling, each hook
word, the brush stroke under «مطرّز», the device landing, the signup count ticking up
and settling, both taps, the three price chips, the two product tiles, the four trust
rows, and the badges.

### Verify after editing — measure, do not listen
`python3 verify_audio.py` must print **ALL PASS**. Current bed:

```
peak 0.775 · impulse clicks 0 · truncated tails 0 · 2-8 kHz 1.28% · -13.7 LUFS · -2.2 dBTP
```

Two notes on that script, both learned the hard way:
- a click is **not** "a big sample-to-sample step" — at 44.1 kHz a clean 8 kHz tone at
  0.7 already steps by ~0.74 per sample. It is an **impulse**: one sample that departs
  from the linear interpolation of its neighbours by ≫ the local signal statistics.
- envelope frames must be **10 ms, not 1 ms**. At 1 ms a 100 Hz pad is a fraction of a
  cycle and the frame RMS is pure phase noise, which reports ~50 phantom failures.

## Deriving `assets/app/*.jpg` from a fresh capture

`shots.mjs` writes 1170-wide PNGs (the strips come out 3510-wide — `clip.scale`
multiplies the device pixel ratio again, which is harmless, just oversampled).
Everything the render reads is derived from them at 620 px wide:

```bash
for n in home2 shop product product-opts why lolo vip package; do
  ffmpeg -y -i assets/shots/$n.png -vf "scale=620:-1:flags=lanczos" -q:v 3 assets/app/$n.jpg
done
ffmpeg -y -i assets/shots/strip-shop.png -vf "scale=620:-1:flags=lanczos" -q:v 4 assets/app/strip-shop.jpg
ffmpeg -y -i assets/app/shop.jpg -vf "crop=620:103:0:0"    -q:v 2 assets/app/chrome-header.jpg
ffmpeg -y -i assets/app/shop.jpg -vf "crop=620:111:0:1231" -q:v 2 assets/app/chrome-tabbar.jpg
rm -rf assets/shots
```

103 px and 111 px are the 65/70 CSS px chrome heights at this scale — if the app's
header or tab bar ever changes height, re-measure with the `measure` field in
`shots.json` rather than eyeballing the crop.
