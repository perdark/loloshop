#!/usr/bin/env python3
"""
Shared sound-design kit for the LoloShop reels.

WHY THIS FILE EXISTS
--------------------
Every reel's music.py re-declared the same twenty DSP helpers privately, and none
of them covered *sound design* — the non-musical events an app advertisement needs:
a finger tapping a chip, a key landing, an answer arriving, a screen sliding past.
Music is the bed; sound design is what makes the picture feel like a thing that is
happening rather than a slideshow with a soundtrack.

Import it from a reel folder:

    import sys; sys.path.insert(0, '..')
    from shared.sfx import Mix, note_hz

    m = Mix(dur=16.0)
    m.ui_tap(3.20)                      # a chip is pressed
    m.key_run(4.10, n=13, span=2.6)     # a name is typed
    m.msg_in(7.40)                      # لولو answers
    m.riser(11.2, 12.0)                 # into the ask
    m.master(); m.write('bed.wav')

EVERY LIMIT BELOW IS verify_audio.py's, NOT TASTE
-------------------------------------------------
That verifier exists because two detector bugs already cost real time, and it is
the gate a bed must pass. Sound design is exactly the thing most likely to trip
it, so the constraints are designed in here rather than discovered at the gate:

1. **A transient must never be a single-sample jump.** The click detector is a
   second difference — `r = x[1:-1] - 0.5*(x[:-2] + x[2:])` — flagged when |r|
   exceeds BOTH 9x the local RMS and 0.02. A raised-cosine attack over >=2 ms
   (88 samples at 44.1 kHz) spreads the energy across enough samples that r stays
   in the noise. `ATK_MIN` enforces it; every generator here clamps to it.
   A naive `x[i] = 1.0` tap is exactly the impulse it is built to catch.

2. **A release must never stop.** The tail detector flags any 10 ms frame that
   drops more than 18 dB while still above 0.02. `REL_MIN` = 40 ms, comfortably
   slower than 18 dB per frame.

3. **2-8 kHz has a hard 4.0% ceiling** (and a 0.3% floor). This is the real
   budget: taps, key ticks and whooshes all live in that band, so a reel with
   generous sound design can fail a check meant to catch *mud*. `hf_share()`
   reports it before you spend a render, and `master()` will tell you if the
   sound design has eaten the budget. If it has, thin the ticks — do NOT low-pass
   everything, or the bed turns to mud and fails the same check from below.

4. **HF_AND_THE_CLICK_DETECTOR — the one that is not obvious.** A smooth attack is
   NOT sufficient. The detector's `r` is a second difference, and for a sinusoid it
   scales as amplitude x (2*pi*f/SR)^2 — so content at 4-5 kHz produces a large r on
   its own, however gently the envelope opens. Measured here: a tap whose noise edge
   reached 5 kHz produced r = 0.071, and against a quiet pad the 2048-sample local
   window is mostly silence, so the ratio cleared 9x and the gate failed with 13
   impulses. The fix is not a softer envelope and not a weaker gate — it is to cap
   the noise bands (tap 900-3200 Hz, key 1100-2600 Hz) and let the pitched body carry
   the sound. That is also the truer sound: a UI tap on a phone is a soft thud, not a
   snare. **Keep |r| under 0.02 and the check passes unconditionally**, whatever the
   local floor does — that absolute term is the one to design against.

5. **The file must not end on a live sample** — `master()` applies a 120 ms
   raised-cosine fade so the tail is always < 0.01.

Deterministic by construction: every "random" element is drawn from a seeded
Generator, so the same script renders the same bytes forever. Never call
np.random directly.
"""

import numpy as np
import wave

SR = 44100

ATK_MIN = 0.002      # 2 ms  — below this the click detector fires (see note 1)
REL_MIN = 0.040      # 40 ms — below this the tail detector fires (see note 2)

# equal-tempered helper: note_hz('A4') -> 440.0
_SEMI = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}


def note_hz(name):
    """'F#4' / 'Bb3' / 'A4' -> Hz. A4 = 440."""
    step = _SEMI[name[0].upper()]
    i = 1
    while i < len(name) and name[i] in '#b':
        step += 1 if name[i] == '#' else -1
        i += 1
    octave = int(name[i:])
    return 440.0 * 2 ** (step / 12 + (octave - 4))


