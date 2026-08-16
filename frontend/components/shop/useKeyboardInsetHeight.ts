"use client";

/**
 * The height a full-screen chat may actually occupy, in px — keyboard included.
 *
 * ── WHY `100dvh` IS NOT ENOUGH, AND THIS EXISTS ──────────────────────────────────────────
 * Owner report (2026-08-16, iPhone): «it zooms in and keyboard broke the view».
 *
 * On iOS Safari the software keyboard does NOT shrink the layout viewport. `100vh` and
 * `100dvh` both keep reporting the FULL screen height while the keyboard covers the bottom
 * ~40% of it, so a `fixed inset-0` chat column keeps its composer somewhere underneath the
 * keys. The page then scrolls under the fixed element and everything looks broken — which is
 * exactly the symptom described. Android/Chrome mostly resizes the layout viewport, so the
 * same code looks fine there; this is an iOS-shaped bug and it needs an iOS-shaped answer.
 *
 * `window.visualViewport` is that answer: it reports the region actually VISIBLE to the user,
 * so it shrinks when the keyboard opens on both platforms. We track it and hand back a pixel
 * height the caller can put straight on a container.
 *
 * ── WHY IT RETURNS null BEFORE MOUNT ─────────────────────────────────────────────────────
 * There is no viewport on the server, and guessing one would render a wrong-height chat for
 * one frame. `null` means "use the CSS fallback" (`100dvh`), which is correct everywhere the
 * keyboard is closed — so the only thing this hook actually changes is the keyboard-open
 * case. Browsers without `visualViewport` (none we support, but still) stay on that fallback
 * forever rather than breaking.
 */

import { useEffect, useState } from "react";

export function useKeyboardInsetHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      // `offsetTop` matters as much as `height`: iOS scrolls the visual viewport up to keep a
      // focused input above the keyboard, and without subtracting that shift the column is the
      // right SIZE but in the wrong PLACE — the header slides off the top of the screen.
      setHeight(Math.round(vv.height + vv.offsetTop));
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  return height;
}
