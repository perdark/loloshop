#!/usr/bin/env python3
"""
REEL C — «٥٤ موديل» · kinetic poster grid.  Music bed, numpy only, no samples.

128 BPM.  BEAT = 0.46875s.  32 beats = 8 bars = 15.000s of picture + 0.55s tail.
Percussive and TIGHT: marimba on the 8ths, a snappy kick on 1 and 3, a rim tick
on every offbeat, and a reverb that is a room rather than a cathedral — the
reference reel's bed was long and wet and it would smear every cut in this film.

  F#m -> D -> A -> E -> F#m -> D -> E -> A     (one chord per bar)
  It leaves F# minor for A major at the CTA bar, so the harmony resolves on the
  same downbeat the ask lands on.

Every accent is locked to a real event in index.html:
  bar 1  a marimba note on each of the 12 tile arrivals (one per 8th)
  bar 2  the ٥٤ slam, then four count-ticks on their own 8ths
  bar 3-4  three price stabs, one per block
  bar 5-6  two tick() taps, one 8th before each screen change
  bar 7  a reversed swell into the explode
  bar 8  the CTA resolves on A

Verify by measuring, never by ear on a laptop speaker:  python3 ../shared/verify_audio.py
"""
import numpy as np, wave

SR   = 44100
DUR  = 15.55                      # 15.000s picture + 0.55s tail
N    = int(SR * DUR)
T    = np.arange(N) / SR
BEAT = 0.46875                    # 128 BPM
E8   = BEAT / 2                   # 0.234375 — the smallest unit in this film
BAR  = BEAT * 4                   # 1.875

L = np.zeros(N); R = np.zeros(N)

# ---------------------------------------------------------------- the grid
# index.html is animated against a round 0.47s beat (SC_A) and shipped on the
# true 0.46875s grid (SC_B).  g() is the exact mirror of makeGrid(SC_A, SC_B):
# hand it an AUTHORED time from the composition and it returns the real time
# the renderer will put that frame at, so a picture-locked accent cannot drift.
SC_A = [0, 1.88, 4.70, 7.52, 11.28, 13.16, 15.04]
SC_B = [0, 1.875, 4.6875, 7.500, 11.250, 13.125, 15.000]
def g(t):
    for i in range(len(SC_A) - 1):
        if t <= SC_A[i+1]:
            return SC_B[i] + (t - SC_A[i]) * (SC_B[i+1] - SC_B[i]) / (SC_A[i+1] - SC_A[i])
    return SC_B[-1] + (t - SC_A[-1])

def bt(n): return n * BEAT        # real time of beat n — the picture's own ruler

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

def comb(x, delay_s, gg, taps=24):
    d = int(delay_s * SR); out = np.zeros_like(x); gk = 1.0
    for k in range(taps):
        s = k * d
        if s >= len(x) or gk < 1e-4: break
        out[s:] += gk * x[:len(x)-s]
        gk *= gg
    return out

# ---------------------------------------------------------------- voices
def pad(freqs, t0, t1, amp, bright=1900.0):
    """the harmonic bed — short attack and short release, it must not smear a cut"""
    n = idx(t1 - t0) + idx(0.55)
    if n <= 0: return
    t = np.arange(n) / SR
    a, r = idx(0.14), idx(0.48)
    e = np.ones(n)
    e[:a]  = np.sin(np.linspace(0, np.pi/2, a)) ** 2
    e[-r:] *= np.cos(np.linspace(0, np.pi/2, r)) ** 2
    for j, f in enumerate(freqs):
        vib = 1 + 0.0012 * np.sin(2*np.pi*(0.19 + 0.05*j)*t + j)
        for det, pan in ((-0.11, -1), (0.0, 0), (0.11, 1)):
            w  = np.sin(2*np.pi*(f + det) * t * vib + j*1.7 + det*9)
            w += 0.22 * np.sin(2*np.pi*(f+det)*2*t*vib)
            w += 0.10 * np.sin(2*np.pi*(f+det)*3*t*vib)
            w += 0.04 * np.sin(2*np.pi*(f+det)*5*t*vib)
            v  = w * e * amp / (len(freqs) * 2.6)
            add(L, lp(v, bright) * (0.5 - 0.32*pan) * 2, t0)
            add(R, lp(v, bright) * (0.5 + 0.32*pan) * 2, t0)

