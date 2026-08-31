#!/usr/bin/env python3
"""
«اسأل لولو» — bed + sound design.

100 BPM · beat 0.60s · 25 beats · 15.000s picture, 15.55s audio.
Scene grid 2-3-3-3-3-3-3-5, mirroring index.html.

THE MIX IS BUILT AROUND TWO MOMENTS: the two answers landing. Everything else
gets out of their way — the pad thins, the motif rests, and `msg_in` arrives in
near-silence. An assistant ad has exactly one thing to sell, which is that she
answers; if the bed is busy at 3.00s and 6.60s the ad has no punchline.

The typing is deliberately SHORT here (6 and 7 keys) — a question is typed
faster than a name is, and the picture only holds the ask for ~1.4s.

⚠️ ~40% of Instagram plays muted. Every cue is reinforcement of something the
picture already says. Nothing here carries information on its own.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from shared.sfx import Mix, note_hz as N

SC_A = [0, 1.26, 3.06, 4.86, 6.66, 8.46, 10.26, 12.42, 15.00]
SC_B = [0, 1.20, 3.00, 4.80, 6.60, 8.40, 10.20, 12.60, 15.00]


def g(a):
    """authored -> shipped; the mirror of makeGrid() in index.html"""
    for i in range(len(SC_A) - 1):
        if a <= SC_A[i + 1]:
            span = SC_A[i + 1] - SC_A[i]
            p = 0.0 if span <= 0 else (a - SC_A[i]) / span
            return SC_B[i] + p * (SC_B[i + 1] - SC_B[i])
    return SC_B[-1]


m = Mix(dur=15.55, seed=20260826)

# ---------------------------------------------------------------- the bed
# Thinner than the walkthrough's on purpose — see the header. The two answer
# beats (3.00 and 6.60) get the QUIETEST pad in the reel.
m.pad([N('D3'), N('A3'), N('F#4')],  0.00,  3.05, amp=0.15)
m.pad([N('B2'), N('F#3'), N('D4')],  3.00,  4.85, amp=0.105)   # answer 1 — thin
m.pad([N('G3'), N('D4'), N('B4')],   4.80,  6.65, amp=0.15)
m.pad([N('B2'), N('F#3'), N('D4')],  6.60,  8.45, amp=0.105)   # answer 2 — thin
m.pad([N('G3'), N('D4'), N('B4')],   8.40, 10.25, amp=0.155)
m.pad([N('A3'), N('E4'), N('C#5')], 10.20, 12.65, amp=0.16)
m.pad([N('D3'), N('A3'), N('F#4')], 12.60, 15.50, amp=0.19, bright=2100)

MOTIF = ['A4', 'D5', 'F#5', 'E5', 'A5', 'F#5', 'D5', 'A5']
for i, sb in enumerate(SC_B[:-1]):
    # the two answer scenes get NO downbeat note — the answer is the event
    if i in (2, 4):
        continue
    m.felt(N(MOTIF[i]), sb + 0.02, amp=0.20 + 0.010 * i, dec=2.4, pan=-0.22 + 0.06 * i)

for sb in (SC_B[1], SC_B[3], SC_B[5], SC_B[6]):
    m.sub(sb, amp=0.32, dec=0.34)

# ------------------------------------------------------- the sound design
m.whoosh(0.00, dur=0.60, amp=0.14)

# question 1 typed and sent
m.ui_tap(g(1.32), amp=0.28, pan=0.10)
m.key_run(g(1.52), n_keys=6, span=g(2.55) - g(1.52), amp=0.095, pan=-0.05)
m.ui_tap(g(2.70), amp=0.24, pan=0.12)          # send

# ANSWER 1 — lands in the thinnest part of the bed
m.msg_in(g(3.12), amp=0.30, pan=0.04)
m.felt(N('D5'), g(3.34), amp=0.14, dec=2.0, pan=0.20)

# question 2
m.ui_tap(g(4.92), amp=0.28, pan=-0.10)
m.key_run(g(5.10), n_keys=7, span=g(6.20) - g(5.10), amp=0.095, pan=0.05)
m.ui_tap(g(6.32), amp=0.24, pan=-0.12)

# ANSWER 2
m.msg_in(g(6.72), amp=0.30, pan=-0.04)
m.felt(N('F#5'), g(6.94), amp=0.14, dec=2.0, pan=-0.20)

# the chips — three light taps, she answers more than prices
for k, dt in enumerate((8.62, 8.88, 9.14)):
    m.ui_tap(g(dt), amp=0.17 - 0.02 * k, pan=-0.22 + 0.22 * k, bright=1.06 + 0.05 * k)

m.whoosh(g(10.26), dur=0.44, amp=0.15, pan=0.10, down=True)
m.cloth(g(10.60), dur=1.0, amp=0.08)

# the ask
m.riser(g(11.80), g(12.42), amp=0.15)
m.sub(SC_B[7], amp=0.46, dec=0.52)
m.confirm(SC_B[7] + 0.14, amp=0.26)
m.felt(N('D5'), SC_B[7] + 0.92, amp=0.23, dec=3.2, pan=-0.18)
m.felt(N('A5'), SC_B[7] + 1.34, amp=0.19, dec=3.4, pan=0.18)
m.bell(N('D6'), SC_B[7] + 1.82, amp=0.12, dec=3.0)

m.master().write('bed.wav')
