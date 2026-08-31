"use client";

import { useMemo } from "react";
import { ORDER_STATUS_LABELS, PRODUCTION_STAGE_ORDER } from "@/lib/constants";
import type { OrderStatus } from "@/lib/types";

/**
 * The stage picker every production screen opens with.
 *
 * WHY IT EXISTS. Owner decision 2026-08-31 opened the whole line to every line staff member
 * (backend `LINE_VIEW_STAGES`), which was the right call for the line — 197 shawls had been
 * stranded at التطريز because the only embroiderer's scope could not see them — but it also
 * meant every worker's HOME screen opened on every other station's work. They said they were
 * nervous, and they were right to be: «مراجعة التصاميم» was listing قيد الكوي orders.
 *
 * The fix is a default, not a narrowing. `mine` (the backend's `my_stages`) is preselected
 * and marked «مرحلتي»; every other stage the backend returned stays one tap away, and
 * «الكل» is always the last chip. Nobody loses access — the dam the 08-31 change removed
 * stays removed.
 *
 * ⚠️ `mine` and `stages` must come from the queue response, never from a TypeScript copy of
 * QUEUE_STAGES. See the `viewerStages` landmine.
 */
export interface StageChipsProps {
  /** Stages that actually have rows, from the queue payload. Order here is ignored. */
  stages: OrderStatus[];
  /** The viewer's own station(s) — backend `my_stages`. `[]` for manager/admin/مفصل. */
  mine: OrderStatus[];
  /** `undefined` = «الكل» (no stage filter). */
  value: OrderStatus | undefined;
  onChange: (stage: OrderStatus | undefined) => void;
  /** Row count per stage, for the badge. Optional — omit to draw chips with no counts. */
  counts?: Partial<Record<OrderStatus, number>>;
  /** Total row count, for the «الكل» badge. */
  totalCount?: number;
  className?: string;
}

export function StageChips({
  stages,
  mine,
  value,
  onChange,
  counts,
  totalCount,
  className = "",
}: StageChipsProps) {
  const mineSet = useMemo(() => new Set<OrderStatus>(mine), [mine]);

  // «مرحلتي» first, then the rest of the line in walking order. Only stages the backend
  // actually returned get a chip, so a screen never offers a stage that would come back empty
  // and never claims access the API did not grant.
  const ordered = useMemo(() => {
    const present = new Set<OrderStatus>(stages);
    const line = PRODUCTION_STAGE_ORDER.filter((s) => present.has(s));
    return [...line.filter((s) => mineSet.has(s)), ...line.filter((s) => !mineSet.has(s))];
  }, [stages, mineSet]);

  // Nothing to choose between — don't put a control on screen that does nothing.
  if (ordered.length < 2) return null;

  const chip = (
    key: string,
    label: string,
    active: boolean,
    own: boolean,
    count: number | undefined,
    onClick: () => void
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        // 44px tap target — these are phone and iPad screens.
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors",
        active
          ? "border-orange-ink bg-orange-ink text-white shadow-[var(--shadow-soft)]"
          : own
            ? "border-orange-ink/40 bg-peach/40 text-orange-ink hover:text-ink"
            : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink",
      ].join(" ")}
    >
      {own ? "مرحلتي · " : ""}
      {label}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
            active ? "bg-white/20" : "bg-ink/8"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );

  return (
    <nav
      aria-label="تصفية حسب المرحلة"
      className={`flex gap-2 overflow-x-auto pb-1 ${className}`}
      dir="rtl"
    >
      {ordered.map((s) =>
        chip(
          s,
          ORDER_STATUS_LABELS[s],
          value === s,
          mineSet.has(s),
          counts?.[s],
          () => onChange(s)
        )
      )}
      {chip("all", "الكل", value === undefined, false, totalCount, () => onChange(undefined))}
    </nav>
  );
}