def marimba(f, t0, amp=1.0, dec=9.0, pan=0.0):
    """the lead: wooden, fast decay, a hard 4th partial. One note per 8th."""
    n = idx(0.90); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t)
    w += 0.52 * np.sin(2*np.pi*f*4.02*t) * np.exp(-t*dec*2.6)     # the bar's 4th
    w += 0.20 * np.sin(2*np.pi*f*10.1*t) * np.exp(-t*dec*5.4)
    w += 0.09 * np.sin(2*np.pi*f*2.00*t) * np.exp(-t*dec*1.5)
    v  = w * env_ad(n, 0.0028, dec) * amp * 0.30
    v  = lp(v, 8200)
    add(L, v * (0.5 - 0.30*pan) * 2, t0)
    add(R, v * (0.5 + 0.30*pan) * 2, t0)

def pluck(f, t0, amp=1.0, pan=0.0, dec=7.0):
    """short nylon pluck for the counter-line under the tile wall"""
    n = idx(0.75); t = np.arange(n) / SR
    w  = np.sin(2*np.pi*f*t) + 0.34*np.sin(2*np.pi*f*2*t)*np.exp(-t*11) \
       + 0.15*np.sin(2*np.pi*f*3*t)*np.exp(-t*17)
    v  = w * env_ad(n, 0.0030, dec) * amp * 0.20
    v  = lp(v, 7200)
    add(L, v * (0.5 - 0.34*pan) * 2, t0)
    add(R, v * (0.5 + 0.34*pan) * 2, t0)

def stab(freqs, t0, amp=1.0):
    """the price cut: a hard block chord, gone inside half a beat"""
    n = idx(0.52); t = np.arange(n) / SR
    e = env_ad(n, 0.0034, 11.0)
    v = np.zeros(n)
    for k, f in enumerate(freqs):
        v += np.sin(2*np.pi*f*t + k*0.9) * (0.9 ** k)
        v += 0.26 * np.sin(2*np.pi*f*2*t) * np.exp(-t*22)
    v = lp(v / len(freqs), 6400) * e * amp * 0.40
    add(L, v*0.97, t0); add(R, v*1.03, t0)

def kick_at(t0, amp=1.0):
    """snappy: a short pitch drop with a click on top, not a long 808"""
    n = idx(0.30); t = np.arange(n) / SR
    f = 52 + 88 * np.exp(-t * 40)
    v = np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t*11.5) * amp * 0.50
    v = lp(v, 240)
    cl = bp(np.random.RandomState(3).randn(n), 1400, 3800) * np.exp(-t*105) * amp * 0.052
    a = int(0.0034 * SR); cl[:a] *= np.sin(np.linspace(0, np.pi/2, a)) ** 2
    add(L, v + cl, t0); add(R, v + cl, t0)

def rim(t0, amp=1.0, rs=None):
    """the offbeat tick — a rim shot, dry and tiny"""
    n = idx(0.07)
    rng = np.random.RandomState(rs if rs is not None else 1)
    e = np.exp(-np.arange(n)/SR*74)
    a = int(0.0030 * SR); e[:a] *= np.sin(np.linspace(0, np.pi/2, a)) ** 2
    v = bp(rng.randn(n), 1700, 5400) * e * amp * 0.25
    v += np.sin(2*np.pi*880*np.arange(n)/SR) * e * amp * 0.05
    add(L, v*0.90, t0); add(R, v*1.10, t0)

