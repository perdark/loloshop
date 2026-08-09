"use client";

import { useEffect, useRef } from "react";

/**
 * «© RevoArt» — the studio credit, which grows as the footer is scrolled into view.
 *
 * Owner ask (2026-08-04): «at footer i want when scroll to footer the RevoArt be
 * bigger and bigger while scrolling like from 2em to 8em».
 *
 * ── HOW THE SCALE IS DRIVEN ──────────────────────────────────────────────────
 * Progress is measured from where the element sits in the viewport: 0 when its top
 * is still at the bottom edge of the screen, 1 once it has travelled up past ~65%
 * of the viewport height. That mapping means the word finishes growing while it is
 * still comfortably on screen, instead of only reaching full size at the very last
 * pixel of the page — which on a tall phone would mean the payoff never arrives.
 *
 * ── WHY NOT `animation-timeline: view()` ─────────────────────────────────────
 * That is the modern, JS-free way to do exactly this, and it is what I would use on
 * the open web. It is unusable here: these pages run inside **Capacitor WebViews**,
 * and scroll-driven animations need Chrome/WebView 115+. The app-only gate work
 * already established that this app must support **WebView 105+** (below that,
 * Capacitor's own bridge injection changes) — so a 115+ feature would silently do
 * nothing on exactly the low-end Android phones most students carry.
 *
 * ── WHY IT IS CHEAP ──────────────────────────────────────────────────────────
 * Only `transform` is animated (compositor-only, never triggers layout or paint),
 * writes are batched into one rAF per frame, the scroll listener is `passive`, and
 * an IntersectionObserver detaches the listener entirely whenever the footer is off
 * screen — so scrolling the rest of the storefront costs nothing at all.
 *
 * Honours `prefers-reduced-motion`: the word is simply rendered at its resting size
 * with no listener attached.
 */

/** Resting size, in `em` relative to the paragraph — the size before any scroll. */
const MIN_EM = 0.7;
/**
 * Ceiling for the grown size. ⚠️ NOT the size actually used — see `fitEm()`.
 *
 * ── THIS IS A CREDIT LINE, NOT A HERO (owner, 2026-08-06: «make revoart text at
 * footer small», then «make revoart smaller more»). Fourth pass on this one
 * element, and the direction has only ever gone one way: 6.5em → «needs to be
 * smaller, the words are out of screen» (2026-08-05) → «small» → «smaller more».
 * It is now BELOW the legal links it sits beside — ~11px at rest, growing to
 * ~18px — which is what a studio credit should be: findable, never competing.
 *
 * The scroll-grow itself is KEPT, deliberately. It was an explicit owner ask on
 * 2026-08-04 («when scroll to footer the RevoArt be bigger and bigger while
 * scrolling») and «small» is a note about SIZE, not about deleting the effect.
 * Shrinking the range satisfies the note; removing the mechanism would throw away
 * a different request that was never withdrawn. Easy to revisit either way — the
 * whole behaviour is these three constants.
 *
 * Still a ceiling and not the size actually used: the real maximum is MEASURED
 * from the container at runtime (see `fitEm()`), because a number that fits a
 * 320px phone wastes most of a desktop footer. At this range the measured fit
 * will essentially never bind, which is the point — it can no longer clip.
 */
const MAX_EM = 1.15;
/** Never grow past this fraction of the available width — leaves a breathing margin. */
const WIDTH_BUDGET = 0.9;
/** Fraction of viewport height the element travels through to go 0 → 1. */
const TRAVEL = 0.65;

export function FooterSignature() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const wordRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const word = wordRef.current;
    if (!wrap || !word) return;

    // Static at the resting size for anyone who asked for less motion.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let attached = false;
    let maxEm = MAX_EM;

    /**
     * The largest `em` size at which «© RevoArt» still FITS the footer column.
     *
     * Measured, not guessed: the string is rendered at a known size, its real
     * laid-out width is read once, and that gives a width-per-em for this exact
     * font, weight and letter-spacing. Any hard-coded number would be wrong the
     * moment the font loads differently, the copy changes, or the phone is 320 px
     * instead of 430 px.
     *
     * Runs inside the same rAF as the first paint, and only on mount/resize — the
     * scroll path never measures, so this costs nothing while scrolling.
     */
    const fitEm = () => {
      const avail = wrap.clientWidth * WIDTH_BUDGET;
      if (!avail) return MAX_EM;
      const probe = 4; // any size works; 4em is large enough to measure accurately
      const prev = word.style.fontSize;
      word.style.fontSize = `${probe}em`;
      const widthPerEm = word.scrollWidth / probe;
      word.style.fontSize = prev;
      if (!widthPerEm) return MAX_EM;
      // Never below MIN_EM: on an absurdly narrow screen a clipped word still beats
      // one that shrinks below its resting size and reads as broken.
      return Math.max(MIN_EM, Math.min(MAX_EM, avail / widthPerEm));
    };

    const apply = () => {
      frame = 0;
      const rect = wrap.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 while still below the fold → 1 once it has risen through TRAVEL of the screen.
      const raw = (vh - rect.top) / (vh * TRAVEL);
      const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      // easeOutCubic — most of the growth happens early, so it reads as the word
      // arriving rather than snapping at the end.
      const eased = 1 - Math.pow(1 - p, 3);
      word.style.setProperty("--sig-scale", String(MIN_EM + (maxEm - MIN_EM) * eased));
      word.style.setProperty("--sig-opacity", String(0.35 + 0.65 * eased));
    };

    const remeasure = () => {
      maxEm = fitEm();
      apply();
    };

    const onScroll = () => {
      if (frame) return; // already queued — never more than one write per frame
      frame = requestAnimationFrame(apply);
    };

    // Rotating the phone or opening the keyboard changes the column width, so the
    // fitted maximum has to be recomputed — not just re-applied.
    const onResize = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(remeasure);
    };

    // Only listen while the footer is actually near the viewport.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !attached) {
          window.addEventListener("scroll", onScroll, { passive: true });
          window.addEventListener("resize", onResize, { passive: true });
          attached = true;
          remeasure();
        } else if (!entry.isIntersecting && attached) {
          window.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onResize);
          attached = false;
        }
      },
      { rootMargin: "120px 0px" }
    );
    io.observe(wrap);

    return () => {
      io.disconnect();
      if (attached) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
      }
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      /* Fixed height so the growing word never reflows the footer around it —
         it scales inside a reserved box, which is also why `transform` is safe.
         The box shrinks with the word: 132px was reserved for a 6.5em headline, and
         leaving it there under an ~18px credit would hold ~110px of blank footer
         open for nothing — which reads as a broken image, not as breathing room. */
      className="mt-5 flex h-[34px] items-center justify-center overflow-hidden"
    >
      <span
        ref={wordRef}
        aria-label="© RevoArt"
        className="select-none whitespace-nowrap font-display font-bold leading-none text-ink-soft will-change-transform"
        style={{
          // Consumed by the effect above; the inline defaults are what a
          // no-JS / reduced-motion visitor sees.
          fontSize: `calc(var(--sig-scale, ${MIN_EM}) * 1em)`,
          opacity: "var(--sig-opacity, 0.35)",
          transition: "opacity 200ms linear",
        }}
      >
        © RevoArt
      </span>
    </div>
  );
}
