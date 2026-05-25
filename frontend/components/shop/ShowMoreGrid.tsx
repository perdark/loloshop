"use client";

import { useState, type ReactNode } from "react";

interface ShowMoreGridProps<T> {
  items: T[];
  initialCount: number;
  renderItem: (item: T) => ReactNode;
  gridClassName?: string;
  getKey?: (item: T, index: number) => string;
}

export function ShowMoreGrid<T>({
  items,
  initialCount,
  renderItem,
  gridClassName = "grid grid-cols-2 gap-3",
  getKey,
}: ShowMoreGridProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialCount);
  const remaining = items.length - initialCount;

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className={gridClassName}>
        {visible.map((item, i) => (
          <div key={getKey ? getKey(item, i) : i}>{renderItem(item)}</div>
        ))}
      </div>
      {!expanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="min-h-11 w-full rounded-lg border border-orange/30 bg-beige py-2.5 text-sm font-semibold text-orange transition-colors hover:bg-orange/10"
        >
          عرض المزيد ({remaining}+)
        </button>
      )}
    </div>
  );
}
