#!/usr/bin/env python3
"""
LoloShop — «أربع خطوات» music bed. Synthesised from scratch (numpy only).

THE PICTURE NEVER CUTS, SO THE MUSIC NEVER CUTS.
One plucked arpeggio runs from 0.0 to 16.0 without a break. Nothing is faded in
and out; each step ARRIVAL adds a permanent layer on top of what is already
playing, the way the camera adds a panel without leaving the one before it:

    ١  bt 4   (2.286s)  felt piano enters
    ٢  bt 10  (5.714s)  brushes enter
    ٣  bt 16  (9.143s)  sub kick enters
    ٤  bt 22  (12.571s) bells enter
    CTA bt 25 (14.286s) everything, and the harmony resolves

  A -> E/G# -> F#m7 -> D -> A/E -> E -> A     105 BPM, 28 beats, 16.000s exactly
The V (E) leans for exactly one beat and lands on A at bt 25 — the same instant
the camera stops on the ask. There are no reverse-risers anywhere: a swell into a
cut is an edit sound, and this film has no edits. The only long gesture is one
crescendo from bt 21 to bt 25.

Verify by measuring, never by ear on a laptop speaker:  python3 ../shared/verify_audio.py
"""
import numpy as np, wave

SR   = 44100
DUR  = 16.55                      # 16.0s picture + 0.55s tail
N    = int(SR * DUR)
T    = np.arange(N) / SR
BEAT = 60 / 105                   # 0.5714285714285714 s
def bt(n): return n * BEAT

L = np.zeros(N); R = np.zeros(N)

# ---------------------------------------------------------------- the grid
# index.html was authored ON the beat grid (every camera anchor is bt(n)), so the
# makeGrid remap there is the identity and g() is its mirror. Kept explicit so
# that if the picture is ever re-timed freehand, both halves move together.
SC_A = [bt(0), bt(4), bt(10), bt(16), bt(22), bt(25), bt(28)]
SC_B = [bt(0), bt(4), bt(10), bt(16), bt(22), bt(25), bt(28)]
def g(t):
    for i in range(len(SC_A) - 1):
        if t <= SC_A[i+1]:
            return SC_B[i] + (t - SC_A[i]) * (SC_B[i+1] - SC_B[i]) / (SC_A[i+1] - SC_A[i])
    return SC_B[-1] + (t - SC_A[-1])

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
    tau = 1.0 / (2 * np.pi * cut)
    k = max(2, int(tau * SR * 6))
    h = np.exp(-np.arange(k) / (tau * SR)); h /= h.sum()
    return np.convolve(x, h)[:len(x)]

def hp(x, cut):  return x - lp(x, cut)
def lp2(x, cut): return lp(lp(x, cut), cut)
def bp(x, lo, hi): return lp2(hp(x, lo), hi)
def shelf_hi(x, cut, gain): return x + gain * hp(x, cut)

def comb(x, delay_s, gn, taps=24):
    d = int(delay_s * SR); out = np.zeros_like(x); gk = 1.0
    for k in range(taps):
        s = k * d
        if s >= len(x) or gk < 1e-4: break
        out[s:] += gk * x[:len(x)-s]
        gk *= gn
    return out

# ---------------------------------------------------------------- voices
def pad(freqs, t0, t1, amp, bright=1800.0):
    n = idx(t1 - t0) + idx(1.3)
    if n <= 0: return
    t = np.arange(n) / SR
    a, r = idx(0.60), idx(1.15)
    e = np.ones(n)
    e[:a]  = np.sin(np.linspace(0, np.pi/2, a)) ** 2
    e[-r:] *= np.cos(np.linspace(0, np.pi/2, r)) ** 2
    for j, f in enumerate(freqs):
        vib = 1 + 0.0015 * np.sin(2*np.pi*(0.17 + 0.06*j)*t + j)
        for det, pan in ((-0.12, -1), (0.0, 0), (0.12, 1)):
            w  = np.sin(2*np.pi*(f + det) * t * vib + j*1.7 + det*9)
            w += 0.24 * np.sin(2*np.pi*(f+det)*2*t*vib)
            w += 0.12 * np.sin(2*np.pi*(f+det)*3*t*vib)
            w += 0.05 * np.sin(2*np.pi*(f+det)*5*t*vib)
            v  = w * e * amp / (len(freqs) * 2.4)
            add(L, lp(v, bright) * (0.5 - 0.32*pan) * 2, t0)
            add(R, lp(v, bright) * (0.5 + 0.32*pan) * 2, t0)

