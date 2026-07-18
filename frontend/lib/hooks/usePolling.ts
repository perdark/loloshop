"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `loadFn` every `intervalMs` ± random(0..jitterMs) milliseconds (default 12 s).
 * Pauses while `document.hidden` (tab in background) and when `enabled` is false.
 * Jitter spreads simultaneous clients (e.g. a whole cohort landing on the waiting
 * screen together) so their polls don't arrive at the server as one synchronized wave.
 *
 * Usage:
 *   usePolling(load, 12000);
 *   usePolling(load, 45000, isWaiting, 10000); // 35–55s randomized ticks
 */
export function usePolling(
  loadFn: () => void,
  intervalMs = 12000,
  enabled = true,
  jitterMs = 0
) {
  const loadRef = useRef(loadFn);
  useEffect(() => {
    loadRef.current = loadFn;
  }, [loadFn]);

  useEffect(() => {
    if (!enabled) return;

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function nextDelay() {
      const jitter = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0;
      return Math.max(1000, intervalMs + jitter);
    }

    function schedule() {
      timerId = setTimeout(() => {
        if (stopped) return;
        if (!document.hidden) {
          loadRef.current();
        }
        schedule();
      }, nextDelay());
    }

    function handleVisibility() {
      if (!document.hidden) {
        // Tab became visible — fire immediately then resume schedule
        loadRef.current();
        if (timerId) clearTimeout(timerId);
        schedule();
      }
    }

    schedule();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs, enabled, jitterMs]);
}
