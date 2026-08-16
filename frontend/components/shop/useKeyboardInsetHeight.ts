"use client";

/**
 * Where a full-screen chat must actually sit, with the iOS keyboard open.
 *
 * ── WHY `100dvh` IS NOT ENOUGH ───────────────────────────────────────────────────────────
 * Owner report (2026-08-16, iPhone): «it zooms in and keyboard broke the view», then after
 * the first attempt: «keyboard make the chat disappear up or make it zoom down».
 *
 * On iOS Safari the software keyboard does NOT shrink the layout viewport. `100vh` and
 * `100dvh` both keep reporting the FULL screen height while the keyboard covers the bottom
 * ~40%, so a `fixed inset-0` column keeps its composer underneath the keys. Android/Chrome
 * mostly resizes the layout viewport, so identical code looks fine there — this is an
 * iOS-shaped bug.
 *
 * ── TWO NUMBERS, AND THE FIRST FIX GOT THEM WRONG ────────────────────────────────────────
 * `visualViewport` reports the region actually visible, and it changes in TWO ways when the
 * keyboard opens: it gets SHORTER (`height`) and iOS SCROLLS it down to keep the focused
 * input in view (`offsetTop`). A `position: fixed` element is anchored to the LAYOUT
 * viewport, which does not move — so it must be told about both.
 *
 * The first version returned `height + offsetTop` as a single height. That keeps the BOTTOM
 * edge in the right place and pushes the TOP edge off the top of the screen — which is
 * precisely «the chat disappear up». Size and position are different questions:
 *
 *     top:    offsetTop      ← follow the visual viewport down
 *     height: height         ← and be exactly as tall as the visible part
 *
 * ── WHY IT RETURNS null BEFORE MOUNT ─────────────────────────────────────────────────────
 * There is no viewport on the server. `null` means "use the CSS fallback" (`inset-0` +
 * `100dvh`), which is correct everywhere the keyboard is closed — so the only thing this
 * hook changes is the keyboard-open case. Browsers without `visualViewport` stay on that
 * fallback forever rather than breaking.
 */

import { useEffect, useState } from "react";

export type ViewportBox = { top: number; height: number };

export function useVisualViewportBox(): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      setBox({ top: Math.round(vv.offsetTop), height: Math.round(vv.height) });
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  return box;
}

/**
 * True while the viewport is narrower than Tailwind's `sm` (40rem / 640px).
 *
 * The floating panel is only full-screen on phones — at `sm+` it is a 23rem × 34rem card
 * pinned above the tab bar. An inline `height`/`top` beats a class every time, so applying
 * the keyboard style unconditionally would flatten that card into a full-height column on
 * every laptop. This is the guard that keeps the fix phone-only, where the bug is.
 */
export function useCompactViewport(maxWidthPx = 640): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidthPx - 0.02}px)`);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [maxWidthPx]);

  return compact;
}

/**
 * The inline style a `fixed inset-0` chat surface should carry. Kept here rather than at each
 * call site so the floating sheet and the /lolo screen cannot drift apart again — they did
 * once already: /lolo got the fix and the floating panel did not, which is why the owner saw
 * one of them zoom and the other behave.
 *
 * `bottom: auto` matters: with `inset-0` still setting `bottom: 0`, an explicit `height`
 * would fight the bottom anchor and the element would not move at all.
 */
export function viewportBoxStyle(box: ViewportBox | null): React.CSSProperties {
  if (!box) return { height: "100dvh" };
  return { top: `${box.top}px`, height: `${box.height}px`, bottom: "auto" };
}
