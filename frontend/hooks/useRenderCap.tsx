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
export function useRenderCap<T>(items: T[], resetKey: string, step = 100) {
  const [limit, setLimit] = useState(step);
  useEffect(() => {
    setLimit(step);
  }, [resetKey, step]);
  return {
    shown: items.length > limit ? items.slice(0, limit) : items,
    hidden: Math.max(0, items.length - limit),
    showMore: () => setLimit((n) => n + step),
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
