"use client";

import { useEffect } from "react";
import { AUTH_CHANGED_EVENT, getUser } from "@/lib/auth";
import { nativeShellPlatform } from "@/lib/native-shell";

/**
 * «هل فتح الموظف التطبيق اليوم؟» — the fourth staff-presence signal (migration 084).
 *
 * Renders nothing. Fires only for `role === 'staff'`, and is completely inert for students,
 * reps, admins and signed-out visitors.
 *
 * ── WHY IT LIVES IN THE ROOT LAYOUT AND NOT IN app/staff/layout.tsx ────────────────────────
 * A staff member who opens the app and lands anywhere — a deep link, the storefront, their own
 * profile — has opened the app. Gating the beacon to `/staff/*` would under-count exactly the
 * casual opens the owner is asking about, and would make the answer to «هل يفتح التطبيق» depend
 * on which page the shortcut happened to point at.
 *
 * ── WHY IT IS SAFE HERE ───────────────────────────────────────────────────────────────────
 * It reads the cached user from localStorage rather than fetching one, so it costs no request
 * for the 1,100+ students who will never trigger it, and it never blocks render. The endpoint
 * answers 204 unconditionally — a failed presence write must never surface to an employee with
 * a production queue open.
 *
 * ⚠️ NOT AN ATTENDANCE RECORD. Opening the app is not بصمة and not opening it is not a
 * deduction. This writes to staff_app_opens and nothing else; the two signals are shown side by
 * side in the report precisely so the owner can see where they disagree.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";

// Matches the server's session-gap window (lib/staffPresence.js). Pinging more often than this
// cannot increment `opens`, so a tighter interval would be pure noise; this keeps `last_seen_at`
// honest for a long shift without the row ever counting a second "open".
const HEARTBEAT_MS = 30 * 60 * 1000;

// A foreground return sooner than this is tab-switching, not coming back to the app. Without
// it, a staff member alt-tabbing between the queue and WhatsApp would fire a request per switch
// — all of them no-ops server-side, all of them real requests on a slow Iraqi connection.
const FOREGROUND_DEBOUNCE_MS = 60 * 1000;

export function StaffAppBeacon() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastPing = 0;

    function ping() {
      // Re-read the role on every ping, not once on mount: a logout/login between two pings
      // must be able to change the answer, and `getUser` is a localStorage read.
      if (getUser()?.role !== "staff") return;

      const now = Date.now();
      if (now - lastPing < FOREGROUND_DEBOUNCE_MS) return;
      lastPing = now;

      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        void fetch(`${API_BASE}/api/staff/app-open`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ platform: nativeShellPlatform() ?? "web" }),
          keepalive: true,
          cache: "no-store",
        }).catch(() => {});
      } catch {
        /* never break the app for a presence beacon */
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") ping();
    }

    function start() {
      ping();
      if (timer) clearInterval(timer);
      timer = setInterval(onVisible, HEARTBEAT_MS);
    }

    start();
    document.addEventListener("visibilitychange", onVisible);
    // A staff member signing in IS an app open, and on a fresh login the user is not in
    // localStorage yet when this effect first runs.
    window.addEventListener(AUTH_CHANGED_EVENT, start);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(AUTH_CHANGED_EVENT, start);
    };
  }, []);

  return null;
}