def hat(t0, amp=1.0, rs=None):
    """closed hat on the 8ths — this is what makes the grid feel mechanical"""
    n = idx(0.10)
    rng = np.random.RandomState(rs if rs is not None else 5)
    e = np.exp(-np.arange(n)/SR*56)
    a = int(0.0042 * SR); e[:a] *= np.sin(np.linspace(0, np.pi/2, a)) ** 2
    v = bp(rng.randn(n), 4900, 9000) * e * amp * 0.125
    add(L, v*1.06, t0); add(R, v*0.94, t0)

def tick(t0, amp=1.0, rs=7):
    """the UI tap: a wooden click, enveloped at both ends"""
    n = idx(0.045)
    rng = np.random.RandomState(rs)
    e = np.exp(-np.arange(n)/SR*118)
    a = int(0.0024 * SR); e[:a] *= np.sin(np.linspace(0, np.pi/2, a)) ** 2
    v = bp(rng.randn(n), 1400, 4000) * e * amp * 0.30
    v += np.sin(2*np.pi*1180*np.arange(n)/SR) * e * amp * 0.10
    add(L, v, t0); add(R, v, t0)

def swell(t0, dur=0.47, amp=1.0, rev=True):
    """reverse riser into a cut: a noise band rising, chopped at the hit"""
    n = idx(dur); t = np.arange(n)/SR
    rng = np.random.RandomState(int(t0*97) % 9973)
    e = (t/dur) ** (2.2 if rev else 0.5)
    r = int(0.004 * SR)
    e[-r:] *= np.cos(np.linspace(0, np.pi/2, r)) ** 2
    v = bp(rng.randn(n), 600, 3200) * e * amp * 0.115
    add(L, v*1.0, t0); add(R, v*0.90, t0)

def sub_drop(t0, amp=1.0):
    """the explode: one low body under the shatter, released not truncated"""
    n = idx(0.60); t = np.arange(n)/SR
    f = 150 * np.exp(-t * 5.2) + 44
    v = np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t*4.4) * amp * 0.34
    a = int(0.0016 * SR); v[:a] *= np.linspace(0, 1, a) ** 2
    v = lp(v, 300)
    add(L, v, t0); add(R, v, t0)

# ---------------------------------------------------------------- score
NOTE = {
 'F#2':92.50,'A2':110.00,'B2':123.47,'C#3':138.59,'D3':146.83,'E3':164.81,'F#3':185.00,
 'A3':220.00,'B3':246.94,'C#4':277.18,'D4':293.66,'E4':329.63,'F#4':369.99,'G#4':415.30,
 'A4':440.00,'B4':493.88,'C#5':554.37,'D5':587.33,'E5':659.25,'F#5':739.99,'A5':880.00,
 'B5':987.77,'C#6':1108.73,'D6':1174.66,'E6':1318.51,'F#6':1479.98,
}
n = NOTE.__getitem__

# one chord per bar: F#m D A E | F#m D E A  — it leaves the minor for the ask
CHORDS = [
    ('F#m', ['F#2','C#3','F#3','A3'],  1800),
    ('D',   ['D3','A3','D4','F#4'],    1900),
    ('A',   ['A2','E3','A3','C#4'],    2000),
    ('E',   ['E3','B3','E4','G#4'],    2000),
    ('F#m', ['F#2','C#3','F#3','A3'],  2100),
    ('D',   ['D3','A3','D4','F#4'],    2200),
    ('E',   ['E3','B3','E4','G#4'],    2300),
    ('A',   ['A2','E3','A3','C#4'],    2700),
]
BAR_AMP = [0.46, 0.56, 0.70, 0.72, 0.60, 0.64, 0.62, 0.86]
for i, (nm, notes, br) in enumerate(CHORDS):
    pad([n(x) for x in notes], i*BAR, (i+1)*BAR, BAR_AMP[i], br)

