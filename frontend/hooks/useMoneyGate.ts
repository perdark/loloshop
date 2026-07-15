"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { verifyMoneyGate, getMoneyGateStatus } from "@/lib/money-gate";

/**
 * Client-side money-gate state for the ADMIN dashboard.
 *
 * Sensitive figures (price / cost / profit) render masked until the admin
 * opens the gate with the shared secret. Once revealed, an idle timer
 * auto-hides them after `idleMs` of no window activity — so a laptop left
 * open on the dashboard doesn't keep the numbers exposed. Any pointer /
 * keyboard activity while revealed refreshes the timer.
 *
 * The revealed state is IN-MEMORY ONLY — never persisted to localStorage —
 * so a refresh re-locks the figures and the secret is re-required.
 *
 * @param idleMs auto-hide timeout in ms after the last activity (default 5min)
 */
// Per-tab session flag: a reveal survives refresh / in-tab navigation, and clears when the
// tab closes (sessionStorage, never localStorage — a new tab/window still starts locked).
const STORAGE_KEY = "loloshop_money_revealed";

export function useMoneyGate(idleMs = 1800000) {
  const [revealed, setRevealed] = useState(false);
  const [configured, setConfigured] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setRevealed(false);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, [clearTimer]);

  // (Re)start the idle countdown. Called on reveal and on every activity tick.
  const armTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setRevealed(false);
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      timerRef.current = null;
    }, idleMs);
  }, [clearTimer, idleMs]);

  const reveal = useCallback(
    async (secret: string): Promise<boolean> => {
      const ok = await verifyMoneyGate(secret);
      if (ok) {
        setRevealed(true);
        try { sessionStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
        armTimer();
      }
      return ok;
    },
    [armTimer]
  );

  // On mount: learn whether a gate secret is configured server-side.
  useEffect(() => {
    let cancelled = false;
    getMoneyGateStatus()
      .then((s) => {
        if (!cancelled) setConfigured(s.configured);
      })
      .catch(() => {
        /* fail safe — leave configured=false */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore a reveal still active for this browser-tab session (survives refresh / in-tab nav).
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") {
        setRevealed(true);
        armTimer();
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While revealed, any window activity refreshes the idle timer.
  useEffect(() => {
    if (!revealed) return;
    const refresh = () => armTimer();
    window.addEventListener("pointermove", refresh, { passive: true });
    window.addEventListener("pointerdown", refresh, { passive: true });
    window.addEventListener("keydown", refresh);
    return () => {
      window.removeEventListener("pointermove", refresh);
      window.removeEventListener("pointerdown", refresh);
      window.removeEventListener("keydown", refresh);
    };
  }, [revealed, armTimer]);

  // Clear any pending timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  return { revealed, reveal, hide, configured };
}
