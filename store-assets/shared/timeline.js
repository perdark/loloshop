/* ============================================================================
   Shared deterministic timeline engine.
   Every frame is a pure function of t, so renders are byte-reproducible and the
   renderer can seek to any time. NEVER call Math.random() or Date.now() in a
   composition — the grain jitter below is derived from the frame index instead.
   ========================================================================== */
const $  = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);

/* easing */
const eLin   = p => p;
const eOut   = p => 1 - Math.pow(1 - p, 3);
const eOut5  = p => 1 - Math.pow(1 - p, 5);
const eIn    = p => p * p * p;
const eInOut = p => p < .5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2;
const eBack  = p => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3*Math.pow(p-1,3) + c1*Math.pow(p-1,2); };
/* eSoft is the cinematic one: no overshoot, long tail — use it when a move must
   feel expensive rather than bouncy. */
const eSoft  = p => 1 - Math.pow(1 - p, 4.2);

/** tween a value from a to b between t0 and t1 */
function tw(t, t0, t1, a, b, ez) { ez = ez || eOut; if (t1 <= t0) return b;
  return a + (b - a) * ez(clamp((t - t0) / (t1 - t0), 0, 1)); }
/** fade in over [i0,i1] then out over [o0,o1] */
function vis(t, i0, i1, o0, o1) { return Math.min(tw(t, i0, i1, 0, 1, eOut), tw(t, o0, o1, 1, 0, eIn)); }
/** one impulse: 0 -> 1 -> 0 around `at` */
function hit(t, at, up, down) { return Math.min(tw(t, at, at+up, 0, 1, eOut), tw(t, at+up, at+up+down, 1, 0, eOut)); }
/** ping-pong drift so nothing in frame is ever perfectly still */
const drift = (t, hz, amp, phase) => Math.sin(t * hz * 6.2831853 + (phase || 0)) * amp;

/** Arabic-Indic numerals with the U+066C thousands mark, matching the app itself */
const AR_D = '٠١٢٣٤٥٦٧٨٩';
const arNum = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '٬').replace(/[0-9]/g, d => AR_D[+d]);

/** Piecewise-linear time remap: animate freehand against SC_A, ship on SC_B.
 *  SC_B is the BEAT GRID — cutting off the beat is the loudest amateur tell there
 *  is, and this lets the grid be applied without re-timing a single keyframe.
 *  music.py carries the mirror image of this as g(); change one, change both. */
function makeGrid(SC_A, SC_B) {
  return function (x) {
    for (let i = 0; i < SC_B.length - 1; i++)
      if (x <= SC_B[i+1]) return SC_A[i] + (x - SC_B[i]) * (SC_A[i+1] - SC_A[i]) / (SC_B[i+1] - SC_B[i]);
    return SC_A[SC_A.length - 1];
  };
}

/** grain jitter from the real frame index — deterministic, no RNG */
function grainAt(el, frameIndex) {
  el.style.transform = `translate(${(frameIndex*37)%97-48}px,${(frameIndex*61)%89-44}px)`;
}

/** register the composition with render.mjs */
function publish(seek, meta) {
  window.__seek = seek;
  window.__meta = Object.assign({ w: 1080, h: 1920, fps: 30 }, meta);
  seek(0);
  document.fonts.ready.then(() => { window.__ready = true; });
}