# ---- the lead: one marimba note per 8th, an F# minor / A major pentatonic run.
#      Bar 1 IS the tile arrivals; bars 3-4 thin out under the price stabs so the
#      block chords have room; bar 8 climbs and lands on A.
LINE = [
  ['F#4','A4','C#5','A4','F#5','C#5','A4','E5'],   # bar 1 — 12 tiles, one per 8th
  ['A4','C#5','E5','C#5','F#5','E5','C#5','A4'],   # bar 2 — ٥٤ + the four counts
  ['A4','E5','A5','E5','C#5','A4', None,'E5'],     # bar 3 — price, thinned
  [None,'B4','E5','B4', None,'G#4','B4','E5'],     # bar 4 — price, thinned
  ['F#5','C#5','A4','C#5','F#5','A5','F#5','C#5'], # bar 5 — in the app
  ['D5','A4','F#5','A4','D6','A5','F#5','D5'],     # bar 6 — in the app
  ['E5','B4','G#4','B4','E5','G#5' if False else 'B5','E5','B4'],  # bar 7 — explode
  ['A5','C#6','E6','C#6','A5','E5','A5','C#6'],    # bar 8 — the ask, resolved on A
]
LEAD_G = [0.92, 1.00, 0.62, 0.58, 0.88, 0.92, 0.78, 1.00]
for bi, bar in enumerate(LINE):
    for j, nm in enumerate(bar):
        if nm is None: continue
        t = bi*BAR + j*E8
        if t >= 15.0: break
        acc = 1.24 if j == 0 else (1.06 if j == 4 else (0.62 if j % 2 else 0.86))
        marimba(n(nm), t, LEAD_G[bi]*acc, dec=8.6 if j % 2 else 7.4,
                pan=(-0.30 if j % 2 else 0.30))

# ---- kick on 1 and 3 of every bar; the film's spine
for bi in range(8):
    for j in (0, 2):
        t = bi*BAR + j*BEAT
        gg = np.interp(t, [0.0, 1.875, 3.75, 7.5, 11.25, 13.125, 15.0],
                          [0.90, 1.00, 0.96, 1.00, 0.92, 1.00, 0.94])
        kick_at(t, gg)
# an extra kick on the & of 4 pushing into bars 5 and 8 — the two biggest cuts
kick_at(bt(15.5), 0.78); kick_at(bt(27.5), 0.86)

# ---- rim on every offbeat, hat on every 8th: the mechanical grid under it all
k = 0
t = BEAT / 2
while t < 14.72:
    gg = np.interp(t, [0.0, 0.47, 1.875, 7.5, 11.25, 13.125, 14.2, 14.72],
                      [0.30, 0.66, 0.90, 1.00, 0.86, 1.00, 0.86, 0.40])
    rim(t, gg, rs=k); k += 1
    t += BEAT
k = 0
t = 0.0
while t < 14.72:
    off = abs((t / E8) % 2 - 1) < 0.5           # louder on the beat, softer between
    gg = np.interp(t, [0.0, 0.94, 1.875, 7.5, 11.25, 13.125, 14.2, 14.72],
                      [0.34, 0.62, 0.82, 0.94, 0.80, 0.94, 0.78, 0.34])
    hat(t, gg * (0.62 if off else 1.0), rs=k); k += 1
    t += E8

# ---- accents locked to the picture -----------------------------------------
# bar 1 — twelve tiles, one per 8th, from t = -6 eighths (six land before frame 0)
for i in range(12):
    ts = (i - 6) * E8
    if ts < 0: continue
    pluck(n(['F#4','A4','C#5','E5','F#5','A5','E5','C#5','A4','F#4','C#5','E5'][i]),
          ts, 0.40 + 0.03*i, pan=-0.36 + 0.065*i)

# bar 2 — the ٥٤ slam (beat 4.5) and the four count-ticks on their own 8ths
stab([n('F#3'), n('A3'), n('C#4'), n('F#4')], bt(4.5), 0.92)
swell(max(0.0, bt(4.5) - 0.42), 0.42, 0.72)
for i in range(4):
    pluck(n(['C#5','E5','F#5','A5'][i]), bt(5 + i*0.5), 0.46, pan=0.36 - 0.24*i)

