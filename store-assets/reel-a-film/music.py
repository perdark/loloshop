#!/usr/bin/env python3
"""
LoloShop reel A — «الوعد» · music bed, synthesised from scratch (numpy only).

  Dm7 -> Bbmaj7 -> F(add9) -> C -> Dm7 -> D MAJOR    |  80 BPM, beat 0.75s, 20 beats

The whole score exists to deliver one event: the picardy third. Five plates lean on
D minor; at 12.00 — the exact frame the film stops being a fashion film and becomes
an ask — the F natural rises to F#, and the same chord that has been aching for
twelve seconds resolves into D major. That is also the only place a drum is allowed.

Voices: solo felt piano, a bowed low pad, a glass bell for the dissolves, a harp for
sparkle, a sub kick and one swell for the last plate, and a band-limited room tone so
the bed still reads on a phone speaker at 2-8 kHz.

index.html is animated freehand against SC_A and remapped onto SC_B, the beat grid.
g() below is the mirror of that map: it carries a picture-locked accent from authored
time onto the grid, so "the bell on the dissolve" stays on the dissolve.

Verify by measuring, never by ear on a laptop speaker:  python3 ../shared/verify_audio.py
"""
import numpy as np, wave

SR   = 44100
DUR  = 15.55                      # 15.0s picture + 0.55s tail
N    = int(SR * DUR)
T    = np.arange(N) / SR
BEAT = 0.75                       # 80 BPM

L = np.zeros(N); R = np.zeros(N)

# ---------------------------------------------------------------- the grid
# 4-3-3-3-3-4 beats = 20 beats = 15.000s exactly.
SC_A = [0, 2.85, 5.10, 7.45,  9.90, 12.20, 15.00]     # authored, freehand
SC_B = [0, 3.00, 5.25, 7.50,  9.75, 12.00, 15.00]     # shipped, on the beat
def g(t):
    for i in range(len(SC_A) - 1):
        if t <= SC_A[i+1]:
            return SC_B[i] + (t - SC_A[i]) * (SC_B[i+1] - SC_B[i]) / (SC_A[i+1] - SC_A[i])
    return SC_B[-1] + (t - SC_A[-1])

CUTS = SC_B[1:6]                  # 3.00 5.25 7.50 9.75 12.00 — the five dissolves

# ---------------------------------------------------------------- helpers
def idx(t): return int(t * SR)

def add(buf, sig, t0):
    i = idx(t0)
    if i >= N or i < 0: return
    n = min(len(sig), N - i)
    if n > 0: buf[i:i+n] += sig[:n]

def env_ad(n, atk, dec, curve=3.0):
    e = np.ones(n)
    a = max(1, int(atk * SR))
    e[:a] = np.linspace(0, 1, a) ** 0.6
    d = np.arange(n - a) / SR
    e[a:] = np.exp(-d * curve)
    return e

def lp(x, cut):
    """one-pole lowpass as an exponential FIR (vectorised, click-free)"""
    tau = 1.0 / (2 * np.pi * cut)
    k = max(2, int(tau * SR * 6))
    h = np.exp(-np.arange(k) / (tau * SR)); h /= h.sum()
    return np.convolve(x, h)[:len(x)]

def hp(x, cut):  return x - lp(x, cut)
def lp2(x, cut): return lp(lp(x, cut), cut)
def bp(x, lo, hi): return lp2(hp(x, lo), hi)
def shelf_hi(x, cut, gain): return x + gain * hp(x, cut)

def comb(x, delay_s, gg, taps=24):
    d = int(delay_s * SR); out = np.zeros_like(x); gk = 1.0
    for k in range(taps):
        s = k * d
        if s >= len(x) or gk < 1e-4: break
        out[s:] += gk * x[:len(x)-s]
        gk *= gg
    return out

