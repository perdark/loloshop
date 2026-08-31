#!/usr/bin/env python3
"""
«من التلفون للكتف» — bed + sound design.

100 BPM · beat 0.60s · 25 beats · 15.000s picture, 15.55s audio.
Scene grid 2-3-3-3-3-3-3-5, mirroring index.html.

THE SOUND DESIGN CARRIES THE STRUCTURE OF THE CUT.
The picture alternates: REAL (0) · APP (1) · REAL (2) · APP (3) · REAL (4) ·
APP (5) · REAL (6). The audio alternates with it —

  · REAL beats get CLOTH and room: satin moving, low, no HF sizzle.
  · APP beats get UI: a tap, keys, the small dry world of a phone.

so the ear is told the same thing as the eye, one layer down. That is the whole
premise of this ad — two halves of one object — and it costs nothing to say it
twice in two senses. It also means the last cut, which drops the phone for good,
drops every UI sound with it and leaves only cloth and the bed. Do not "even out"
the sound design across the scenes; the unevenness IS the idea.

⚠️ ~40% of Instagram plays muted. Every cue reinforces; none informs.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from shared.sfx import Mix, note_hz as N

SC_A = [0, 1.26, 3.06, 4.86, 6.66, 8.46, 10.26, 12.42, 15.00]
SC_B = [0, 1.20, 3.00, 4.80, 6.60, 8.40, 10.20, 12.60, 15.00]


def g(a):
    """authored -> shipped; mirror of makeGrid() in index.html"""
    for i in range(len(SC_A) - 1):
        if a <= SC_A[i + 1]:
            span = SC_A[i + 1] - SC_A[i]
            p = 0.0 if span <= 0 else (a - SC_A[i]) / span
            return SC_B[i] + p * (SC_B[i + 1] - SC_B[i])
    return SC_B[-1]


m = Mix(dur=15.55, seed=20260827)

# ---------------------------------------------------------------- the bed
# Warmer and slower-moving than the other two — this one is closer to a film.
m.pad([N('D3'), N('A3'), N('F#4')],  0.00,  3.05, amp=0.16)
m.pad([N('G3'), N('D4'), N('B4')],   3.00,  6.65, amp=0.16)
m.pad([N('B2'), N('F#3'), N('D4')],  6.60, 10.25, amp=0.155)
m.pad([N('A3'), N('E4'), N('C#5')], 10.20, 12.65, amp=0.16)
m.pad([N('D3'), N('A3'), N('F#4')], 12.60, 15.50, amp=0.20, bright=2200)

MOTIF = ['D5', 'A4', 'F#5', 'D5', 'A5', 'F#5', 'D5', 'A5']
for i, sb in enumerate(SC_B[:-1]):
    m.felt(N(MOTIF[i]), sb + 0.02, amp=0.21 + 0.010 * i, dec=2.6,
           pan=-0.24 + 0.07 * i)
# an answering note inside every scene, so nothing holds unaccompanied
for i in range(1, 7):
    mid = SC_B[i] + (SC_B[i + 1] - SC_B[i]) * 0.58
    m.felt(N(MOTIF[i]) * 0.5, mid, amp=0.10, dec=1.9, pan=0.24 - 0.08 * i)

for sb in SC_B[1:-1]:
    m.sub(sb, amp=0.34, dec=0.38)

# ------------------------------------------------------- REAL beats: cloth
# 0 · 2 · 4 · 6 — satin, a body moving, a room. Nothing bright.
m.cloth(0.05, dur=1.15, amp=0.115, pan=-0.10)          # the plinth
m.cloth(g(3.10), dur=1.35, amp=0.105, pan=0.12)        # the embroidery macro
m.cloth(g(6.70), dur=1.40, amp=0.115, pan=-0.12)       # worn, in the shop
m.cloth(g(10.32), dur=1.55, amp=0.105, pan=0.10)       # the workshop
m.cloth(g(12.55), dur=1.90, amp=0.095, pan=-0.06)      # the last sash, under the ask

# -------------------------------------------------------- APP beats: UI
# 1 · 3 · 5 — and nothing after the phone leaves.
m.ui_tap(g(1.34), amp=0.28, pan=0.10)
m.key_run(g(1.62), n_keys=9, span=g(2.86) - g(1.62), amp=0.10, pan=-0.05)
m.ui_tap(g(4.94), amp=0.27, pan=-0.10)                 # 54 models
m.ui_tap(g(8.56), amp=0.25, pan=0.10)                  # cash on delivery

# the three transitions between halves are whooshes, direction alternating so the
# cut reads as turning an object over rather than sliding a deck of cards
for k, (at, dn) in enumerate(((1.26, False), (3.06, True), (4.86, False),
                              (6.66, True), (8.46, False), (10.26, True))):
    m.whoosh(g(at), dur=0.40, amp=0.145, pan=(-0.14 if k % 2 else 0.14), down=dn)

# the ask
m.riser(g(11.78), g(12.42), amp=0.155)
m.sub(SC_B[7], amp=0.48, dec=0.54)
m.confirm(SC_B[7] + 0.14, amp=0.27)
m.felt(N('D5'), SC_B[7] + 0.94, amp=0.24, dec=3.4, pan=-0.18)
m.felt(N('A5'), SC_B[7] + 1.36, amp=0.20, dec=3.6, pan=0.18)
m.bell(N('D6'), SC_B[7] + 1.84, amp=0.13, dec=3.2)

m.master().write('bed.wav')
