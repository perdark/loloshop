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
const MIN_EM = 1.6;
/** Full size once the footer is fully in view. */
const MAX_EM = 6.5;
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
      word.style.setProperty("--sig-scale", String(MIN_EM + (MAX_EM - MIN_EM) * eased));
      word.style.setProperty("--sig-opacity", String(0.35 + 0.65 * eased));
    };

    const onScroll = () => {
      if (frame) return; // already queued — never more than one write per frame
      frame = requestAnimationFrame(apply);
    };

    // Only listen while the footer is actually near the viewport.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !attached) {
          window.addEventListener("scroll", onScroll, { passive: true });
          window.addEventListener("resize", onScroll, { passive: true });
          attached = true;
          apply();
        } else if (!entry.isIntersecting && attached) {
          window.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onScroll);
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
        window.removeEventListener("resize", onScroll);
      }
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      /* Fixed height so the growing word never reflows the footer around it —
         it scales inside a reserved box, which is also why `transform` is safe. */
      className="mt-6 flex h-[132px] items-center justify-center overflow-hidden"
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