# ---------------------------------------------------------------- voices
def pad(freqs, t0, t1, amp, bright=1500.0):
    """warm stacked-sine pad, detuned three ways and stereo-spread"""
    n = idx(t1 - t0) + idx(1.6)
    if n <= 0: return
    t = np.arange(n) / SR
    a, r = idx(0.85), idx(1.45)
    e = np.ones(n)
    e[:a]  = np.sin(np.linspace(0, np.pi/2, a)) ** 2
    e[-r:] *= np.cos(np.linspace(0, np.pi/2, r)) ** 2
    for j, f in enumerate(freqs):
        vib = 1 + 0.0015 * np.sin(2*np.pi*(0.14 + 0.05*j)*t + j)
        for det, pan in ((-0.11, -1), (0.0, 0), (0.11, 1)):
            w  = np.sin(2*np.pi*(f + det) * t * vib + j*1.7 + det*9)
            w += 0.24 * np.sin(2*np.pi*(f+det)*2*t*vib)
            w += 0.11 * np.sin(2*np.pi*(f+det)*3*t*vib)
            w += 0.04 * np.sin(2*np.pi*(f+det)*5*t*vib)
            v  = w * e * amp / (len(freqs) * 2.4)
            add(L, lp(v, bright) * (0.5 - 0.32*pan) * 2, t0)
            add(R, lp(v, bright) * (0.5 + 0.32*pan) * 2, t0)

def strings(freqs, t0, t1, amp, bright=2100.0):
    """the low bowed layer: a sawtooth-ish spectrum with a slow bow attack.
       It is what makes the harmony feel HELD rather than struck."""
    n = idx(t1 - t0) + idx(1.5)
    if n <= 0: return
    t = np.arange(n) / SR
    a, r = idx(1.05), idx(1.35)
    e = np.ones(n)
    e[:a]  = np.sin(np.linspace(0, np.pi/2, a)) ** 2
    e[-r:] *= np.cos(np.linspace(0, np.pi/2, r)) ** 2
    for j, f in enumerate(freqs):
        bow = 1 + 0.0022 * np.sin(2*np.pi*(4.7 + 0.6*j)*t + j*2.1)   # slow bow vibrato
        w = np.zeros(n)
        for h in range(1, 9):                                        # 1/n saw partials
            w += np.sin(2*np.pi*f*h*t*bow + j*0.9 + h*0.4) / h
        v = w * e * amp / (len(freqs) * 3.4)
        pan = -0.5 + j / max(1, len(freqs) - 1)
        add(L, lp(v, bright) * (0.5 - 0.30*pan) * 2, t0)
        add(R, lp(v, bright) * (0.5 + 0.30*pan) * 2, t0)

def felt(f, t0, amp=1.0, dec=2.6, pan=0.0):
    """felt piano: fundamental + a little hammer, the top rolled off"""
    n = idx(3.2); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t)
    w += 0.32 * np.sin(2*np.pi*f*2.001*t) * np.exp(-t*dec*1.9)
    w += 0.13 * np.sin(2*np.pi*f*3.003*t) * np.exp(-t*dec*3.1)
    w += 0.055* np.sin(2*np.pi*f*4.01*t)  * np.exp(-t*dec*4.6)
    v  = w * env_ad(n, 0.007, dec) * amp * 0.26
    v  = lp(v, 6400)                      # felt = dark; this is the "composed" register
    add(L, v * (0.5 - 0.28*pan) * 2, t0)
    add(R, v * (0.5 + 0.28*pan) * 2, t0)

def bell(f, t0, amp=1.0, dec=4.4, pan=0.0):
    """glass bell — inharmonic, one per dissolve and nowhere else"""
    n = idx(2.6); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t)
    w += 0.42 * np.sin(2*np.pi*f*2.76*t) * np.exp(-t*dec*2.2)
    w += 0.19 * np.sin(2*np.pi*f*5.40*t) * np.exp(-t*dec*3.6)
    w += 0.08 * np.sin(2*np.pi*f*8.93*t) * np.exp(-t*dec*6.5)
    v  = w * env_ad(n, 0.003, dec) * amp * 0.20
    v  = lp(v, 11000)
    add(L, v * (0.5 - 0.32*pan) * 2, t0)
    add(R, v * (0.5 + 0.32*pan) * 2, t0)

def harp(f, t0, amp=1.0, pan=0.0):
    """short plucked string — the hairline drawing, the badges landing"""
    n = idx(1.6); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t) + 0.28*np.sin(2*np.pi*f*2*t)*np.exp(-t*9) \
       + 0.12*np.sin(2*np.pi*f*3*t)*np.exp(-t*14)
    v  = w * env_ad(n, 0.003, 5.2) * amp * 0.17
    v  = lp(v, 8600)
    add(L, v * (0.5 - 0.34*pan) * 2, t0)
    add(R, v * (0.5 + 0.34*pan) * 2, t0)

