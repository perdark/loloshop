#!/usr/bin/env python3
"""
LoloShop reel — music bed, synthesised from scratch (numpy only, no samples, no API).
Scored to index.html: every accent lands on a real event in the picture.

  D(add9) -> Bm7 -> Gmaj9 -> Em7 -> Asus4/A -> D   |  120 BPM, 8 bars x 2s
  A ii-V-I that RESOLVES exactly on the CTA cut (13.28s), because the ask is the
  point of the film — the harmony should stop leaning forward at the same instant
  the picture does.

Verify by measuring, never by ear on a laptop speaker:  python3 verify_audio.py
"""
import numpy as np, wave

SR   = 44100
DUR  = 16.55                      # 16s picture + 0.55s tail
N    = int(SR * DUR)
T    = np.arange(N) / SR
BEAT = 0.5                        # 120 BPM

L = np.zeros(N); R = np.zeros(N)

# ---------------------------------------------------------------- the grid
# index.html was animated freehand (SC_A) and is remapped at render time onto the
# beat (SC_B) — 3-4-5-6-4-4-6 beats, 16.0s exactly. g() carries a picture-locked
# accent from the authored timeline onto the same beat grid, so "the bell on the
# cut" stays on the cut instead of drifting a frame or two off it.
SC_A = [0, 1.68, 3.53, 6.18, 8.88, 11.20, 13.20, 16.00]
SC_B = [0, 1.50, 3.50, 6.00, 9.00, 11.00, 13.00, 16.00]
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
    """one-pole lowpass as an exponential FIR (vectorised, click-free)"""
    tau = 1.0 / (2 * np.pi * cut)
    k = max(2, int(tau * SR * 6))
    h = np.exp(-np.arange(k) / (tau * SR)); h /= h.sum()
    return np.convolve(x, h)[:len(x)]

def hp(x, cut):  return x - lp(x, cut)
def lp2(x, cut): return lp(lp(x, cut), cut)
def bp(x, lo, hi): return lp2(hp(x, lo), hi)
def shelf_hi(x, cut, gain): return x + gain * hp(x, cut)

def comb(x, delay_s, g, taps=24):
    d = int(delay_s * SR); out = np.zeros_like(x); gk = 1.0
    for k in range(taps):
        s = k * d
        if s >= len(x) or gk < 1e-4: break
        out[s:] += gk * x[:len(x)-s]
        gk *= g
    return out

# ---------------------------------------------------------------- voices
def pad(freqs, t0, t1, amp, bright=1800.0):
    """warm stacked-sine pad, detuned three ways and stereo-spread"""
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
            w += 0.05 * np.sin(2*np.pi*(f+det)*5*t*vib)   # air
            v  = w * e * amp / (len(freqs) * 2.4)
            add(L, lp(v, bright) * (0.5 - 0.32*pan) * 2, t0)
            add(R, lp(v, bright) * (0.5 + 0.32*pan) * 2, t0)

def felt(f, t0, amp=1.0, dec=3.4, pan=0.0):
    """felt piano: fundamental + a little hammer, the top rolled off"""
    n = idx(2.6); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t)
    w += 0.34 * np.sin(2*np.pi*f*2.001*t) * np.exp(-t*dec*1.9)
    w += 0.14 * np.sin(2*np.pi*f*3.003*t) * np.exp(-t*dec*3.1)
    w += 0.06 * np.sin(2*np.pi*f*4.01*t)  * np.exp(-t*dec*4.6)
    v  = w * env_ad(n, 0.006, dec) * amp * 0.26
    v  = lp(v, 6200)                      # felt = dark; this is the "composed" register
    add(L, v * (0.5 - 0.28*pan) * 2, t0)
    add(R, v * (0.5 + 0.28*pan) * 2, t0)

def bell(f, t0, amp=1.0, dec=5.0, pan=0.0):
    """glass bell — inharmonic, used only for accents"""
    n = idx(2.2); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t)
    w += 0.44 * np.sin(2*np.pi*f*2.76*t) * np.exp(-t*dec*2.2)
    w += 0.20 * np.sin(2*np.pi*f*5.40*t) * np.exp(-t*dec*3.6)
    w += 0.09 * np.sin(2*np.pi*f*8.93*t) * np.exp(-t*dec*6.5)
    v  = w * env_ad(n, 0.003, dec) * amp * 0.20
    v  = lp(v, 11000)
    add(L, v * (0.5 - 0.32*pan) * 2, t0)
    add(R, v * (0.5 + 0.32*pan) * 2, t0)