def felt(f, t0, amp=1.0, dec=3.4, pan=0.0):
    n = idx(2.6); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t)
    w += 0.34 * np.sin(2*np.pi*f*2.001*t) * np.exp(-t*dec*1.9)
    w += 0.14 * np.sin(2*np.pi*f*3.003*t) * np.exp(-t*dec*3.1)
    w += 0.06 * np.sin(2*np.pi*f*4.01*t)  * np.exp(-t*dec*4.6)
    v  = w * env_ad(n, 0.006, dec) * amp * 0.26
    v  = lp(v, 6200)
    add(L, v * (0.5 - 0.28*pan) * 2, t0)
    add(R, v * (0.5 + 0.28*pan) * 2, t0)

def bell(f, t0, amp=1.0, dec=5.0, pan=0.0):
    n = idx(2.2); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t)
    w += 0.44 * np.sin(2*np.pi*f*2.76*t) * np.exp(-t*dec*2.2)
    w += 0.20 * np.sin(2*np.pi*f*5.40*t) * np.exp(-t*dec*3.6)
    w += 0.09 * np.sin(2*np.pi*f*8.93*t) * np.exp(-t*dec*6.5)
    v  = w * env_ad(n, 0.003, dec) * amp * 0.20
    v  = lp(v, 11000)
    add(L, v * (0.5 - 0.32*pan) * 2, t0)
    add(R, v * (0.5 + 0.32*pan) * 2, t0)

def harp(f, t0, amp=1.0, pan=0.0, ring=5.6):
    """the spine of this bed: it never stops, and each note rings 1.4s so the
       arpeggio is a continuous sheet rather than a row of separate plucks"""
    n = idx(1.4); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t) + 0.30*np.sin(2*np.pi*f*2*t)*np.exp(-t*9) \
       + 0.13*np.sin(2*np.pi*f*3*t)*np.exp(-t*14)
    v  = w * env_ad(n, 0.003, ring) * amp * 0.17
    v  = lp(v, 8000)
    add(L, v * (0.5 - 0.34*pan) * 2, t0)
    add(R, v * (0.5 + 0.34*pan) * 2, t0)

def kick_at(t0, amp=1.0):
    n = idx(0.42); t = np.arange(n) / SR
    f = 46 + 54 * np.exp(-t * 26)
    v = np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t*7.8) * amp * 0.46
    v = lp(v, 210)
    add(L, v, t0); add(R, v, t0)

def brush(t0, amp=1.0, rs=None):
    n = idx(0.11)
    rng = np.random.RandomState(rs if rs is not None else 1)
    e = np.exp(-np.arange(n)/SR*44)
    a = int(0.0018 * SR)
    e[:a] *= np.linspace(0, 1, a) ** 2
    v = bp(rng.randn(n), 2600, 6400) * e * amp * 0.36
    add(L, v*0.92, t0); add(R, v*1.08, t0)

def tick(t0, amp=1.0, rs=7):
    n = idx(0.045)
    rng = np.random.RandomState(rs)
    e = np.exp(-np.arange(n)/SR*150)
    a = int(0.0012 * SR)
    e[:a] *= np.linspace(0, 1, a) ** 2
    v = bp(rng.randn(n), 1400, 4200) * e * amp * 0.30
    v += np.sin(2*np.pi*1180*np.arange(n)/SR) * e * amp * 0.10
    add(L, v, t0); add(R, v, t0)

def rise(t0, dur, amp=1.0):
    """the ONE long gesture: a crescendo, not a riser into a cut. It peaks with
       the CTA and then RELEASES over 350 ms instead of being chopped."""
    tail = 0.40
    n = idx(dur + tail); k = idx(dur)
    e = np.zeros(n)
    e[:k] = (np.arange(k) / k) ** 2.3
    e[k:] = np.exp(-np.arange(n - k) / SR * 6.5)
    a = int(0.020 * SR); e[:a] *= np.linspace(0, 1, a) ** 2
    rng = np.random.RandomState(int(t0 * 131) % 9973)
    v = bp(rng.randn(n), 620, 3000) * e * amp * 0.105
    add(L, v * 1.00, t0); add(R, v * 0.90, t0)