def subkick(t0, amp=1.0):
    """the ONLY drum in the film, and it does not arrive until 12.00"""
    n = idx(0.60); t = np.arange(n) / SR
    f = 38 + 30 * np.exp(-t * 22)
    v = np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t*5.6) * amp * 0.50
    a = int(0.0020 * SR)                     # 2 ms attack — no click
    v[:a] *= np.linspace(0, 1, a) ** 2
    v = lp(v, 165)
    add(L, v, t0); add(R, v, t0)

def swell(t0, dur=0.70, amp=1.0):
    """one reverse-riser, into the picardy third and nowhere else"""
    n = idx(dur); t = np.arange(n)/SR
    rng = np.random.RandomState(int(t0*97) % 9973)
    e = (t/dur) ** 2.4
    r = int(0.006 * SR)                       # 6 ms release into the cut
    e[-r:] *= np.cos(np.linspace(0, np.pi/2, r)) ** 2
    v = bp(rng.randn(n), 600, 2600) * e * amp * 0.115
    add(L, v*1.0, t0); add(R, v*0.90, t0)

# ---------------------------------------------------------------- score
D2,A2,Bb2,C3,D3,E3,F3,Fs3,G3,A3,Bb3,C4,D4,E4,F4,Fs4,G4,A4 = \
 73.42,110.00,116.54,130.81,146.83,164.81,174.61,185.00,196.00,220.00,233.08, \
 261.63,293.66,329.63,349.23,369.99,392.00,440.00

# harmony mapped onto the PLATES, not onto a bar grid: one chord per plate.
CHORDS = [
    ( 0.00,  3.00, [D3, F3, A3, C4],           0.62, 1250),   # Dm7      — she rises
    ( 3.00,  5.25, [Bb2, D3, F3, A3],          0.66, 1350),   # Bbmaj7   — the sash
    ( 5.25,  7.50, [F3, A3, C4, G4],           0.70, 1500),   # F(add9)  — the cohort
    ( 7.50,  9.75, [C3, E3, G3, C4],           0.72, 1600),   # C        — the workshop
    ( 9.75, 12.00, [D3, F3, A3, C4, E4],       0.76, 1700),   # Dm7      — the promise
    (12.00, 15.90, [D3, Fs3, A3, D4, E4],      0.92, 2400),   # D MAJOR  — the picardy third
]
for t0, t1, ch, amp, br in CHORDS:
    pad(ch, t0, t1, amp, br)

# the bowed layer under it — in quietly at the cohort, full under the ask
strings([D2, A2, D3],  0.00,  5.25, 0.34, 1500)
strings([Bb2, F3, D3], 3.00,  7.50, 0.40, 1700)
strings([F3, C4, A3],  5.25,  9.75, 0.46, 1900)
strings([C3, G3, E3],  7.50, 12.00, 0.52, 2000)
strings([D3, A3, F3],  9.75, 12.10, 0.58, 2100)
strings([D2, A2, D3, Fs3], 12.00, 15.90, 0.86, 2500)

# --- the piano. One note per beat AT MOST, and eight of the twenty beats are rests. --
P = {'G4':392.00,'A4':440.00,'C5':523.25,'D5':587.33,'E5':659.25,
     'F5':698.46,'Fs5':739.99,'A5':880.00,'D6':1174.66,'Fs6':1479.98}
MEL = [                       # (beat index, note, accent)
    ( 0, 'A4', 0.78), ( 2, 'D5', 0.92), ( 3, 'A4', 0.52),
    ( 4, 'F5', 1.00),                                     # 3.00  dissolve 1
    ( 6, 'D5', 0.72),
    ( 7, 'A4', 0.96),                                     # 5.25  dissolve 2
    ( 9, 'C5', 0.66),
    (10, 'E5', 1.00),                                     # 7.50  dissolve 3
    (12, 'G4', 0.70),
    (13, 'F5', 1.00),                                     # 9.75  dissolve 4
    (15, 'E5', 0.74),
    (16, 'Fs5', 1.22),                                    # 12.00 THE PICARDY THIRD
    (17, 'A5', 0.86), (18, 'D5', 0.80), (19, 'Fs5', 0.66),
]
for b, nm, acc in MEL:
    t = b * BEAT
    gg = np.interp(t, [0.0, 0.40, 1.50, 3.00, 5.25, 7.50, 9.75, 12.00, 13.50, 15.00],
                      [0.40, 0.52, 0.66, 0.74, 0.80, 0.86, 0.82,  1.00,  0.94,  0.88])
    felt(P[nm], t, gg*acc, dec=2.3, pan=(-0.26 if b % 2 else 0.26))
