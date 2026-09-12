"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { nativeShellPlatform } from "@/lib/native-shell";

/**
 * Silent first-party visit beacon. Pings our own backend on load, on every navigation, and on a
 * light heartbeat while the tab is visible. No third-party, no cookies — a random session id in
 * localStorage is the only state. Fully fire-and-forget: it never throws into the page and never
 * blocks render.
 *
 * It feeds two readers with different needs, and both are load-bearing:
 *   · «الزيارات الآن» on the TV board — distinct sessions in the last 30 min.
 *   · /admin/analytics — which pages hold attention, and app-vs-browser.
 *
 * ── ⚠️ IT MOVED TO THE ROOT LAYOUT ON 2026-09-12, AND THE EXCLUSION LIST IS WHY THAT IS SAFE ──
 * It used to mount only in app/(student)/layout.tsx, which meant the storefront was measured and
 * NOTHING else was — including /get-app, the one page every browser visitor lands on the moment
 * the app-only gate is switched on. Measuring the gate's effect was impossible from the page the
 * gate points at.
 * Mounting it at the root fixes that and introduces the opposite hazard: /admin, /staff and the
 * workshop screens are open all day on shop hardware, and counting them would put the shop's own
 * staff into «الزيارات الآن» and drown the student page ranking. So internal surfaces are
 * excluded here, at the source, rather than filtered later by every reader — a reader that
 * forgets the filter is a silently wrong number, and there are two readers already.
 *
 * ⚠️ NOT a login wall and not a security boundary: this is a stats beacon on a public endpoint.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";
const SID_KEY = "loloshop_sid";
const HEARTBEAT_MS = 5 * 60 * 1000; // matches the server's 5-min dedup window

/**
 * Internal surfaces. A visit here is work, not shopping.
 *
 * ⚠️ /wholesaler is deliberately ABSENT — a ممثل is an audience the shop asks about, and there
 * are 19 of them against 2,600+ students, so their traffic informs the numbers without moving
 * them. The staff key portals (/s/ /w/ /d/) and the screens they hand off to are all here.
 */
const SKIP_PREFIXES = [
  "/admin",
  "/staff",
  "/design-support",
  "/workshop",
  "/tv",
  "/s/",
  "/w/",
  "/d/",
];

function tracked(path: string): boolean {
  return !SKIP_PREFIXES.some((p) => path === p || path.startsWith(p));
}

function sessionId(): string {
  try {
    let sid = localStorage.getItem(SID_KEY);
    if (!sid) {
      sid =
        (crypto?.randomUUID?.() as string) ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * ⚠️ MODULE SCOPE ON PURPOSE — a per-component guard would not survive what it exists to stop.
 *
 * The server dedups with `INSERT … WHERE NOT EXISTS (a row in the last 5 min)`, and under READ
 * COMMITTED two pings a millisecond apart BOTH see no row and BOTH insert. Measured on
 * 2026-09-12: one session, one path, two rows 1 ms apart. It was always possible; it became
 * likely when this beacon started firing on every navigation instead of once per mount
 * (React's dev double-invoke reproduces it every time).
 *
 * A duplicate row is not cosmetic: /admin/analytics reads a row as ~5 minutes on a page, so
 * double-inserts inflate «دقيقة للزيارة» — the exact figure the page exists to report.
 *
 * Living at module scope means it is shared across mounts and across the two invocations React
 * makes in development, which a `useRef` inside the component is not. Same pattern, same
 * reasoning as AppBeacon's `lastPing`.
 */
let lastSentAt = 0;
let lastSentPath = "";
const CLIENT_DEDUP_MS = 60 * 1000;

function ping(path: string) {
  if (!tracked(path)) return;
  const now = Date.now();
  // Same page again within the minute is a remount or a race, never a new visit. A DIFFERENT
  // page is always allowed through — the server's 5-minute window still bounds how much of it
  // is stored, and letting navigation through is the whole point of the per-navigation ping.
  if (path === lastSentPath && now - lastSentAt < CLIENT_DEDUP_MS) return;
  lastSentPath = path;
  lastSentAt = now;
  try {
    fetch(`${API_BASE}/api/track/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId(),
        path,
        // 'web' when no native bridge answers. The server keeps only android/ios/web and stores
        // anything else as NULL — see trackController's header on why this is claimed, not proven.
        platform: nativeShellPlatform() ?? "web",
      }),
      keepalive: true,
      cache: "no-store",
    }).catch(() => {});
  } catch {
    /* never break the shop */
  }
}

export function VisitBeacon() {
  // Re-runs on every navigation, which is the whole point of reading it: the root layout does
  // NOT remount between routes, so without this the session would only ever report its landing
  // page. The server's 5-minute dedup absorbs the extra calls, so a burst of navigation still
  // writes at most one row — which is also what keeps a row worth ~5 minutes.
  const pathname = usePathname();

  useEffect(() => {
    const path = pathname || "/";
    ping(path);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") ping(path);
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [pathname]);

  return null;
}
