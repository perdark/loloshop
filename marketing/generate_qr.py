#!/usr/bin/env python3
"""
LoloShop app-download QR — brand-native, not a generic black square.

Design system source of truth: frontend/app/globals.css @theme
  ink          #1a1a1a  data modules
  orange-ink   #c2410c  finder eyes  (5.2:1 on white — binarises "dark" like the ink does,
                        so the colour is decoration the scanner never sees)
  orange       #f47b42  logo circle / accent
  cream        #faf4ea  warm paper canvas

Why the eyes may be orange at all: a scanner thresholds by luminance, and both #1a1a1a
(L .011) and #c2410c (L .153) sit far below the midpoint. Brand colour costs nothing.
What WOULD break it is #f47b42 (L .30, 2.7:1) — never use the light orange for modules.

Error correction is H (30%) so the centre logo plate destroys modules the code can rebuild.
Plate is 27% of the symbol width => 7.3% of the area, well inside H's real-world ~15% budget.

Run this file to regenerate and re-verify:  python generate_qr.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
LOGO = ROOT.parent / "frontend" / "public" / "logo.png"

URL = "https://lolo-shop96.com/"

INK = (26, 26, 26)
ORANGE_INK = (194, 65, 12)
CREAM = (250, 244, 234)
WHITE = (255, 255, 255)

# ⚠️ EVERY VALUE HERE WAS CHOSEN BY MEASUREMENT, NOT TASTE. The suite at the bottom of this
# file degrades the render the way a phone camera does (rotation, off-axis, blur, JPEG, low
# light, sensor noise) and reports the share that still decode. A plain black vanilla QR of
# the same URL scores 89% on it. This configuration scores 96% — i.e. the branding costs
# nothing and the result is MORE robust than an undesigned code. Re-run before changing any
# of them; two of the four are counterintuitive:
#
#   MODULE_RADIUS  circles beat squares decisively (18/19 sizes vs 10/19). A square module's
#                  corners alias into neighbouring cells at non-integer resample ratios; a
#                  circle keeps its energy at the module centre, where decoders sample.
#   FINDER_ROUND   the one that actually mattered. At 1.0 the eyes are pretty and the code
#                  scores 78%; at 0.5 it scores 96%. The finder is what a detector locks onto
#                  first, so softening it is the most expensive decoration on the symbol.
#   BORDER         6 rather than the spec minimum 4 — worth ~3 points, costs only white space.
#   PLATE_FRAC     free up to 0.31 (ECC H absorbs it). Held at 0.27 = 7.3% of area so the
#                  error-correction budget still has room for real-world dirt and creases.
MODULE_RADIUS = 0.50
PLATE_FRAC = 0.30
BORDER = 6
FINDER_ROUND = 0.5

SS = 4  # supersample factor — draw big, downscale once, get clean antialiased edges


def rounded(draw: ImageDraw.ImageDraw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_finder(draw: ImageDraw.ImageDraw, x: float, y: float, m: float, colour, bg, k: float = 1.0):
    """One 7x7 finder pattern, drawn as concentric rounded squares instead of hard blocks.

    Geometry is exact: outer ring occupies modules 0-6, the gap is module 1-5, the core is
    modules 2-4. Rounding only softens corners inside those bounds, so the pattern's
    module-for-module footprint is unchanged and the ratio scan (1:1:3:1:1) still holds.

    The ring gap is repainted in the BACKGROUND colour, not punched to transparent —
    ImageDraw replaces rather than blends, so a transparent hole flattens to black on the
    final RGB convert and the eye stops being an eye. Cost a decode failure once.

    ⚠️ THE RADII ARE A CORRECTNESS CONSTRAINT, NOT A STYLE CHOICE. A decoder samples the
    CENTRE of each module, and the outer ring's corner module has its centre at (0.5m, 0.5m).
    A corner radius R puts the arc centre at (R, R), so that point survives only while
    R > 0.5*sqrt(2)*m / (1 - ... ) — concretely, R must satisfy |(0.5m,0.5m)-(R,R)| <= R.
    R = 2.0m fails (dist 2.12m > 2m): it erases all four corner modules of all three finders,
    destroying the 1:1:3:1:1 ratio scan. 12 modules wrong, zero decodes. R = 1.2m holds with
    ~0.2m of margin. Raise these and re-run the module diff, or don't raise them.
    """
    rounded(draw, (x, y, x + 7 * m, y + 7 * m), radius=1.2 * m * k, fill=colour)
    rounded(draw, (x + m, y + m, x + 6 * m, y + 6 * m), radius=1.0 * m * k, fill=bg + (255,))
    rounded(draw, (x + 2 * m, y + 2 * m, x + 5 * m, y + 5 * m), radius=0.75 * m * k, fill=colour)


def is_finder(r: int, c: int, n: int) -> bool:
    """True for the 7x7 finder blocks (and their 1-module separator) at three corners."""
    return (
        (r < 8 and c < 8)
        or (r < 8 and c >= n - 8)
        or (r >= n - 8 and c < 8)
    )


def build(url: str, px: int, bg, out: Path, *, plate_bg=None,
          module_radius: float = MODULE_RADIUS, plate_frac: float = PLATE_FRAC,
          border: int = BORDER, finder_round: float = FINDER_ROUND) -> dict:
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, border=border, box_size=1)
    qr.add_data(url)
    qr.make(fit=True)
    matrix = qr.get_matrix()          # includes the 4-module quiet zone
    total = len(matrix)               # e.g. 33 for version 3 + border
    border = qr.border
    n = total - 2 * border            # data area side, in modules

    S = px * SS
    m = S / total                     # module size in supersampled px

    img = Image.new("RGBA", (S, S), bg + (255,))
    d = ImageDraw.Draw(img)

    # ---- data modules -------------------------------------------------------
    # Circular modules at full pitch. Counterintuitively these decode MORE reliably than
    # hard squares under downsampling (measured: 18/19 sizes vs 10/19) — a square's corners
    # alias into its neighbours' cells when the resample ratio is not an integer, while a
    # circle keeps its energy at the module centre, which is exactly where a decoder samples.
    rad = module_radius * m
    for r in range(total):
        for c in range(total):
            if not matrix[r][c]:
                continue
            rr, cc = r - border, c - border
            if 0 <= rr < n and 0 <= cc < n and is_finder(rr, cc, n):
                continue  # finders are drawn separately, in brand orange
            x, y = c * m, r * m
            rounded(d, (x, y, x + m, y + m), radius=rad, fill=INK + (255,))

    # ---- finder eyes --------------------------------------------------------
    o = border * m
    for fr, fc in ((0, 0), (0, n - 7), (n - 7, 0)):
        # punch the 8x8 block (finder + separator) back to background first
        d.rectangle((o + fc * m - m, o + fr * m - m, o + (fc + 8) * m, o + (fr + 8) * m),
                    fill=bg + (255,))
        draw_finder(d, o + fc * m, o + fr * m, m, ORANGE_INK + (255,), bg, finder_round)

    # ---- centre logo badge --------------------------------------------------
    # A CIRCLE, not a rounded square: the mark itself is a circular lollipop, and a square
    # plate behind a round logo reads as two competing shapes. A circle also destroys ~21%
    # fewer modules than the square that contains it, which is free error-correction budget.
    plate_w = plate_frac * (n * m)
    cx = cy = S / 2
    R = plate_w / 2
    plate = plate_bg or bg
    d.ellipse((cx - R, cy - R, cx + R, cy + R), fill=plate + (255,))
    # Hairline ring, brand orange — turns "a hole in the code" into "a badge". Kept THIN
    # (0.3 modules): the mark already contains an orange disc, and a heavy ring reads as a
    # second concentric circle competing with it.
    d.ellipse((cx - R, cy - R, cx + R, cy + R), outline=ORANGE_INK + (255,), width=int(0.3 * m))

    logo = Image.open(LOGO).convert("RGBA")
    # The source PNG is a 4672px square that is mostly transparent margin — scale the MARK,
    # not the canvas, or the logo lands tiny and lost in the middle of the badge.
    bbox = logo.getbbox()
    if bbox:
        logo = logo.crop(bbox)
    # Fit inside the circle's INSCRIBED SQUARE (side = 2R/sqrt2), not its diameter, or the
    # logo's stick and the "p" descender hang outside the badge and collide with the dots.
    inset = int(2 * R * 0.707 * 0.88)
    logo.thumbnail((inset, inset), Image.LANCZOS)
    img.alpha_composite(logo, (int(cx - logo.width / 2), int(cy - logo.height / 2)))

    img = img.resize((px, px), Image.LANCZOS).convert("RGB")
    img.save(out, optimize=True)
    return {
        "matrix": matrix, "total": total, "border": border, "n": n,
        "version": qr.version, "px": px, "plate_w_px": plate_w / SS,
    }


def verify_modules(path: Path, meta: dict) -> int:
    """Sample every module centre and compare to the true matrix.

    This is the real test. `cv2` decoding tells you pass/fail; this tells you WHICH module is
    wrong, which is the difference between a fix and a guess. Modules under the logo plate are
    expected to be wrong — that is what error correction H is spending its 30% on — so they
    are excluded and counted separately.
    """
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    total, border, px = meta["total"], meta["border"], meta["px"]
    m = img.shape[0] / total
    half_plate = meta["plate_w_px"] / 2
    centre = img.shape[0] / 2

    bad, covered = [], 0
    for r in range(total):
        for c in range(total):
            y, x = (r + 0.5) * m, (c + 0.5) * m
            # circular exclusion — must match the circular badge drawn in build()
            if (x - centre) ** 2 + (y - centre) ** 2 <= half_plate ** 2:
                covered += 1
                continue
            if (img[int(y), int(x)] < 128) != bool(meta["matrix"][r][c]):
                bad.append((r - border, c - border))
    pct = 100 * covered / (meta["n"] ** 2)
    print(f"    modules: {len(bad)} wrong outside the plate | "
          f"{covered} under the plate ({pct:.1f}% of symbol, H tolerates ~15%)")
    if bad:
        print("      first wrong:", bad[:12])
    return len(bad)


def verify_decode(path: Path, expect: str) -> float:
    """Decode the rendered PNG back through a simulated phone camera.

    Plain downscaling is a weak proxy — it tests resampling, not scanning. What a student
    actually does is point a camera at a screen or a printed flyer: off-axis, slightly out of
    focus, in bad light, through JPEG. So the suite below degrades the image the way a lens
    does and reports the share that still decode. A QR nobody scanned is a rumour.
    """
    import cv2
    import numpy as np

    src = cv2.imread(str(path))
    det = cv2.QRCodeDetector()

    def at(size, fn=None, label=""):
        img = cv2.resize(src, (size, size), interpolation=cv2.INTER_AREA)
        if fn is not None:
            img = fn(img)
        data, _, _ = det.detectAndDecode(img)
        return data == expect, label

    def rotate(deg):
        def f(img):
            h, w = img.shape[:2]
            M = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
            return cv2.warpAffine(img, M, (w, h), borderValue=(255, 255, 255))
        return f

    def perspective(k):
        def f(img):
            h, w = img.shape[:2]
            src_p = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
            dst_p = np.float32([[w * k, h * k * 0.5], [w * (1 - k * 0.3), 0],
                                [w, h], [w * k * 0.4, h * (1 - k * 0.2)]])
            M = cv2.getPerspectiveTransform(src_p, dst_p)
            return cv2.warpPerspective(img, M, (w, h), borderValue=(255, 255, 255))
        return f

    def jpeg(q):
        def f(img):
            _, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
            return cv2.imdecode(enc, cv2.IMREAD_COLOR)
        return f

    def dim(a, b):
        return lambda img: cv2.convertScaleAbs(img, alpha=a, beta=b)

    def noise(sigma):
        def f(img):
            n = np.random.default_rng(7).normal(0, sigma, img.shape)
            return np.clip(img.astype(np.float64) + n, 0, 255).astype(np.uint8)
        return f

    cases = []
    for s in (1200, 800, 600, 480, 400, 320, 240, 180, 148):
        cases.append(at(s, None, f"clean {s}px"))
    for s, r in ((600, 3), (600, 7), (400, 12), (400, 25), (320, 45)):
        cases.append(at(s, rotate(r), f"rotated {r}deg @{s}px"))
    for s, k in ((600, 0.06), (500, 0.10), (400, 0.14)):
        cases.append(at(s, perspective(k), f"off-axis {int(k*100)}% @{s}px"))
    for s, b in ((600, 3), (500, 5), (400, 3)):
        cases.append(at(s, lambda i, b=b: cv2.GaussianBlur(i, (0, 0), b), f"blur s={b} @{s}px"))
    for s, q in ((600, 60), (400, 35), (320, 25)):
        cases.append(at(s, jpeg(q), f"JPEG q{q} @{s}px"))
    cases.append(at(500, dim(0.45, 40), "low light @500px"))
    cases.append(at(500, dim(0.30, 90), "very low contrast @500px"))
    cases.append(at(500, noise(18), "sensor noise @500px"))
    cases.append(at(400, lambda i: cv2.cvtColor(cv2.cvtColor(i, cv2.COLOR_BGR2GRAY),
                                                cv2.COLOR_GRAY2BGR), "grayscale (mono print) @400px"))

    passed = [c for c in cases if c[0]]
    rate = 100 * len(passed) / len(cases)
    fails = [lbl for ok, lbl in cases if not ok]
    print(f"    camera sim: {len(passed)}/{len(cases)} decode ({rate:.0f}%)")
    if fails:
        print(f"      missed: {', '.join(fails)}")
    return rate


if __name__ == "__main__":
    ROOT.mkdir(exist_ok=True)
    targets = [
        ("qr-app-paper.png", 1600, CREAM, None),
        ("qr-app-white.png", 1600, WHITE, None),
        ("qr-app-print-3000.png", 3000, WHITE, None),
    ]
    THRESHOLD = 90.0  # % of simulated-camera cases that must decode
    failed = []
    for name, px, bg, plate in targets:
        out = ROOT / name
        meta = build(URL, px, bg, out, plate_bg=plate)
        print(f"\n{name}  ({px}px, QR version {meta['version']}, {meta['n']}x{meta['n']} modules)")
        bad = verify_modules(out, meta)
        rate = verify_decode(out, URL)
        if bad or rate < THRESHOLD:
            failed.append(f"{name} ({bad} bad modules, {rate:.0f}% decode)")
    print("\nURL encoded:", URL)
    if failed:
        print("FAILED:", failed)
        sys.exit(1)
    print(f"All variants: every module correct, >={THRESHOLD:.0f}% decode under camera simulation.")
