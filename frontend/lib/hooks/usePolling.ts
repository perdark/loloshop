"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `loadFn` every `intervalMs` milliseconds (default 12 s).
 * Pauses while `document.hidden` (tab in background) and when `enabled` is false.
 * Cleans up the timer on unmount or when deps change.
 *
 * Usage:
 *   usePolling(load, 12000);
 */
export function usePolling(
  loadFn: () => void,
  intervalMs = 12000,
  enabled = true
) {
  const loadRef = useRef(loadFn);
  useEffect(() => {
    loadRef.current = loadFn;
  }, [loadFn]);

  useEffect(() => {
    if (!enabled) return;

    let timerId: ReturnType<typeof setInterval> | null = null;

    function schedule() {
      timerId = setInterval(() => {
        if (!document.hidden) {
          loadRef.current();
        }
      }, intervalMs);
    }

    function handleVisibility() {
      if (!document.hidden) {
        // Tab became visible — fire immediately then resume schedule
        loadRef.current();
        if (timerId) clearInterval(timerId);
        schedule();
      }
    }

    schedule();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (timerId) clearInterval(timerId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs, enabled]);
}