def harp(f, t0, amp=1.0, pan=0.0):
    """short plucked string for the arpeggio under the catalogue scroll"""
    n = idx(1.4); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t) + 0.30*np.sin(2*np.pi*f*2*t)*np.exp(-t*9) \
       + 0.13*np.sin(2*np.pi*f*3*t)*np.exp(-t*14)
    v  = w * env_ad(n, 0.003, 5.6) * amp * 0.17
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
    """brushed snare-ish tick — softer than a shaker, right for 'composed'"""
    n = idx(0.11)
    rng = np.random.RandomState(rs if rs is not None else 1)
    e = np.exp(-np.arange(n)/SR*44)
    a = int(0.0018 * SR)                      # 1.8 ms attack — no click
    e[:a] *= np.linspace(0, 1, a) ** 2
    v = bp(rng.randn(n), 2600, 6400) * e * amp * 0.36
    add(L, v*0.92, t0); add(R, v*1.08, t0)

def tick(t0, amp=1.0, rs=7):
    """the UI tap: a tiny wooden click, enveloped at both ends"""
    n = idx(0.045)
    rng = np.random.RandomState(rs)
    e = np.exp(-np.arange(n)/SR*150)
    a = int(0.0012 * SR)
    e[:a] *= np.linspace(0, 1, a) ** 2
    v = bp(rng.randn(n), 1400, 4200) * e * amp * 0.30
    v += np.sin(2*np.pi*1180*np.arange(n)/SR) * e * amp * 0.10
    add(L, v, t0); add(R, v, t0)

def swell(t0, dur=0.55, amp=1.0):
    """reverse-riser into a cut: a noise band rising, chopped at the hit"""
    n = idx(dur); t = np.arange(n)/SR
    rng = np.random.RandomState(int(t0*97) % 9973)
    e = (t/dur) ** 2.6
    r = int(0.004 * SR)                       # 4 ms release into the cut
    e[-r:] *= np.cos(np.linspace(0, np.pi/2, r)) ** 2
    v = bp(rng.randn(n), 700, 2700) * e * amp * 0.105
    add(L, v*1.0, t0); add(R, v*0.92, t0)

# ---------------------------------------------------------------- score
D2,A2,B2,E3,G3,A3,B3,D3,Fs3,Cs4,D4,E4,Fs4 = \
  73.42,110.00,123.47,164.81,196.00,220.00,246.94,146.83,185.00,277.18,293.66,329.63,369.99

# harmony mapped ONTO the cut list, not onto a bar grid
CHORDS = [
    ( 0.00,  3.50, [D3, A3, D4, E4],        0.60, 1500),   # D add9   — splash + hook
    ( 3.50,  6.00, [B2, D3, Fs3, A3],       0.66, 1700),   # Bm7      — the app lands
    ( 6.00,  9.00, [G3, B3, D4, Fs4],       0.70, 1900),   # Gmaj9    — the catalogue
    ( 9.00, 11.00, [E3, G3, B3, D4],        0.72, 2000),   # Em7      — design it
    (11.00, 13.00, [A2, D3, E3, A3],        0.78, 2100),   # Asus4    — tension: why us
    (13.00, 16.40, [D3, Fs3, A3, D4, E4],   0.86, 2700),   # D add9   — the ask, resolved
]
for t0, t1, ch, amp, br in CHORDS:
    pad(ch, t0, t1, amp, br)

# D-major-pentatonic melody, one note per beat; the arc peaks on the CTA
P = {'D4':293.66,'E4':329.63,'F#4':369.99,'A4':440.00,'B4':493.88,
     'D5':587.33,'E5':659.25,'F#5':739.99,'A5':880.00,'B5':987.77,'D6':1174.66}
BARS = [
    ['A4','D5','A4','F#4'],   # 0.0  splash — sparse, gain curve holds it back
    ['A4','D5','F#5','E5'],   # 2.0  hook
    ['D5','F#5','A5','F#5'],  # 4.0  the device
    ['E5','F#5','A5','B5'],   # 6.0  catalogue
    ['A5','F#5','E5','D5'],   # 8.0
    ['F#5','A5','B5','A5'],   # 10.0 design
    ['E5','D5','E5','F#5'],   # 12.0 why
    ['A5','D6','A5','F#5'],   # 14.0 the ask
]
for b, bar in enumerate(BARS):
    for j, nm in enumerate(bar):
        t = b*2.0 + j*BEAT
        if t >= 16.0: break
        gg = np.interp(t, [0.0, 0.8, 1.5, 3.5, 6.0, 9.0, 11.0, 13.0, 16.0],
                          [0.00, 0.00, 0.55, 0.74, 0.88, 0.80, 0.72, 1.00, 0.92])
        if gg <= 0.01: continue
        accent = 1.18 if j == 0 else (0.70 if j % 2 else 0.88)
        felt(P[nm], t, gg*accent, dec=3.2, pan=(-0.28 if j % 2 else 0.28))

# heartbeat: downbeats only, in once the device is on screen
t = 0.0
while t < 16.0:
    gg = np.interp(t, [0.0, 3.0, 3.5, 9.0, 11.0, 13.0, 16.0],
                      [0.0, 0.0, 0.82, 1.00, 0.86, 1.00, 0.88])
    if gg > 0.02: kick_at(t, gg)
    t += 1.0