# ---------------------------------------------------------------- pitches
A2,Gs2,Fs2,Cs3,D3,E3,Fs3,Gs3,A3,B3,Cs4,D4,E4,Fs4 = \
 110.00,103.83,92.50,138.59,146.83,164.81,185.00,207.65,220.00,246.94,277.18,293.66,329.63,369.99
P = {'E4':329.63,'Fs4':369.99,'Gs4':415.30,'A4':440.00,'B4':493.88,'Cs5':554.37,
     'D5':587.33,'E5':659.25,'Fs5':739.99,'Gs5':830.61,'A5':880.00,'B5':987.77,
     'Cs6':1108.73,'D6':1174.66,'E6':1318.51}

# ------------------------------------------------------- harmony, mapped to the anchors
CHORDS = [
    (bt(0),  bt(4),   [A2, E3, A3, Cs4],          0.56, 1450, ['A4','Cs5','E5','A5']),      # A      title
    (bt(4),  bt(10),  [Gs2, E3, Gs3, B3],         0.62, 1650, ['Gs4','B4','E5','Gs5']),     # E/G#   ١
    (bt(10), bt(16),  [Fs2, Cs3, Fs3, A3, E4],    0.66, 1800, ['Fs4','A4','Cs5','E5']),     # F#m7   ٢
    (bt(16), bt(22),  [D3, A3, D4, Fs4],          0.70, 1950, ['Fs4','A4','D5','Fs5']),     # D      ٣
    (bt(22), bt(24),  [E3, A3, Cs4, E4],          0.74, 2050, ['E4','A4','Cs5','E5']),      # A/E    ٤
    (bt(24), bt(25),  [E3, Gs3, B3, E4],          0.80, 2200, ['B4','E5','Gs5','B5']),      # E      the lean
    (bt(25), 16.90,   [A2, E3, A3, Cs4, E4],      0.88, 2750, ['A4','Cs5','E5','A5']),      # A      the ask
]
for t0, t1, ch, amp, br, _ in CHORDS:
    pad(ch, t0, t1, amp, br)

def chord_at(t):
    for c in CHORDS:
        if t < c[1] - 1e-6: return c
    return CHORDS[-1]

# ------------------------------------------------------- 1. THE ARPEGGIO (0.0 -> 16.0, unbroken)
PAT = [0, 1, 2, 3, 2, 1, 0, 2]
k = 0
t = 0.0
while t < 16.0 - 1e-6:
    ch  = chord_at(t)
    nm  = ch[5][PAT[k % 8]]
    gg  = np.interp(t, [0.0, bt(4), bt(10), bt(16), bt(22), bt(25), bt(27), 16.0],
                       [0.44, 0.56, 0.64, 0.70, 0.80, 1.00, 0.94, 0.84])
    acc = 1.22 if k % 8 == 0 else (0.92 if k % 2 == 0 else 0.70)
    pan = -0.34 + 0.17 * (k % 5)
    harp(P[nm], t, gg * acc, pan=pan)
    if k % 8 == 3 and P[nm] * 2 < 2400:          # one octave sparkle per bar
        harp(P[nm] * 2, t, gg * 0.30, pan=-pan, ring=7.4)
    k += 1
    t = k * BEAT / 2                              # eighth notes

# ------------------------------------------------------- 2. FELT PIANO — enters on ١
MEL = ['A4','Cs5','E5','Cs5',  'B4','E5','Gs5','Fs5',  'A5','Fs5','E5','Cs5',
       'D5','Fs5','A5','Fs5',  'D5','E5','A5','Cs5',   'B4','Cs6','A5','E5']
for j, nm in enumerate(MEL):
    n_beat = 4 + j
    t = bt(n_beat)
    if t >= 16.0: break
    gg = np.interp(t, [bt(4), bt(5), bt(10), bt(16), bt(22), bt(25), 16.0],
                      [0.55, 0.68, 0.76, 0.84, 0.94, 1.10, 0.88])
    acc = 1.16 if j % 4 == 0 else (0.78 if j % 2 else 0.96)
    felt(P[nm], t, gg * acc, dec=3.1, pan=(-0.28 if j % 2 else 0.28))
