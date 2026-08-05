"use client";

import { useEffect, useRef } from "react";

// Restore where a worker WAS in a long staff list after they open a piece and come back.
//
// ⚠️ Next's built-in scroll restoration does NOT cover this case, which is why the bug
// survived so long. It restores on browser back/forward (popstate). The staff screens
// navigate INTO a piece with `<Link href="/staff/orders/…?from=…">` and come back with
// ANOTHER Link (app/staff/orders/[orderId]/page.tsx builds `back.href` from `?from=`) —
// that is a fresh push navigation, and a push always lands at the top by design.
//
// Even real browser-back lands at the top here: every staff list fetches its data in an
// effect, so at restore time the DOM is a short skeleton and the browser clamps the
// scroll to the document height it can see. Hence `ready` below.
//
// Reported by the workshop 2026-08-05: «لما يضغطون رجوع يرجعهم لبداية الصفحة مو لوين ما كانوا».

const PREFIX = "loloshop-scroll:";

/** sessionStorage, not localStorage: a position is only meaningful within one sitting. */
function read(key: string): number {
  try {
    return Number(sessionStorage.getItem(PREFIX + key)) || 0;
  } catch {
    return 0;
  }
}

function write(key: string, y: number) {
  try {
    sessionStorage.setItem(PREFIX + key, String(y));
  } catch {
    /* storage full/unavailable — position memory is best-effort, never fatal */
  }
}

/**
 * Persist and restore `window.scrollY` for one list screen.
 *
 * @param key    Stable per-screen id (include any sub-view, so switching tabs inside a
 *               screen doesn't restore the other tab's position).
 * @param ready  TRUE once the real list is committed to the DOM — NOT while a skeleton
 *               is up. Restoring early scrolls a short page and the browser clamps to 0,
 *               which looks exactly like the bug this hook fixes.
 */
export function useScrollRestore(key: string, ready: boolean) {
  const restoredFor = useRef<string | null>(null);

  // Save continuously, rAF-throttled. Writing sessionStorage on every raw scroll event
  // is a synchronous string serialisation per frame — measurable jank on the low-end
  // Androids the workshop actually uses.
  //
  // ⚠️ THE FREEZE IS NOT OPTIONAL, AND THE FIRST VERSION OF THIS HOOK WAS BROKEN WITHOUT IT.
  // Measured in a browser: the saved offset came back as "0" and the list still jumped to
  // the top. Cause — leaving the page scrolls the window to 0, that reset fires an ordinary
  // `scroll` event, and the listener below dutifully overwrote the good position with 0.
  // (Writing `window.scrollY` from an unmount cleanup has the same defect for the same
  // reason.) So the position is snapshotted on the CLICK — the last moment that reflects
  // where the worker actually was — and writes are frozen afterwards. If the click turns
  // out not to be a navigation, the freeze lifts and tracking resumes; if it is, this
  // component unmounts and the freeze dies with it.
  useEffect(() => {
    let queued = false;
    let frozen = false;
    let thaw: ReturnType<typeof setTimeout> | undefined;

    const onScroll = () => {
      if (frozen || queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!frozen) write(key, window.scrollY);
      });
    };

    const onClickCapture = () => {
      write(key, window.scrollY);
      frozen = true;
      clearTimeout(thaw);
      thaw = setTimeout(() => {
        frozen = false;
      }, 1500);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    // Capture phase: run before any handler that might navigate.
    window.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("click", onClickCapture, true);
      clearTimeout(thaw);
    };
  }, [key]);

  // Restore once per key, after the list is real.
  useEffect(() => {
    if (!ready || restoredFor.current === key) return;
    restoredFor.current = key;
    const y = read(key);
    if (y <= 0) return;
    // Two frames: the first lets React commit the list, the second lets the row heights
    // settle (zone thumbnails reserve their box, so this does not fight image loading).
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, y));
    });
    return () => cancelAnimationFrame(raf);
  }, [key, ready]);
}
