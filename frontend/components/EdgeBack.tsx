"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { nativeShellPlatform } from "@/lib/native-shell";

/**
 * Swipe from the RIGHT edge leftwards to go back — the gesture iOS gives every native app and
 * our shell does not.
 *
 * ⚠️ WHY THIS IS WEB CODE AND NOT AN iOS SETTING. WKWebView has the gesture built in
 * (`allowsBackForwardNavigationGestures`) but it is OFF by default, and **Capacitor has no
 * config key for it** — turning it on means editing the generated iOS project. `frontend/ios/`
 * is produced at build time by Codemagic, so that route costs a patch script, a new binary and
 * an Apple review (the same trap the push entitlement and the privacy strings live in — see
 * docs/patches/README.md). This file gets the same behaviour out on a WEB deploy, which reaches
 * every already-installed app the moment CI lands, because both shells are remote-URL WebViews
 * pointing at https://lolo-shop96.com. The native switch is deferred, not cancelled.
 *
 * ⚠️ RIGHT EDGE, NOT LEFT. The app is `dir="rtl"`, so "back" comes from the side the page
 * starts on — the student sweeps from the right edge towards the left. Mirroring this to the
 * left edge is how you make it feel wrong on an Arabic screen.
 *
 * ⚠️ iOS SHELL ONLY, AND THAT IS A DELIBERATE NARROWING vs. the version this was ported from
 * (grand-layan's `components/store/edge-back.tsx`, which runs everywhere). Android already has
 * a back affordance — the hardware/gesture back reaches the WebView and walks its history — so
 * running this there risks a single sweep going back TWICE, once from the system and once from
 * us. A browser likewise has its own gesture. iOS-in-the-shell is the one place with no way
 * back at all.
 *
 * ⚠️ NO FINGER-TRACKING ANIMATION IN THIS VERSION. Real iOS drags a snapshot of the previous
 * screen behind the finger; imitating that means a live transform on the scroll container,
 * which is exactly where the sticky/RTL layout bugs live. The gesture works; nothing moves
 * until someone can measure the alternative on a real iPhone.
 */

/** Width of the start zone at the right edge. Wider than ~24px starts eating edge buttons. */
const EDGE = 24;
/** Travel that separates a deliberate back from a twitch. */
const DISTANCE = 60;
/** Clearly horizontal: without this, vertical scrolling fires stray backs. */
const AXIS_RATIO = 1.5;

/**
 * Is the finger inside something that genuinely scrolls sideways?
 *
 * ⚠️ DERIVED AT RUNTIME, NEVER A HAND-WRITTEN LIST OF SELECTORS. The app has a dozen
 * horizontal strips today (stage chips, the media gallery, the family slider, admin tables)
 * and a written list forgets the thirteenth the day it is added. The `scrollWidth >
 * clientWidth` test matters too: an `overflow-x:auto` container with nothing overflowing does
 * not scroll, so it has no claim on the gesture.
 */
function inHorizontalScroller(start: Element | null): boolean {
  for (let el = start; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox === "auto" || ox === "scroll") return true;
  }
  return false;
}

/**
 * Surfaces where a drag means something other than navigation.
 *
 * `canvas` is the sash designer (Fabric v6): a student dragging her name or her university
 * logo from near the right edge must never be thrown off the page — that is unsaved work.
 * Text fields are selection drags. `[data-no-edge-back]` is the escape hatch for anything
 * added later that needs one.
 */
function inDragSurface(start: Element | null): boolean {
  return !!start?.closest?.(
    'canvas, input, textarea, [contenteditable="true"], [data-no-edge-back]'
  );
}

/** Is an overlay open right now? Same rule NotificationPermissionPrompt uses to stay out of the way. */
function overlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
}

export function EdgeBack() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (nativeShellPlatform() !== "ios") return;

    let x0 = 0;
    let y0 = 0;
    let armed = false;

    const onStart = (e: TouchEvent) => {
      armed = false;
      // Two fingers is a pinch or a scroll, never a back.
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < window.innerWidth - EDGE) return;
      const target = document.elementFromPoint(t.clientX, t.clientY);
      if (inDragSurface(target) || inHorizontalScroller(target)) return;
      x0 = t.clientX;
      y0 = t.clientY;
      armed = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (!armed) return;
      armed = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (dx > -DISTANCE) return; // negative = leftwards
      if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) return;

      // ⚠️ AN OPEN SHEET EATS THE GESTURE FIRST. `components/ui/Modal.tsx` listens for this
      // cancelable event and closes itself, so the swipe dismisses the sheet instead of
      // navigating the page underneath it. Any future overlay joins by adding one listener —
      // nothing here needs to change.
      const consumed = !window.dispatchEvent(
        new CustomEvent("lolo:back", { cancelable: true })
      );
      if (consumed) return;

      // A hand-rolled overlay that does NOT listen is still an overlay: swallow the gesture
      // rather than navigating the page out from under it. Doing nothing is recoverable;
      // leaving the student on a different screen with a sheet still drawn on top is not.
      if (overlayOpen()) return;

      // Nothing behind the root. An accidental sweep must never close the app the way
      // Android's back button legitimately can.
      if (pathname === "/") return;
      router.back();
    };

    // All passive: we cancel nothing, so vertical scrolling keeps its native speed.
    document.addEventListener("touchstart", onStart, { capture: true, passive: true });
    document.addEventListener("touchend", onEnd, { capture: true, passive: true });
    document.addEventListener("touchcancel", onEnd, { capture: true, passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
      document.removeEventListener("touchcancel", onEnd, { capture: true });
    };
  }, [router, pathname]);

  return null;
}
