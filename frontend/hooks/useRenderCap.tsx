"use client";

import { useEffect, useState } from "react";

/**
 * Render a long list a page at a time — «عرض المزيد» grows it.
 *
 * ⚠️ WHY THIS EXISTS (2026-10-14): the production queue reached 8,101 rows (2,930 of them
 * «جاهز للاستلام»), and the staff screens rendered EVERY one — each card with its product
 * photo. Android coped; the iPhone WebView ran out of memory, its content process was killed
 * and the app reloaded into the same list, i.e. «يضل يحمل» for every staff member and the
 * admin on iPhone. Searching and stage chips still filter the FULL list — only the DOM is
 * capped, so nothing becomes unreachable.
 *
 * The cap resets whenever `resetKey` changes (a new search, stage or filter), so a worker
 * never lands in the middle of a list they did not scroll.
 */
const CAP_PREFIX = "loloshop-cap:";

/** sessionStorage, like useScrollRestore: how far a worker expanded is only meaningful this sitting. */
function readCap(persistKey: string | undefined, resetKey: string): number | null {
  if (!persistKey || typeof window === "undefined") return null;
  try {
    const n = Number(sessionStorage.getItem(CAP_PREFIX + persistKey + "|" + resetKey));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeCap(persistKey: string | undefined, resetKey: string, n: number) {
  if (!persistKey) return;
  try {
    sessionStorage.setItem(CAP_PREFIX + persistKey + "|" + resetKey, String(n));
  } catch {
    /* storage full/unavailable — best-effort */
  }
}

/**
 * ⚠️ `persistKey` IS WHAT MAKES BACK-NAVIGATION WORK (workshop report 2026-10-17). Without it a
 * worker who pressed «عرض المزيد» four times, opened a student and came back got 100 rows again:
 * the page was too short for useScrollRestore's saved offset, the browser clamped it, and he
 * landed far above where he was. The expanded size is remembered per (screen, resetKey), so a
 * new search/filter still starts at one page — only returning to the SAME list restores it.
 */
export function useRenderCap<T>(items: T[], resetKey: string, step = 100, persistKey?: string) {
  const [limit, setLimit] = useState(() => readCap(persistKey, resetKey) ?? step);
  useEffect(() => {
    setLimit(readCap(persistKey, resetKey) ?? step);
  }, [resetKey, step, persistKey]);
  return {
    shown: items.length > limit ? items.slice(0, limit) : items,
    hidden: Math.max(0, items.length - limit),
    showMore: () =>
      setLimit((n) => {
        const next = n + step;
        writeCap(persistKey, resetKey, next);
        return next;
      }),
  };
}

export function ShowMoreButton({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-orange-ink/30"
    >
      عرض المزيد ({hidden.toLocaleString("ar-IQ")} متبقية)
    </button>
  );
}