felt(P['A4'] / 2, bt(25), 1.05, dec=2.4, pan=0.0)     # the CTA gets a root underneath it

# ------------------------------------------------------- 3. BRUSHES — enter on ٢
si = 0
for nb in range(10, 28):
    t = bt(nb + 0.5)
    if t >= 15.85: break
    gg = np.interp(t, [bt(10), bt(11), bt(16), bt(22), bt(25), 15.85],
                      [0.00, 0.58, 0.74, 0.88, 1.00, 0.52])
    if gg > 0.02: brush(t, gg, rs=si)
    si += 1

# ------------------------------------------------------- 4. SUB KICK — enters on ٣
for nb in range(16, 28, 2):
    t = bt(nb)
    if t >= 16.0: break
    gg = np.interp(t, [bt(16), bt(18), bt(22), bt(25), 16.0], [0.92, 1.00, 1.04, 1.14, 0.92])
    kick_at(t, gg)
kick_at(bt(25), 1.14)                                  # the ask lands on its own downbeat

# ------------------------------------------------------- 5. BELLS — enter on ٤
bell(P['Cs6'], bt(22), 0.46, dec=5.4, pan=-0.10)
bell(P['Gs5'], bt(23), 0.30, dec=6.0, pan=0.28)
bell(P['B5'],  bt(24), 0.34, dec=5.8, pan=-0.26)
for j, nm in enumerate(('Cs6', 'A5', 'E5')):           # the CTA, sparkling
    bell(P[nm], bt(25) + j * 0.075, 0.44 * (0.84 ** j), dec=6.4, pan=-0.34 + 0.34*j)
bell(P['E6'], bt(26), 0.26, dec=7.0, pan=0.20)
bell(P['A5'], bt(27), 0.30, dec=7.2, pan=-0.18)

# ------------------------------------------------------- the four arrivals, marked
harp(P['A4'], bt(4) - BEAT/4, 0.52, pan=0.30)          # ١ — a grace note into the piano
harp(P['E5'], bt(10) - BEAT/4, 0.54, pan=-0.30)        # ٢
felt(P['D5'] / 2, bt(16), 0.90, dec=2.6, pan=0.0)      # ٣ — a low root with the kick
tick(bt(8.5), 0.62)                                     # the phone screen changes

# ------------------------------------------------------- ONE crescendo into the CTA
rise(bt(21), bt(25) - bt(21), 0.95)
pad([A2, E3, A3, Cs4, E4, P['A4']], bt(25), 16.90, 0.42, 3300)

# ---------------------------------------------------------------- space
def reverb(x):
    wet  = comb(x, 0.0293, 0.77) + comb(x, 0.0367, 0.74)
    wet += comb(x, 0.0419, 0.71) + comb(x, 0.0443, 0.69)
    return lp(wet, 4400) * 0.25

L = L + reverb(L) * 0.90
R = R + reverb(R) * 1.00

# ---------------------------------------------------------------- master
for buf in (L, R):
    buf *= np.interp(T, [0.0, 0.30, 16.05, 16.30, DUR], [0.0, 1.0, 1.0, 0.34, 0.0])

L = hp(L, 40);  R = hp(R, 40)
L = shelf_hi(L, 2500, 1.10); R = shelf_hi(R, 2500, 1.10)
L = lp2(L, 15000); R = lp2(R, 15000)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.97, R / peak * 0.97
L, R = np.tanh(L * 1.42) * 0.88, np.tanh(R * 1.42) * 0.88

st = np.empty(N * 2)
st[0::2], st[1::2] = L, R
pcm = np.clip(st, -1, 1)
with wave.open('bed.wav', 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((pcm * 32767).astype('<i2').tobytes())

rms = np.sqrt(np.mean(np.concatenate([L, R])**2))
print(f"bed.wav  {DUR}s  peak={max(abs(L).max(),abs(R).max()):.3f}  "
      f"rms={rms:.4f}  ({20*np.log10(rms):.1f} dBFS)")