# bars 3-4 — three price blocks, one stab each, 3 eighths apart
for i, (bn, ch) in enumerate(((10,   ['D3','F#3','A3','D4']),
                              (11.5, ['A2','C#3','E3','A3']),
                              (13,   ['E3','G#3' if False else 'B3','E4','G#4']))):
    stab([n(x) for x in ch], bt(bn), 1.00 - 0.04*i)
    swell(max(0.0, bt(bn) - 0.30), 0.30, 0.60)
# the grid snaps back and collapses into one tile
stab([n('F#3'), n('C#4'), n('F#4'), n('A4')], bt(14.5), 0.86)
swell(bt(15.53), 0.47, 1.05)                       # riser into the device landing

# bars 5-6 — the app.  Two taps, each one 8th BEFORE its screen change.
stab([n('A2'), n('E3'), n('A3'), n('C#4')], bt(16), 1.05)
tick(bt(18.5), 1.00);  pluck(n('A5'), bt(19), 0.44, pan=0.28)
tick(bt(20.5), 1.00);  pluck(n('D6'), bt(21), 0.46, pan=-0.28)

# bar 7 — the explode: a reversed swell into the shatter, then the re-form
swell(max(0.0, bt(24) - 0.47), 0.47, 1.20)
sub_drop(bt(24), 1.00)
stab([n('D3'), n('A3'), n('D4'), n('F#4')], bt(24), 0.80)
for i in range(6):                                  # the deck re-forming
    pluck(n(['A4','C#5','E5','F#5','A5','C#5'][i]), bt(25.5 + i*0.25), 0.34 + 0.02*i,
          pan=-0.34 + 0.135*i)
marimba(n('E5'), bt(26), 1.05, dec=7.0)             # the app icon lands

# bar 8 — the ask, resolved on A
swell(max(0.0, bt(28) - 0.47), 0.47, 1.15)
stab([n('A2'), n('E3'), n('A3'), n('C#4'), n('E4')], bt(28), 1.15)
pluck(n('C#6'), bt(28.5), 0.46, pan=-0.24)          # the orange rule draws
tick(bt(29), 0.72); tick(bt(29.5), 0.72)            # the two store badges
pluck(n('A5'), bt(30), 0.44, pan=0.26)              # the handle line
pad([n('A2'), n('E3'), n('A3'), n('C#4'), n('E4')], bt(28), 15.35, 0.50, 3200)
marimba(n('A5'), bt(31), 0.72, dec=5.6, pan=-0.20)  # the last word, then stillness
marimba(n('E6'), bt(31), 0.44, dec=5.0, pan=0.24)

# ---------------------------------------------------------------- space
def reverb(x):
    """a ROOM, not a hall — short taps and a low wet mix, so the 8ths stay separate"""
    wet  = comb(x, 0.0131, 0.62, taps=14) + comb(x, 0.0179, 0.58, taps=14)
    wet += comb(x, 0.0223, 0.54, taps=12) + comb(x, 0.0271, 0.50, taps=12)
    return lp(wet, 5200) * 0.16

L = L + reverb(L) * 0.52
R = R + reverb(R) * 0.60

# ---------------------------------------------------------------- master
for buf in (L, R):
    buf *= np.interp(T, [0.0, 0.22, 15.05, 15.30, DUR], [0.0, 1.0, 1.0, 0.30, 0.0])

L = hp(L, 42);  R = hp(R, 42)
L = shelf_hi(L, 2600, 1.02); R = shelf_hi(R, 2600, 1.02)
L = lp2(L, 15000); R = lp2(R, 15000)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.97, R / peak * 0.97
L, R = np.tanh(L * 1.46) * 0.86, np.tanh(R * 1.46) * 0.86

st = np.empty(N * 2)
st[0::2], st[1::2] = L, R
pcm = np.clip(st, -1, 1)
with wave.open('bed.wav', 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((pcm * 32767).astype('<i2').tobytes())

rms = np.sqrt(np.mean(np.concatenate([L, R])**2))
print(f"bed.wav  {DUR}s  peak={max(abs(L).max(),abs(R).max()):.3f}  "
      f"rms={rms:.4f}  ({20*np.log10(rms):.1f} dBFS)")
