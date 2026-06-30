"use client";

import { useEffect } from "react";

// Silent first-party visit beacon. Pings our own backend on load + a light
// heartbeat while the tab is visible, so the TV board's «الزيارات الآن» metric
// can count distinct sessions in the last 30 min. No third-party, no cookies —
// a random session id in localStorage is the only state. Fully fire-and-forget:
// it never throws into the page and never blocks render.
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";
const SID_KEY = "loloshop_sid";
const HEARTBEAT_MS = 5 * 60 * 1000; // matches the server's 5-min dedup window

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

function ping() {
  try {
    fetch(`${API_BASE}/api/track/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId(), path: location.pathname }),
      keepalive: true,
      cache: "no-store",
    }).catch(() => {});
  } catch {
    /* never break the shop */
  }
}

export function VisitBeacon() {
  useEffect(() => {
    ping();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, []);
  return null;
}
