"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Collapse a burst of calls into ONE, fired `waitMs` after the last of them.
 *
 * ⚠️ THIS EXISTS BECAUSE THE PRODUCTION STREAM IS PER-PIECE AND THE BULK ENDPOINTS ARE NOT.
 * `markEmbroideryZoneBulk` and `advanceBulk` accept up to 200 items and loop, and every
 * iteration calls `emitOrderChanged` — so محمد عماد ticking 40 sashes in one press pushes
 * ~40 `order` events (more, counting the auto-advance at each piece's last zone). Every
 * staff console then re-fetched its WHOLE queue once per event, on every open device at
 * once: one press turning into hundreds of identical queries against Neon, and a phone
 * that stops responding while they land. `/admin` already debounced its reload for exactly
 * this reason (app/admin/page.tsx); this is that pattern, shared.
 *
 * The trailing edge is deliberate: the LAST event of a burst is the one whose state we
 * want, and 400 ms is under the threshold where a worker reads the board as "live".
 */
export function useCoalesced(fn: () => void, waitMs = 400): () => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fnRef.current();
    }, waitMs);
  }, [waitMs]);
}