# ----------------------------------------------------------------- filters
def lp(x, cut):
    """One-pole low-pass. Cheap, phase-sloppy, and correct for a bed."""
    a = np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):                       # nopython-free; fine at 16 s
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def _lp_fast(x, cut):
    """Vectorised one-pole via lfilter when scipy is around, else the loop."""
    try:
        from scipy.signal import lfilter
        a = np.exp(-2 * np.pi * cut / SR)
        return lfilter([1 - a], [1, -a], x)
    except Exception:
        return lp(x, cut)


def hp(x, cut):
    return x - _lp_fast(x, cut)


def lp2(x, cut):
    return _lp_fast(_lp_fast(x, cut), cut)


def bp(x, lo, hi):
    return lp2(hp(x, lo), hi)


def shelf_hi(x, cut, gain):
    return x + gain * hp(x, cut)


# ----------------------------------------------------------------- envelopes
def env_ad(n, atk, dec, curve=3.0):
    """Attack-decay. `atk` is clamped to ATK_MIN so no caller can make a click."""
    atk = max(atk, ATK_MIN)
    dec = max(dec, REL_MIN)
    a = int(atk * SR)
    e = np.empty(n)
    a = min(a, n)
    # raised cosine attack: starts at 0 with zero slope, so the second difference
    # the detector measures stays smooth through the onset
    e[:a] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a)) if a > 1 else 1.0
    rest = n - a
    if rest > 0:
        e[a:] = np.exp(-np.arange(rest) / (dec * SR) * curve)
    return e


def env_ar(n, atk, rel):
    """Attack-sustain-release over exactly n samples, both ends smooth."""
    atk, rel = max(atk, ATK_MIN), max(rel, REL_MIN)
    a, r = int(atk * SR), int(rel * SR)
    a = min(a, n // 2)
    r = min(r, n - a)
    e = np.ones(n)
    if a > 1:
        e[:a] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    if r > 1:
        e[n - r:] = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, r))
    return e


