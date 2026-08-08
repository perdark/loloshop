"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Routes an incoming App Link / Universal Link to the right page inside the shell.
 *
 * WHY THIS IS NEEDED AT ALL. The native binaries are remote-URL WebViews pointing at
 * https://lolo-shop96.com (capacitor.config.ts), so the shell always boots at "/". When
 * Android/iOS hand the app a https://lolo-shop96.com/join/<code> URL, the OS does NOT
 * navigate the WebView for you — without this listener the student lands on the home page
 * and the referral code is silently dropped, which is the exact failure that made joining
 * browser-only in the first place.
 *
 * Two arrival paths, and BOTH are required — this is the classic half-working deep link:
 *   • App already running → Android onNewIntent (launchMode="singleTask") → `appUrlOpen`.
 *   • App not running (COLD START) → no event ever fires; the URL is only readable once,
 *     from App.getLaunchUrl(). Handling only the listener means links work when you are
 *     testing with the app open and fail for every real student tapping from WhatsApp.
 */

/**
 * Paths this app is allowed to take over from the browser.
 *
 * ⚠️ MUST STAY IN SYNC with the pathPrefix in android/app/src/main/AndroidManifest.xml and
 * PATHS in app/.well-known/apple-app-site-association/route.ts. It is repeated here as a
 * second gate on purpose: the OS decides what it *delivers*, this decides what we *act on*,
 * so a future manifest widening cannot turn into arbitrary in-app navigation by accident.
 *
 * /join/ is the rep's referral link. /s/ /w/ /d/ are the team secret-key portals — the only
 * way in for staff, workshop and design-team members who have no phone for the WhatsApp OTP.
 */
const ALLOWED_PATH_PREFIXES = ["/join/", "/s/", "/w/", "/d/"] as const;

/** Only our own origins. A link on any other host is not ours to follow. */
const ALLOWED_HOSTS = new Set(["lolo-shop96.com", "www.lolo-shop96.com"]);

export function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    // Browsers already resolve these URLs by simply loading them — the handler is only
    // meaningful inside the native shell. Same signal lib/app-gate.ts uses.
    const isNative =
      typeof window !== "undefined" &&
      Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor);
    if (!isNative) return;

    let cancelled = false;
    let removeListener: (() => void) | undefined;

    const navigateTo = (url: string | null | undefined) => {
      if (!url) return;

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return; // Not a URL we can reason about — ignore rather than guess.
      }

      if (parsed.protocol !== "https:") return;
      if (!ALLOWED_HOSTS.has(parsed.hostname)) return;
      if (!ALLOWED_PATH_PREFIXES.some((p) => parsed.pathname.startsWith(p))) return;

      const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (target === current) return; // Already there (cold start can report both).

      // replace(), not push(): the shell's "/" boot page is not a destination the student
      // chose, so leaving it on the stack would make Back bounce them home mid-signup.
      router.replace(target);
    };

    void (async () => {
      // Dynamic import keeps @capacitor/app out of the browser bundle — it is only ever
      // fetched inside the shell, where the bridge that backs it actually exists.
      const { App } = await import("@capacitor/app");
      if (cancelled) return;

      // Cold start: read the URL the app was launched with, if any.
      try {
        const launch = await App.getLaunchUrl();
        if (!cancelled) navigateTo(launch?.url);
      } catch {
        // No launch URL is the normal case (plain icon tap) and throws on some versions.
      }
      if (cancelled) return;

      // Warm start: the app was already open when the link was tapped.
      const handle = await App.addListener("appUrlOpen", (event) => navigateTo(event.url));
      if (cancelled) {
        void handle.remove();
        return;
      }
      removeListener = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [router]);

  return null;
}
