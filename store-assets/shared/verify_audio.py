#!/usr/bin/env python3
"""Measure bed.wav instead of trusting a laptop speaker.
Targets that a shippable bed has to hold:
  peak < 1.0 · 0 click discontinuities · 2-8 kHz ~1% of total energy · ~-14 LUFS
"""
import wave, numpy as np, subprocess, json, re, sys

with wave.open('bed.wav') as w:
    sr, n = w.getframerate(), w.getnframes()
    x = np.frombuffer(w.readframes(n), '<i2').astype(np.float64) / 32768.0
L, R = x[0::2], x[1::2]
mono = (L + R) / 2
ok = True

peak = np.abs(x).max()
print(f"peak                 {peak:.4f}          {'PASS' if peak < 1.0 else 'FAIL'}")
ok &= peak < 1.0

# A click is NOT "a big sample-to-sample step" — at 44.1 kHz a clean 8 kHz tone at
# 0.7 already steps by ~0.74 per sample, so a flat threshold flags the whole bed.
# A click is an IMPULSE: one sample that departs from the linear interpolation of its
# neighbours by far more than the local signal statistics allow.
r = mono[1:-1] - 0.5 * (mono[:-2] + mono[2:])
win = 2048
pad = np.pad(r ** 2, (win // 2, win // 2), mode='edge')
sig = np.sqrt(np.convolve(pad, np.ones(win) / win, mode='valid')[:len(r)])
impulses = int(((np.abs(r) > 9 * sig) & (np.abs(r) > 0.02)).sum())
print(f"impulse clicks       {impulses}              {'PASS' if impulses == 0 else 'FAIL'}")
ok &= impulses == 0

# ...and the other failure mode: an envelope that STOPS instead of releasing (a
# hard-truncated tail is the click you hear but cannot see). Frames must be long
# enough to resolve the lowest note in the bed — at 10 ms a 100 Hz pad is one full
# cycle; at 1 ms the RMS is pure phase noise and every measurement is meaningless.
fr = 441
e = np.sqrt(np.mean(mono[:len(mono)//fr*fr].reshape(-1, fr) ** 2, axis=1)) + 1e-9
drop = 20 * np.log10(e[1:] / e[:-1])
cuts = int(((drop < -18) & (e[:-1] > 0.02)).sum())
print(f"truncated tails      {cuts} (<-18 dB/10ms)  {'PASS' if cuts == 0 else 'FAIL'}")
ok &= cuts == 0

# and the file itself must not end on a live sample
tail = np.abs(mono[-441:]).max()
print(f"tail at end of file  {tail:.5f}         {'PASS' if tail < 0.01 else 'FAIL'}")
ok &= tail < 0.01

# spectral balance: too little 2-8 kHz and the bed reads as mud on a phone speaker
F = np.fft.rfft(mono * np.hanning(len(mono)))
P = np.abs(F) ** 2
f = np.fft.rfftfreq(len(mono), 1 / sr)
band = P[(f >= 2000) & (f < 8000)].sum() / P.sum() * 100
print(f"2-8 kHz energy       {band:.3f}%       {'PASS' if 0.3 <= band <= 4.0 else 'FAIL'}")
ok &= 0.3 <= band <= 4.0

dc = mono.mean()
print(f"dc offset            {dc:+.6f}      {'PASS' if abs(dc) < 1e-3 else 'FAIL'}")
ok &= abs(dc) < 1e-3

# integrated loudness, measured by ffmpeg's EBU R128 meter
out = subprocess.run(['ffmpeg', '-hide_banner', '-i', 'bed.wav', '-af',
                      'loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json',
                      '-f', 'null', '-'], capture_output=True, text=True).stderr
m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', out, re.S)
if m:
    j = json.loads(m.group(0))
    lufs, tp, lra = float(j['input_i']), float(j['input_tp']), float(j['input_lra'])
    print(f"integrated loudness  {lufs:.1f} LUFS    {'PASS' if -17 <= lufs <= -11 else 'FAIL'}")
    print(f"true peak            {tp:.1f} dBTP     {'PASS' if tp <= -0.3 else 'FAIL'}")
    print(f"loudness range       {lra:.1f} LU")
    ok &= -17 <= lufs <= -11 and tp <= -0.3
else:
    print("integrated loudness  -- ffmpeg loudnorm gave no json --   FAIL"); ok = False

print('\nALL PASS' if ok else '\nFAILED')
sys.exit(0 if ok else 1)
