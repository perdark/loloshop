#!/usr/bin/env python3
"""
«شنو يصير بالتطبيق» — bed + sound design.

100 BPM · beat 0.60s · 25 beats · 15.000s picture, 15.55s of audio.

TWO THINGS THIS BED DOES THAT THE EARLIER REELS' BEDS DID NOT
-------------------------------------------------------------
1. **It has sound design, not just music.** An app advertisement needs events —
   a chip pressed, a name typed, an answer arriving. Those come from
   `shared/sfx.py`, which was written for this and carries the click-detector
   limits in its own header. The music is deliberately sparse so the UI sounds
   have room; a dense bed would bury exactly the thing the ad is showing.

2. **It has an arc.** The three earlier beds measured LRA 3.3-5.0 LU — flat, no
   lift anywhere, including under their own call to action. This one is quiet
   under the browse beats and opens up at the ask.

⚠️ ~40% of Instagram video is watched on mute. Every one of these cues is
REINFORCEMENT, never information: nothing in this bed carries meaning the picture
does not already carry. If you find yourself timing a sound to explain something,
the picture is wrong, not the bed.

g() is the mirror of makeGrid() in index.html — authored time in, shipped
(on-the-beat) time out. Change one, change both, or the picture and the accents
drift apart.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from shared.sfx import Mix, note_hz

# authored (freehand) and shipped (beat grid) — identical to index.html
SC_A = [0, 1.26, 3.06, 4.74, 7.32, 9.06, 10.74, 12.54, 15.00]
SC_B = [0, 1.20, 3.00, 4.80, 7.20, 9.00, 10.80, 12.60, 15.00]


def g(a):
    """authored seconds -> shipped seconds (the inverse of makeGrid in the page)"""
    for i in range(len(SC_A) - 1):
        if a <= SC_A[i + 1]:
            span = SC_A[i + 1] - SC_A[i]
            p = 0.0 if span <= 0 else (a - SC_A[i]) / span
            return SC_B[i] + p * (SC_B[i + 1] - SC_B[i])
    return SC_B[-1]


BEAT = 0.60
m = Mix(dur=15.55)

N = note_hz

# ---------------------------------------------------------------- the bed
# D · G · Bm · A→D. Warm, open, never sentimental — PRODUCT.md's register is
# "calm and confident, never loud or salesy".
m.pad([N('D3'), N('A3'), N('F#4')],  0.00,  3.10, amp=0.15)
m.pad([N('G3'), N('D4'), N('B4')],   3.00,  7.30, amp=0.15)
m.pad([N('B2'), N('F#3'), N('D4')],  7.20, 10.90, amp=0.15)
m.pad([N('A3'), N('E4'), N('C#5')], 10.80, 12.70, amp=0.16)
m.pad([N('D3'), N('A3'), N('F#4')], 12.60, 15.50, amp=0.19, bright=2100)

# a felted motif on the downbeat of each scene — the spine, not the tune
MOTIF = ['A4', 'B4', 'D5', 'F#5', 'E5', 'D5', 'F#5', 'A5']
for i, sb in enumerate(SC_B[:-1]):
    m.felt(N(MOTIF[i]), sb + 0.02, amp=0.20 + 0.012 * i, dec=2.4,
           pan=-0.24 + 0.06 * i)
# an answering note halfway through the longer scenes, so nothing sits for 2s
for i in (1, 3, 5, 6):
    mid = SC_B[i] + (SC_B[i + 1] - SC_B[i]) * 0.55
    m.felt(N(MOTIF[i]) * 0.5, mid, amp=0.11, dec=1.8, pan=0.26)

# low weight under every scene change
for sb in SC_B[1:-1]:
    m.sub(sb, amp=0.34, dec=0.36)

# ------------------------------------------------------- the sound design
# Every cue below is timed in AUTHORED seconds and mapped through g(), because
# that is the clock the picture's keyframes live on.

# the phone arrives
m.whoosh(0.00, dur=0.62, amp=0.15)
m.cloth(0.10, dur=0.9, amp=0.09)

# scene 1 — a chip is tapped, then the catalogue scrolls
m.ui_tap(g(1.36), amp=0.30, pan=0.10)
m.cloth(g(1.45), dur=1.5, amp=0.075, pan=-0.10)      # the scroll itself, felt not heard

# scene 2 — the product opens, then its options
m.whoosh(g(3.06), dur=0.36, amp=0.16, pan=-0.12)
m.ui_tap(g(3.98), amp=0.27, pan=0.14)

# scene 3 — THE NAME IS TYPED. 13 keys across the flipbook window (4.94 -> 7.22
# authored). Uneven on purpose: evenly spaced ticks read as a machine.
m.ui_tap(g(4.92), amp=0.26, pan=0.06)
m.key_run(g(5.10), n_keys=13, span=g(7.20) - g(5.10), amp=0.105, pan=-0.06)

# scene 4 — لولو is asked, and answers
m.ui_tap(g(7.66), amp=0.28, pan=-0.10)
m.msg_in(g(8.19), amp=0.24, pan=0.08)                # the answer lands

# scene 5/6 — the promise, then the cohort
m.whoosh(g(9.06), dur=0.40, amp=0.15, pan=0.12)
m.whoosh(g(10.74), dur=0.44, amp=0.15, pan=-0.12, down=True)

# the ask
m.riser(g(11.90), g(12.54), amp=0.15)
m.sub(SC_B[7], amp=0.46, dec=0.52)
m.confirm(SC_B[7] + 0.14, amp=0.26)
m.felt(N('D5'), SC_B[7] + 0.90, amp=0.24, dec=3.2, pan=-0.18)
m.felt(N('A5'), SC_B[7] + 1.32, amp=0.20, dec=3.4, pan=0.18)
m.bell(N('D6'), SC_B[7] + 1.80, amp=0.13, dec=3.0)

m.master().write('bed.wav')
