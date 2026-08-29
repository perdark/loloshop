"use client";

/**
 * «حدّث التطبيق» — a BLOCKING full-screen gate shown inside an iOS app whose build is older
 * than the one we need. Same shape as the «الخصومات» popup (DiscountPopup): a centred card on
 * a dimmed canvas — but with no close button, no Escape, no backdrop dismissal and no
 * «لاحقاً». The app is unusable until the student updates.
 *
 * ⚠️ THIS REPLACES THE DISMISSIBLE BANNER, ON THE OWNER'S INSTRUCTION (2026-08-29). The old
 * component's header argued the opposite — «IT ASKS, IT DOES NOT BLOCK» — on the grounds that
 * only push is missing on 1.0.4 and a hard gate punishes a student mid-order. The owner
 * overruled that: a shop that cannot reach a single iPhone is worse than an update wall, and
 * an ignorable banner reached nobody. Keep the reasoning visible so the trade-off is a
 * decision and not an accident.
 *
 * ⚠️ WHY iOS ONLY. A remote-URL WebView shell gives its users no reason to ever update: the
 * site changes underneath them, so the app appears to improve on its own. That is fine until
 * something lives in the BINARY — and push notifications do. iOS **1.0.5** is the first build
 * that can register for them at all; 1.0.4 carried `aps-environment` and still could not,
 * because Capacitor's iOS template ships no
 * `didRegisterForRemoteNotificationsWithDeviceToken` and AppDelegate dropped the APNs token on
 * the floor (fixed by `cb91f8d`). Android is deliberately NOT gated: Play auto-updates far
 * more aggressively and its phones are already registering tokens — 166 of them against 0 on
 * iOS when this was written. Adding a platform here means proving it has the same problem
 * first.
 *
 * ⚠️ THREE THINGS MUST ALL BE TRUE BEFORE ANYTHING IS BLOCKED, because the cost of a false
 * positive is every iPhone in the field staring at a wall:
 *   1. we are inside the iOS shell (never a browser — the website is not gated),
 *   2. the bridge answered with a version string we could parse,
 *   3. that version is genuinely older than MIN_IOS_VERSION.
 * `nativeAppVersion()` returns null on any failure and `isOlderThan(null, …)` is false, so
 * every unknown resolves to "let them through".
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { nativeAppVersion, nativeShellPlatform } from "@/lib/native-shell";

/**
 * The first iOS build that actually registers for push. Bump it only when a NEW capability
 * lands in the binary and the web cannot work without it — never for a web-only change, which
 * every install already receives.
 *
 * ⚠️ NOW THAT THIS BLOCKS, RAISING IT IS A RELEASE EVENT, NOT AN EDIT. It is the version on
 * the App Store, not the version in `codemagic.yaml`: an iOS release can be approved and still
 * sit unreleased behind «Manually release this version», and a gate pointing at a build nobody
 * can install locks every iPhone out of the shop at once. Verify the store first — 1.0.5 was
 * checked live before this was raised (`itunes.apple.com/lookup?id=6793976053` → version
 * 1.0.5, released 2026-08-29 18:49 UTC).
 */
const MIN_IOS_VERSION = "1.0.5";

const APP_STORE_URL = "https://apps.apple.com/app/id6793976053";

/**
 * `1.0.3` < `1.0.4`, numerically per segment.
 *
 * ⚠️ NOT a string compare: "1.0.10" sorts BEFORE "1.0.4" as text, which would gate exactly the
 * people furthest behind out of the app forever once the version passes 9. Unparseable input
 * returns false — an app we cannot read a version from is never blocked.
 */
export function isOlderThan(version: string | null, minimum: string): boolean {
  if (!version) return false;
  const parse = (v: string) => v.trim().split(".").map((n) => Number.parseInt(n, 10));
  const a = parse(version);
  const b = parse(minimum);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function AppUpdateGate() {
  const [blocked, setBlocked] = useState(false);
  // createPortal needs document.body, which only exists client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (nativeShellPlatform() !== "ios") return;
      const version = await nativeAppVersion();
      if (cancelled) return;
      setBlocked(isOlderThan(version, MIN_IOS_VERSION));
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing behind the gate may scroll — an update wall you can scroll past is a banner.
  useEffect(() => {
    if (!blocked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [blocked]);

  if (!blocked || !mounted) return null;

  return createPortal(
    <div
      dir="rtl"
      lang="ar"
      // z-[100] sits ABOVE ui/Modal's z-50 on purpose: a dialog that opened a moment before
      // the version answer came back must not end up on top of the wall.
      // `data-lolo-blocking-gate` is what NotificationPermissionPrompt looks for so it never
      // stacks its own card on this one.
      data-lolo-blocking-gate=""
      className="animate-fade-page-in fixed inset-0 z-[100] flex items-center justify-center bg-ink/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="lolo-update-gate-title"
    >
      <div className="animate-auth-card-in flex w-full max-w-md flex-col gap-5 overflow-hidden rounded-3xl bg-cream p-6 text-center shadow-[var(--shadow-pop)] ring-1 ring-line">
        <p className="font-script text-4xl leading-none text-orange-ink">lolo shop</p>

        <span
          aria-hidden
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-orange/15 text-orange-ink"
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </span>

        <h2
          id="lolo-update-gate-title"
          className="font-display-ar text-2xl font-bold leading-tight text-ink"
        >
          لازم تحدّث التطبيق
        </h2>

        <div className="rounded-2xl bg-gradient-to-l from-orange/20 to-blush/30 px-4 py-3">
          <p className="text-sm font-semibold leading-relaxed text-ink">
            نسختك قديمة وما تستلم إشعارات الطلبات. حدّث التطبيق من الآب ستور حتى تكدر تكمل
            وتوصلك أخبار طلبك.
          </p>
        </div>

        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-shine btn-press inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-orange-ink px-7 text-base font-semibold text-white shadow-[var(--shadow-soft)]"
        >
          حدّث الآن
        </a>

        {/* No «لاحقاً». The only way out of this screen is the update — that is the point. */}
        <p className="text-xs leading-relaxed text-ink/60">
          بعد ما يخلص التحديث، افتح التطبيق من جديد.
        </p>
      </div>
    </div>,
    document.body
  );
}