# brushes on the offbeat — busiest under the scroll, where the picture moves most
t, si = 1.75, 0
while t < 15.7:
    gg = np.interp(t, [1.5, 2.0, 6.0, 6.5, 8.5, 9.0, 11.0, 13.0, 15.7],
                      [0.0, 0.62, 0.72, 1.00, 1.00, 0.55, 0.80, 1.00, 0.55])
    if gg > 0.02: brush(t, gg, rs=si)
    si += 1; t += BEAT

# --- accents locked to the picture -------------------------------------
CUTS = [1.50, 3.50, 6.00, 9.00, 11.00, 13.00]
for c in CUTS:
    swell(max(0.0, c-0.55), 0.55, 0.90 if c != 13.00 else 1.25)
    bell(P['D5'] if c != 13.00 else P['D6'], c, 0.48, dec=5.2)

bell(P['A5'], g(0.55), 0.55, dec=6.0)                        # the mark settles
for k, ts in enumerate(map(g, (1.74, 1.812, 1.884, 1.956))):      # hook line 1, word by word
    harp((P['D5'], P['E5'], P['F#5'], P['A5'])[k], ts, 0.44, pan=-0.30+0.20*k)
for k, ts in enumerate(map(g, (2.14, 2.206, 2.272, 2.338))):      # hook line 2
    harp((P['A4'], P['D5'], P['E5'], P['F#5'])[k], ts, 0.40, pan=0.30-0.20*k)
brush(g(2.58), 0.85, rs=91)                                  # the brush stroke under مطرّز

kick_at(g(4.62), 1.05); bell(P['F#5'], g(4.62), 0.62, dec=4.4)  # the device lands
for k in range(6):                                        # the signup count ticking up
    harp(P['A5'] if k % 2 else P['F#5'], g(4.72 + k*0.155), 0.16 + 0.03*k, pan=0.34-0.13*k)
bell(P['B5'], g(5.62), 0.42, dec=6.5)                        # ...and settles on ٢٬٠١٧

tick(g(6.14), 0.90)                                          # tap: القطع
for k, ts in enumerate(map(g, (7.08, 7.25, 7.42))):               # the three price chips
    harp((P['D5'], P['F#5'], P['A5'])[k], ts, 0.52, pan=-0.34+0.34*k)
tick(g(8.78), 0.90)                                          # tap: a product tile
for k, ts in enumerate(map(g, (9.30, 9.52))):                     # the two product tiles fly in
    harp((P['A5'], P['F#5'])[k], ts, 0.50, pan=-0.36+0.72*k)
for k, ts in enumerate(map(g, (11.38, 11.495, 11.61, 11.725))):   # four trust rows tick in
    felt((P['D4'], P['E4'], P['F#4'], P['A4'])[k], ts, 0.40, dec=5.4, pan=-0.33+0.22*k)

for k, f in enumerate(('D6','A5','F#5')):                 # the ask, sparkling
    bell(P[f], g(13.40 + k*0.075), 0.34*(0.86**k), dec=6.2, pan=-0.34+0.34*k)
for k, ts in enumerate(map(g, (13.92, 14.06))):                   # the two store badges
    harp((P['A5'], P['D6'])[k], ts, 0.46, pan=-0.30+0.60*k)
pad([D3, Fs3, A3, D4, P['A4']], 13.00, 16.40, 0.44, 3200) # final lift over the CTA

# ---------------------------------------------------------------- space
def reverb(x):
    wet  = comb(x, 0.0293, 0.77) + comb(x, 0.0367, 0.74)
    wet += comb(x, 0.0419, 0.71) + comb(x, 0.0443, 0.69)
    return lp(wet, 4400) * 0.25

L = L + reverb(L) * 0.90
R = R + reverb(R) * 1.00

# ---------------------------------------------------------------- master
for buf in (L, R):
    buf *= np.interp(T, [0.0, 0.40, 15.60, 16.05, DUR], [0.0, 1.0, 1.0, 0.32, 0.0])

L = hp(L, 40);  R = hp(R, 40)                  # phone speakers cannot use sub anyway
L = shelf_hi(L, 2500, 1.10); R = shelf_hi(R, 2500, 1.10)
L = lp2(L, 15000); R = lp2(R, 15000)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.97, R / peak * 0.97
L, R = np.tanh(L * 1.42) * 0.88, np.tanh(R * 1.42) * 0.88   # soft glue

st = np.empty(N * 2)
st[0::2], st[1::2] = L, R
pcm = np.clip(st, -1, 1)
with wave.open('bed.wav', 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((pcm * 32767).astype('<i2').tobytes())

rms = np.sqrt(np.mean(np.concatenate([L, R])**2))
print(f"bed.wav  {DUR}s  peak={max(abs(L).max(),abs(R).max()):.3f}  "
      f"rms={rms:.4f}  ({20*np.log10(rms):.1f} dBFS)")
