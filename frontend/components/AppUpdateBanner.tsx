"use client";

/**
 * «حدّث التطبيق» — shown ONLY inside an app whose build is older than the one we need.
 *
 * ⚠️ WHY THIS EXISTS, AND WHY iOS ONLY. A remote-URL WebView shell gives its users no reason to
 * ever update: the site changes underneath them, so the app appears to improve on its own and
 * the App Store update sits there ignored. That is fine until something lives in the BINARY —
 * and push notifications do. iOS **1.0.5** is the first build that can register for them at
 * all, and nothing on the web side can substitute for it.
 *
 * ⚠️ 1.0.4 IS NOT GOOD ENOUGH, EVEN THOUGH IT CARRIES `aps-environment`. That entitlement was
 * necessary and not sufficient: Capacitor's iOS template ships no
 * `didRegisterForRemoteNotificationsWithDeviceToken`, so AppDelegate received the APNs token
 * from iOS and dropped it on the floor. `register()` succeeded, the plugin fired NEITHER
 * `registration` NOR `registrationError`, and the phone looked healthy from every angle.
 * Fixed in the build pipeline by `cb91f8d` and shipped as 1.0.5.
 * Measured on prod 2026-08-29, which is what this constant is really pinned to: **166 Android
 * device tokens against 0 iOS**, while 240 signed-in iPhones opened the app that week — every
 * one of them reporting 1.0.4, with an empty `push_register_errors` table underneath. Until
 * those phones update, the shop cannot reach a single iOS user.
 *
 * Android is deliberately NOT shown a banner: Play auto-updates far more aggressively and its
 * users are already registering tokens. Adding a platform here means proving it has the same
 * problem first.
 *
 * ⚠️ IT ASKS, IT DOES NOT BLOCK. The app works on 1.0.3 — only push is missing — so a hard gate
 * would punish a student for a problem they did not cause and cannot fix mid-order. Dismissal
 * lasts for the session, not forever: the next launch asks again, because the reason is still
 * true.
 */

import { useEffect, useState } from "react";
import { nativeAppVersion, nativeShellPlatform } from "@/lib/native-shell";

/**
 * The first iOS build that actually registers for push. Bump it only when a NEW capability
 * lands in the binary and the web cannot work without it — never for a web-only change, which
 * every install already receives.
 *
 * ⚠️ DO NOT RAISE THIS BEFORE THE BUILD IS DOWNLOADABLE. It is the version on the App Store,
 * not the version in `codemagic.yaml`: an iOS release can be approved and still sit unreleased
 * behind «Manually release this version», and a banner pointing at a build nobody can install
 * is a dead end shown to every iPhone at once. 1.0.5 was verified live before this was raised
 * (`itunes.apple.com/lookup?id=6793976053` → version 1.0.5, released 2026-08-29 18:49 UTC).
 */
const MIN_IOS_VERSION = "1.0.5";

const APP_STORE_URL = "https://apps.apple.com/app/id6793976053";

/** Cleared when the app is killed, so the ask returns next launch. */
const DISMISS_KEY = "lolo_update_banner_dismissed";

/**
 * `1.0.3` < `1.0.4`, numerically per segment.
 *
 * ⚠️ NOT a string compare: "1.0.10" sorts BEFORE "1.0.4" as text, which would hide the banner
 * from exactly the people furthest behind once the version passes 9. Unparseable input returns
 * false — an app we cannot read a version from is never nagged.
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

export function AppUpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (nativeShellPlatform() !== "ios") return;
      try {
        if (sessionStorage.getItem(DISMISS_KEY)) return;
      } catch {
        // Private mode: no memory of a dismissal, so the banner simply shows. Better than
        // throwing on a storage read.
      }
      const version = await nativeAppVersion();
      if (cancelled) return;
      setShow(isOlderThan(version, MIN_IOS_VERSION));
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div
      dir="rtl"
      lang="ar"
      // Above the content, below any modal. `safe-top` keeps it clear of the notch — this is
      // the first thing drawn inside the shell.
      className="safe-top safe-x sticky top-0 z-30 border-b border-orange/30 bg-orange/15 px-4 py-3 backdrop-blur"
      role="status"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink">
          <b className="block text-sm">في نسخة جديدة من التطبيق</b>
          نسختك ما تستلم إشعارات الطلبات. حدّثها من الآب ستور حتى يوصلك خبر طلبك.
        </span>
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[44px] shrink-0 items-center rounded-xl bg-orange px-4 text-sm font-semibold text-ink"
        >
          حدّث
        </a>
        <button
          type="button"
          aria-label="إخفاء"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* nothing to remember it with — it will ask again, which is acceptable */
            }
            setShow(false);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink/50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