felt(P['A4'], 19*BEAT, 0.40, dec=2.6, pan=-0.30)          # the third under the last note

# --- accents locked to the picture ---------------------------------------------
# the five dissolves: one glass bell each, the last one an octave up and twice as big
for k, c in enumerate(CUTS):
    last = (k == 4)
    bell(P['D6'] if last else P['D5'], c, 0.56 if last else 0.24, dec=5.0 if last else 4.2,
         pan=-0.22 + 0.11*k)
# the orange hairline drawing across the frame, once per plate change (authored -> grid)
harp(P['A5'], g(0.45), 0.15, pan=-0.30)
for k, c in enumerate(SC_A[1:6]):
    harp(P['A5'] if k % 2 else P['Fs5'], g(c + 0.10), 0.13 + 0.012*k, pan=0.30 - 0.13*k)

# the device rising, and settling
harp(P['D5'], g(12.50), 0.30, pan=-0.26)
harp(P['A5'], g(12.86), 0.34, pan= 0.26)
bell(P['Fs5'], g(13.65), 0.30, dec=5.4)                   # ...it settles
harp(P['Fs5'], g(12.82), 0.22, pan=0.0)                   # the lockup lands
# the two store badges
harp(P['A5'], g(13.34), 0.40, pan=-0.30)
harp(P['D6'], g(13.47), 0.38, pan= 0.30)
bell(P['A5'], g(13.76), 0.20, dec=6.0, pan=0.18)          # the handle

# --- the only percussion in the film: from 12.00, under the ask -----------------
swell(11.30, 0.70, 1.20)
subkick(12.00, 1.00)
subkick(13.50, 0.70)
subkick(14.25, 0.46)

# --- room tone: a band-limited air bed. Without it the mix is all felt and pad and
#     reads as mud through a phone speaker; with it the 2-8 kHz band stays alive. ---
_rng = np.random.RandomState(1729)
air  = bp(_rng.randn(N), 2400, 7200)
air *= np.interp(T, [0.0, 1.2, 7.5, 12.0, 13.4, 15.0, DUR],
                    [0.30, 0.62, 0.80, 1.00, 0.90, 0.70, 0.55]) * 0.0220
L += air * 0.96; R += air[::-1] * 1.04                    # decorrelated, so it opens up

# ---------------------------------------------------------------- space
def reverb(x):
    """wide and long — this is a room, not a plate"""
    wet  = comb(x, 0.0311, 0.80) + comb(x, 0.0389, 0.78)
    wet += comb(x, 0.0437, 0.75) + comb(x, 0.0473, 0.73)
    return lp(wet, 4000) * 0.28

L = L + reverb(L) * 0.94
R = R + reverb(R) * 1.00

# ---------------------------------------------------------------- master
for buf in (L, R):
    buf *= np.interp(T, [0.0, 0.45, 15.05, 15.42, DUR], [0.0, 1.0, 1.0, 0.26, 0.0])

L = hp(L, 38);  R = hp(R, 38)                  # phone speakers cannot use sub anyway
L = shelf_hi(L, 2400, 2.10); R = shelf_hi(R, 2400, 2.10)
L = lp2(L, 15000); R = lp2(R, 15000)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.97, R / peak * 0.97
DRIVE = 1.25                                   # sparse score: the glue does the loudness
L, R = np.tanh(L * DRIVE) * 0.86, np.tanh(R * DRIVE) * 0.86

st = np.empty(N * 2)
st[0::2], st[1::2] = L, R
pcm = np.clip(st, -1, 1)
with wave.open('bed.wav', 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((pcm * 32767).astype('<i2').tobytes())

rms = np.sqrt(np.mean(np.concatenate([L, R])**2))
print(f"bed.wav  {DUR}s  peak={max(abs(L).max(),abs(R).max()):.3f}  "
      f"rms={rms:.4f}  ({20*np.log10(rms):.1f} dBFS)")