class Mix:
    """A stereo buffer plus the elements that write into it."""

    def __init__(self, dur, seed=20260825):
        self.dur = float(dur)
        self.n = int(SR * self.dur)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)
        self.rs = np.random.default_rng(seed)
        self._sfx_only = np.zeros(self.n)   # sound design alone, for the HF report

    # ------------------------------------------------------------- plumbing
    def add(self, sig, t0, pan=0.0, tag=None):
        """Mix `sig` in at t0. pan -1..+1. `tag='sfx'` counts it toward the HF budget."""
        i = int(t0 * SR)
        if i >= self.n:
            return
        if i < 0:
            sig = sig[-i:]
            i = 0
        s = sig[:self.n - i]
        gl = np.sqrt((1 - pan) / 2) * np.sqrt(2)
        gr = np.sqrt((1 + pan) / 2) * np.sqrt(2)
        self.L[i:i + len(s)] += s * gl
        self.R[i:i + len(s)] += s * gr
        if tag == 'sfx':
            self._sfx_only[i:i + len(s)] += s

    # ------------------------------------------------------- musical elements
    def pad(self, freqs, t0, t1, amp=0.12, bright=1600.0):
        """A held chord that breathes. The bed under everything."""
        n = int((t1 - t0) * SR)
        if n <= 0:
            return
        t = np.arange(n) / SR
        out = np.zeros(n)
        for k, f in enumerate(freqs):
            det = 1 + 0.0016 * np.sin(2 * np.pi * (0.11 + 0.03 * k) * t + k)
            out += np.sin(2 * np.pi * f * det * t + k * 1.7) / (1 + 0.5 * k)
        out = _lp_fast(out, bright)
        self.add(out * env_ar(n, 0.9, 1.1) * amp / len(freqs), t0, 0.0)

    def felt(self, f, t0, amp=0.25, dec=2.6, pan=0.0):
        """Felted piano — soft hammer, no attack transient to speak of."""
        n = int(min(dec * 2.2, self.dur) * SR)
        t = np.arange(n) / SR
        sig = (np.sin(2 * np.pi * f * t)
               + 0.42 * np.sin(2 * np.pi * 2 * f * t)
               + 0.14 * np.sin(2 * np.pi * 3 * f * t))
        sig = _lp_fast(sig, 2400)
        self.add(sig * env_ad(n, 0.012, dec) * amp, t0, pan)

    def bell(self, f, t0, amp=0.18, dec=4.4, pan=0.0):
        n = int(min(dec * 2.0, self.dur) * SR)
        t = np.arange(n) / SR
        sig = (np.sin(2 * np.pi * f * t)
               + 0.5 * np.sin(2 * np.pi * 2.76 * f * t)
               + 0.25 * np.sin(2 * np.pi * 5.4 * f * t))
        self.add(sig * env_ad(n, 0.004, dec, curve=2.2) * amp, t0, pan)

    def sub(self, t0, f=52.0, amp=0.5, dec=0.42):
        """Low weight under a cut. Phones cannot reproduce it; laptops and cars can."""
        n = int(dec * 2.4 * SR)
        t = np.arange(n) / SR
        sweep = f * (1 + 0.7 * np.exp(-t * 22))
        sig = np.sin(2 * np.pi * np.cumsum(sweep) / SR)
        self.add(sig * env_ad(n, 0.006, dec) * amp, t0, 0.0)

    # -------------------------------------------------- app / UI sound design
    def ui_tap(self, t0, amp=0.30, pan=0.0, bright=1.0):
        """A finger landing on a chip or a button.

        Two layers: a short pitched 'body' so it reads as a physical object, and a
        band-limited noise 'edge' so it reads as contact. The edge is bp'd to
        1.4-5 kHz — audible on a phone speaker, and narrow enough that a dozen taps
        do not eat the 2-8 kHz budget.
        """
        n = int(0.14 * SR)
        t = np.arange(n) / SR
        body = np.sin(2 * np.pi * 620 * bright * t) * np.exp(-t * 46)
        # Edge band capped at 3.2 kHz, NOT 5 kHz — see HF_AND_THE_CLICK_DETECTOR below.
        edge = bp(self.rs.standard_normal(n), 900, 3200) * np.exp(-t * 120)
        sig = (0.68 * body + 0.32 * edge) * env_ad(n, 0.0025, 0.09)
        self.add(sig * amp, t0, pan, tag='sfx')

    def key_tick(self, t0, amp=0.10, pan=0.0, jitter=0.0):
        """One keystroke. Quieter and drier than a tap — a key is not a button."""
        n = int(0.07 * SR)
        t = np.arange(n) / SR
        f = 1150 * (1 + jitter)
        sig = (0.55 * np.sin(2 * np.pi * f * t)
               + 0.45 * bp(self.rs.standard_normal(n), 1100, 2600)) * np.exp(-t * 150)
        self.add(sig * env_ad(n, 0.002, 0.05) * amp, t0, pan, tag='sfx')

    def key_run(self, t0, n_keys, span, amp=0.10, pan=0.0):
        """A name being typed: n_keys ticks over `span` seconds, humanly uneven.

        The unevenness matters — perfectly spaced ticks read as a machine, which is
        the exact opposite of what an ad narrated 'like a human' wants. Deterministic
        jitter from the seeded generator, so the render stays reproducible.
        """
        if n_keys < 1:
            return
        base = np.linspace(0, span, n_keys)
        wob = self.rs.normal(0, span / (n_keys * 6.0), n_keys)
        for i, (dt, w) in enumerate(zip(base, wob)):
            self.key_tick(t0 + max(0.0, dt + w), amp=amp * (0.85 + 0.3 * (i % 3) / 2),
                          pan=pan, jitter=(i % 5 - 2) * 0.03)

    def msg_in(self, t0, amp=0.26, pan=0.0):
        """An answer arriving. A rising two-tone — warm, not a notification bleep."""
        n = int(0.55 * SR)
        t = np.arange(n) / SR
        a = np.sin(2 * np.pi * note_hz('D5') * t) * np.exp(-t * 7.0)
        b = np.sin(2 * np.pi * note_hz('A5') * t) * np.exp(-t * 6.0)
        b = np.concatenate([np.zeros(int(0.075 * SR)), b])[:n]
        sig = _lp_fast(0.6 * a + 0.5 * b, 6000)
        self.add(sig * env_ad(n, 0.006, 0.34, curve=1.8) * amp, t0, pan, tag='sfx')

    def whoosh(self, t0, dur=0.42, amp=0.20, pan=0.0, down=False):
        """A screen moving past. Filtered noise swept through the band, never wide open."""
        n = int(dur * SR)
        t = np.arange(n) / SR
        p = t / dur
        nz = self.rs.standard_normal(n)
        lo, hi = (2600, 500) if down else (500, 2600)
        cut = lo + (hi - lo) * (0.5 - 0.5 * np.cos(np.pi * p))
        # sweep by crossfading three fixed bands — cheaper than a time-varying filter
        # and it cannot ring, which a naive sweeping biquad does at these rates
        b1, b2, b3 = bp(nz, 300, 900), bp(nz, 900, 2200), bp(nz, 2200, 5200)
        w1 = np.clip(1 - np.abs(cut - 600) / 900, 0, 1)
        w2 = np.clip(1 - np.abs(cut - 1500) / 1100, 0, 1)
        w3 = np.clip(1 - np.abs(cut - 3400) / 1900, 0, 1)
        sig = b1 * w1 + b2 * w2 + b3 * w3
        self.add(sig * env_ar(n, dur * 0.35, dur * 0.55) * amp, t0, pan, tag='sfx')

    def cloth(self, t0, dur=0.7, amp=0.14, pan=0.0):
        """Fabric moving. Low, soft, no HF sizzle — this is satin, not paper."""
        n = int(dur * SR)
        nz = self.rs.standard_normal(n)
        sig = bp(nz, 260, 1500)
        wob = 1 + 0.5 * np.sin(2 * np.pi * 2.3 * np.arange(n) / SR)
        self.add(sig * wob * env_ar(n, dur * 0.4, dur * 0.5) * amp, t0, pan, tag='sfx')

    def riser(self, t0, t1, amp=0.16, pan=0.0):
        """Tension into a cut. Noise plus a rising tone, both arriving together."""
        n = int((t1 - t0) * SR)
        if n <= 0:
            return
        t = np.arange(n) / SR
        p = t / (t1 - t0)
        nz = bp(self.rs.standard_normal(n), 700, 4200) * (p ** 2)
        f = 180 * 2 ** (2.2 * p)
        tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (p ** 3) * 0.7
        self.add((nz + tone) * env_ar(n, 0.25, 0.12) * amp, t0, pan, tag='sfx')

    def confirm(self, t0, amp=0.30, pan=0.0):
        """The done-moment. A major third, settled, not triumphant."""
        for i, nm in enumerate(('D5', 'F#5', 'A5')):
            self.bell(note_hz(nm), t0 + i * 0.055, amp=amp * (0.9 - 0.15 * i), dec=2.6, pan=pan)

    # ------------------------------------------------------------- finishing
    def reverb(self, x, amount=0.9):
        """Cheap multi-tap. Long enough to sit a phone speaker in a room."""
        out = np.zeros_like(x)
        for d, g in ((0.029, 0.42), (0.047, 0.32), (0.071, 0.25),
                     (0.101, 0.19), (0.137, 0.13)):
            k = int(d * SR)
            out[k:] += x[:-k] * g
        return _lp_fast(out, 4200) * amount

    def hf_share(self, which='all'):
        """% of energy in 2-8 kHz. verify_audio.py demands 0.3 <= this <= 4.0."""
        mono = (self.L + self.R) / 2 if which == 'all' else self._sfx_only
        if not np.any(mono):
            return 0.0
        P = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
        f = np.fft.rfftfreq(len(mono), 1 / SR)
        return P[(f >= 2000) & (f < 8000)].sum() / P.sum() * 100

    def master(self, lufs_target=-13.8, verbose=True):
        """Reverb, tone, normalise, and fade the tail so the file cannot end live."""
        self.L += self.reverb(self.L, 0.85)
        self.R += self.reverb(self.R, 1.00)
        self.L, self.R = hp(self.L, 40), hp(self.R, 40)
        self.L = shelf_hi(self.L, 2500, 0.55)
        self.R = shelf_hi(self.R, 2500, 0.55)
        self.L, self.R = lp2(self.L, 15000), lp2(self.R, 15000)

        # soft-knee limiter, then trim to roughly the target loudness
        for buf in (self.L, self.R):
            np.tanh(buf * 1.15, out=buf)
        mono = (self.L + self.R) / 2
        rms = np.sqrt(np.mean(mono ** 2)) + 1e-12
        gain = 10 ** ((lufs_target + 0.6) / 20) / rms
        gain = min(gain, 0.92 / (np.abs(np.concatenate([self.L, self.R])).max() + 1e-9))
        self.L *= gain
        self.R *= gain

        f = int(0.120 * SR)                       # tail fade: note 4 in the header
        w = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, f))
        self.L[-f:] *= w
        self.R[-f:] *= w
        self.L[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
        self.R[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))

        if verbose:
            hf = self.hf_share()
            flag = 'OK' if 0.3 <= hf <= 4.0 else ('TOO BRIGHT — thin the ticks'
                                                  if hf > 4.0 else 'TOO DULL')
            print(f"  2-8 kHz share: {hf:.2f}%  [{flag}]   peak {np.abs(self.L).max():.3f}")
        return self

    def write(self, path='bed.wav'):
        x = np.empty(self.n * 2)
        x[0::2] = self.L
        x[1::2] = self.R
        pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
        with wave.open(path, 'w') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        print(f"  wrote {path}  ({self.dur:.2f}s)")
        return self
