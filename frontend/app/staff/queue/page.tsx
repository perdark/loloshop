"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PageLoader } from "@/components/ui/Spinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AssemblyBoard } from "@/components/staff/station/AssemblyBoard";
import { deleteProductionOrder, getQueueScoped } from "@/lib/staff";
import { getUser } from "@/lib/auth";
import { getApiErrorMessage } from "@/lib/api";
import { matchesQueueSearch } from "@/lib/queue-search";
import { rememberQueueOrder } from "@/lib/queue-neighbors";
import {
  ORDER_STATUS_LABELS,
  ORDER_SOURCE_LABELS,
  EMBROIDERY_ZONE_LABELS,
  EMBROIDERY_ZONE_ORDER,
  GARMENT_FILTER_ORDER,
  GARMENT_VIEW_ZONE_ORDER,
  PRODUCT_TYPE_LABELS,
  type EmbroideryZone,
} from "@/lib/constants";
import { formatIQD } from "@/lib/format";
import { usePolling } from "@/lib/hooks/usePolling";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import type { ProductionQueueItem } from "@/lib/staff-types";
import type { OrderStatus, StaffType } from "@/lib/types";
import { SearchField } from "@/components/ui/SearchField";

// ─── Constants ────────────────────────────────────────────────────────────────

// Stage-2 («التحويل») removed 2026-07-15 — design goes straight to التطريز. Legacy orders
// still AT converting (created by old code) keep rendering via STAGE_PILL, just no rail chip.
const STAGES: OrderStatus[] = [
  "design_complete",
  "embroidery",
  "assembly",
  "pressing",
  "preparing",
  "ready",
  "delivered",
];

const PER_PAGE = 30;

// Stage pill visual coding — WARM brand palette only (no blue/purple/navy).
const STAGE_PILL: Record<OrderStatus, string> = {
  design_complete: "bg-peach/70 text-orange-ink",
  converting:      "bg-orange/15 text-orange-ink",
  embroidery:      "bg-orange-ink/15 text-orange-ink",
  assembly:        "bg-peach/60 text-orange-ink",
  pressing:        "bg-amber-100 text-amber-800",
  preparing:       "bg-ink/8 text-ink-soft",
  ready:           "bg-emerald-100 text-emerald-700",
  pending_approval: "bg-ink/5 text-muted",
  designing:       "bg-ink/5 text-muted",
  staff_review:    "bg-ink/5 text-muted",
  printing:        "bg-ink/5 text-muted",
  delivered:       "bg-ink/5 text-muted",
  cancelled:       "bg-danger/10 text-danger",
};

// Rail indicator colour per stage — warm spectrum + emerald for ready.
const RAIL_BAR: Partial<Record<OrderStatus, string>> = {
  design_complete: "bg-orange/40",
  converting:      "bg-orange/60",
  embroidery:      "bg-orange-ink",
  assembly:        "bg-orange/70",
  pressing:        "bg-amber-500",
  preparing:       "bg-ink-soft",
  ready:           "bg-emerald-500",
  delivered:       "bg-ink/40",
};

// Product type chip colours — warm / neutral.
const PRODUCT_CHIP: Record<string, string> = {
  sash:  "bg-orange-ink/10 text-orange-ink",
  robe:  "bg-ink/8 text-muted",
  cap:   "bg-peach/70 text-orange-ink",
  shawl: "bg-amber-100 text-amber-800",
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isOverdue(item: ProductionQueueItem): boolean {
  if (!item.deadline) return false;
  if (item.status === "delivered") return false; // already handed over — not late
  return new Date(item.deadline).getTime() < Date.now();
}

function isMissingDesign(item: ProductionQueueItem): boolean {
  const postDesignStages: OrderStatus[] = ["embroidery", "assembly", "pressing", "preparing", "ready"];
  if (!postDesignStages.includes(item.status)) return false;
  if (!item.has_embroidery && !item.design_id) return false;
  // The design lives on the order's spec-line images (auto-attached calligraphy plates /
  // reference photos); final_design_url is the legacy upload. Either one counts.
  return !item.final_design_url && !item.has_design_images;
}

/** "التسليم بعد N يوم" / "متأخر" / "منذ …" */
function deadlineLabel(item: ProductionQueueItem): { text: string; cls: string } {
  if (item.deadline) {
    const diff = Math.round(
      (new Date(item.deadline).getTime() - Date.now()) / 86_400_000
    );
    if (diff < 0) return { text: "متأخر", cls: "text-danger font-bold" };
    if (diff === 0) return { text: "اليوم", cls: "text-danger font-bold" };
    return { text: `التسليم بعد ${diff} يوم`, cls: "text-ink-soft" };
  }
  // Relative created_at
  const ms = Date.now() - new Date(item.created_at).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return { text: `منذ ${mins} د`, cls: "text-muted" };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { text: `منذ ${hrs} س`, cls: "text-muted" };
  return { text: `منذ ${Math.floor(hrs / 24)} يوم`, cls: "text-muted" };
}

// ─── Rep grouping (derived from loaded data, no extra API call) ───────────────

interface RepCard {
  name: string;
  batches: string[];
  orderCount: number;
  readyCount: number;
}

function buildRepsOverview(items: ProductionQueueItem[]): RepCard[] {
  const map = new Map<string, ProductionQueueItem[]>();
  for (const item of items) {
    const key = item.wholesaler_name ?? "—";
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([name, repItems]) => ({
    name,
    batches: [...new Set(repItems.map((i) => i.batch_name).filter(Boolean) as string[])],
    orderCount: repItems.length,
    readyCount: repItems.filter((i) => i.status === "ready").length,
  }));
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skeleton h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

// ─── Stage rail (desktop: vertical sidebar; mobile: horizontal chip strip) ───

interface StageRailProps {
  items: ProductionQueueItem[];
  activeStage: OrderStatus | undefined;
  onSelect: (s: OrderStatus | undefined) => void;
  /** The viewer's own station(s) — backend `my_stages`. Marked «مرحلتي» and pulled to the
   *  front so the worker's own work is the first thing on the rail, not the fourth. `[]`
   *  for manager/admin/مفصل, who keep the plain line order. */
  mine: OrderStatus[];
}

function StageRail({ items, activeStage, onSelect, mine }: StageRailProps) {
  const mineSet = useMemo(() => new Set<OrderStatus>(mine), [mine]);
  // «مرحلتي» first, then the rest of the line in walking order.
  const orderedStages = useMemo(
    () => [...STAGES.filter((s) => mineSet.has(s)), ...STAGES.filter((s) => !mineSet.has(s))],
    [mineSet]
  );
  // "الكل" counts in-production only; delivered has its own chip (matches the list filter).
  const total = items.filter((i) => i.status !== "delivered").length;

  const statByStage = useMemo(() => {
    const m: Record<string, { count: number; overdue: number; missing: number }> = {};
    for (const item of items) {
      const s = item.status;
      if (!m[s]) m[s] = { count: 0, overdue: 0, missing: 0 };
      m[s].count++;
      if (isOverdue(item)) m[s].overdue++;
      if (isMissingDesign(item)) m[s].missing++;
    }
    return m;
  }, [items]);

  // ── Mobile: horizontal scrollable chips ──────────────────────────────────────
  // ── Desktop: vertical list (handled by parent grid) ─────────────────────────

  const railItem = (
    stage: OrderStatus | undefined,
    label: string,
    count: number,
    overdue = 0,
    missing = 0,
    isDone = false,
    pct = 0
  ) => {
    const active = stage === activeStage;
    const barCls = isDone ? "bg-emerald-500" : (stage ? (RAIL_BAR[stage] ?? "bg-orange-ink") : "bg-orange-ink");

    return (
      /* Mobile chip */
      <button
        key={stage ?? "all"}
        type="button"
        onClick={() => onSelect(stage)}
        aria-pressed={active}
        className={[
          // Shared base
          "group flex shrink-0 items-center gap-2 text-start transition-colors",
          // Mobile = pill chip
          "md:hidden rounded-full border px-3 py-2 text-sm font-semibold min-h-[44px]",
          active
            ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
            : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink",
        ].join(" ")}
      >
        <span className="text-sm font-bold">
          {label}
        </span>
        <span
          className={[
            "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums",
            active ? "bg-orange-ink text-white" : "bg-surface-sink text-muted",
          ].join(" ")}
        >
          {count}
        </span>
        {overdue > 0 && (
          <span className="h-2 w-2 rounded-full bg-danger" title={`متأخر: ${overdue}`} />
        )}
        {missing > 0 && (
          <span className="h-2 w-2 rounded-full bg-amber-400" title={`تصميم مفقود: ${missing}`} />
        )}
      </button>
    );

    // Desktop: declared separately below — we return both together via the parent
    void [barCls, pct]; // silence unused warning, used only in desktop
  };

  // Desktop rail item
  const desktopRailItem = (
    stage: OrderStatus | undefined,
    label: string,
    count: number,
    overdue = 0,
    missing = 0,
    isDone = false,
    pct = 0
  ) => {
    const active = stage === activeStage;
    const barCls = isDone ? "bg-emerald-500" : (stage ? (RAIL_BAR[stage] ?? "bg-orange-ink") : "bg-orange-ink");
    const labelCls = isDone ? "text-emerald-700" : (active ? "text-orange-ink font-bold" : "text-ink");

    return (
      <button
        key={`d-${stage ?? "all"}`}
        type="button"
        onClick={() => onSelect(stage)}
        aria-pressed={active}
        className={[
          "hidden md:flex flex-col gap-1 px-4 py-3 text-start transition-colors w-full",
          "border-s-[3px]",
          active
            ? "border-s-orange-ink bg-orange-ink/5"
            : isDone
              ? "border-s-emerald-500/30 hover:bg-surface-sink"
              : "border-s-transparent hover:bg-surface-sink",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[13px] font-semibold ${labelCls}`}>
            {label}
          </span>
          <span
            className={[
              "flex min-w-[24px] items-center justify-center rounded-full border px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
              active
                ? "border-orange-ink bg-orange-ink text-white"
                : isDone
                  ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                  : "border-line bg-surface-sink text-muted",
            ].join(" ")}
          >
            {count}
          </span>
        </div>

        {/* Alert dots */}
        {(overdue > 0 || missing > 0) && (
          <div className="flex items-center gap-1">
            {overdue > 0 && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-danger"
                title={`متأخر: ${overdue}`}
              />
            )}
            {missing > 0 && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-amber-400"
                title={`تصميم مفقود: ${missing}`}
              />
            )}
          </div>
        )}

        {/* Load bar */}
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barCls}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>
    );
  };

  // Render both mobile (chips) + desktop (rail items) side by side via render trick
  // Actually we render two separate sections in the JSX below — this function returns both

  return (
    <>
      {/* Mobile horizontal chip strip */}
      <div
        className="flex md:hidden gap-2 overflow-x-auto p-2 rounded-2xl border border-line bg-beige"
        role="group"
        aria-label="مراحل الإنتاج"
      >
        {orderedStages.map((s) => {
          const st = statByStage[s] ?? { count: 0, overdue: 0, missing: 0 };
          const label = mineSet.has(s) ? `مرحلتي · ${ORDER_STATUS_LABELS[s]}` : ORDER_STATUS_LABELS[s];
          return railItem(s, label, st.count, st.overdue, st.missing, s === "ready");
        })}
        {railItem(undefined, "الكل", total, 0, 0, false, 100)}
      </div>

      {/* Desktop vertical rail */}
      <nav
        className="hidden md:flex flex-col w-[210px] shrink-0 overflow-hidden rounded-2xl border border-line bg-beige sticky top-4 self-start"
        aria-label="مراحل الإنتاج"
      >
        {orderedStages.map((s) => {
          const st = statByStage[s] ?? { count: 0, overdue: 0, missing: 0 };
          const pct = total ? Math.round((st.count / total) * 100) : 0;
          return desktopRailItem(
            s,
            mineSet.has(s) ? `مرحلتي · ${ORDER_STATUS_LABELS[s]}` : ORDER_STATUS_LABELS[s],
            st.count,
            st.overdue,
            st.missing,
            s === "ready",
            pct
          );
        })}
        {desktopRailItem(undefined, "الكل", total, 0, 0, false, 100)}
      </nav>
    </>
  );
}

// ─── KPI strip ────────────────────────────────────────────────────────────────

function KpiStrip({ items }: { items: ProductionQueueItem[] }) {
  const inProd    = items.filter((i) => i.status !== "ready" && i.status !== "delivered").length;
  const ready     = items.filter((i) => i.status === "ready").length;
  const delivered = items.filter((i) => i.status === "delivered").length;
  const overdue   = items.filter(isOverdue).length;
  const missing   = items.filter(isMissingDesign).length;

  const kpi = (val: number, label: string, valCls: string) => (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-sink px-3 py-1.5">
      <div className="flex flex-col">
        <span className={`text-lg font-extrabold tabular-nums leading-none ${valCls}`}>{val}</span>
        <span className="text-[11px] text-muted mt-0.5">{label}</span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-beige px-4 py-3">
      {kpi(inProd,  "في الإنتاج", "text-ink")}
      <div className="hidden sm:block h-7 w-px bg-line" />
      {kpi(ready,   "جاهز اليوم", "text-emerald-600")}
      <div className="hidden sm:block h-7 w-px bg-line" />
      {kpi(delivered, "تم التسليم", "text-ink-soft")}
      <div className="hidden sm:block h-7 w-px bg-line" />
      {kpi(overdue, "متأخر",      "text-danger")}
      <div className="hidden sm:block h-7 w-px bg-line" />
      {kpi(missing, "تصميم مفقود", "text-danger")}
    </div>
  );
}

/**
 * «السعر» for one queue row (owner 2026-08-21, «show the price of order»).
 *
 * Returns null when the backend sent NO money field. That means the requester is a station
 * role the price is hidden from (getQueue deletes both fields for anyone but front-desk /
 * manager / admin) — not that the order is free — so the column simply does not render.
 *
 * ⚠️ A طقم carries its whole price on ONE piece and its siblings are 0 (527 of 1,705 bundled
 * rows on the dev DB). So a bundled row shows the SET total and says «الطقم»; only a piece
 * bought on its own shows its own price bare. The label is half the answer — the same figure
 * means two different things depending on which one it is.
 */
function orderPriceLabel(item: ProductionQueueItem): { text: string; isSet: boolean } | null {
  const bundled = item.checkout_group_id != null;
  const raw = bundled ? (item.group_price ?? item.price) : item.price;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return { text: formatIQD(n), isSet: bundled };
}

/** True once any row carries money — drives the desktop column header on/off as one unit. */
function anyPriceVisible(items: ProductionQueueItem[]): boolean {
  return items.some((i) => i.price !== undefined || i.group_price !== undefined);
}

// ─── Mobile order card ────────────────────────────────────────────────────────

function OrderMobileCard({ item, canDelete, onDelete }: { item: ProductionQueueItem; canDelete: boolean; onDelete: (id: string) => void }) {
  const overdue = isOverdue(item);
  const missing = isMissingDesign(item);
  const dl      = deadlineLabel(item);
  const price   = orderPriceLabel(item);

  return (
    <div className="rounded-xl border border-line bg-surface">
    <Link
      href={`/staff/orders/${item.id}?from=${encodeURIComponent("/staff/queue")}`}
      className={[
        "block rounded-xl border p-3 transition-colors hover:bg-surface-sink",
        overdue ? "border-danger/50 bg-danger/5" : "border-transparent",
      ].join(" ")}
    >
      {/* Row 1: name + alert */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block truncate text-sm font-bold text-ink">
            {item.checkout_group_id && (
              <span className="me-1.5 inline-block h-2 w-2 rounded-full bg-orange-ink align-middle" />
            )}
            {item.student_name}
          </span>
          {(item.university_name || item.department) && (
            <span className="block truncate text-[11px] text-muted mt-0.5">
              {[item.university_name, item.department].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
        {missing && (
          <span className="shrink-0 rounded-full border border-danger/30 bg-danger/8 px-2 py-0.5 text-[10px] font-bold text-danger">
            تصميم مفقود
          </span>
        )}
      </div>

      {/* Row 2: product + stage + source */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${PRODUCT_CHIP[item.product_type] ?? "bg-ink/5 text-muted"}`}>
          {PRODUCT_TYPE_LABELS[item.product_type as keyof typeof PRODUCT_TYPE_LABELS] ?? item.product_name}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STAGE_PILL[item.status] ?? "bg-ink/5 text-muted"}`}>
          {ORDER_STATUS_LABELS[item.status] ?? item.status}
        </span>
        {item.source === "wholesaler" && item.wholesaler_name && (
          <span className="rounded-full border border-orange-ink/20 bg-orange-ink/5 px-2 py-0.5 text-[11px] text-orange-ink">
            {item.wholesaler_name}
          </span>
        )}
        {price && (
          <span className="ms-auto rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink">
            {price.text}
            {price.isSet && <span className="ms-1 font-normal text-muted">الطقم</span>}
          </span>
        )}
      </div>

      {/* Row 3: working + time */}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        {item.working_staff_name ? (
          <span className="font-semibold text-orange-ink">⚙ {item.working_staff_name}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
        <span className={dl.cls}>{dl.text}</span>
      </div>
    </Link>
    {canDelete && <button type="button" onClick={() => onDelete(item.id)} className="mx-3 mb-3 min-h-11 rounded-full border border-danger/30 px-4 text-xs font-semibold text-danger hover:bg-danger/5">حذف القطعة</button>}
    </div>
  );
}

// ─── Desktop table row ────────────────────────────────────────────────────────

function OrderTableRow({
  item,
  showStage,
  showPrice,
  canDelete,
  onDelete,
}: {
  item: ProductionQueueItem;
  showStage: boolean;
  /** Table-level, not row-level: the header and every cell appear or vanish together. */
  showPrice: boolean;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  const router  = useRouter();
  const overdue = isOverdue(item);
  const missing = isMissingDesign(item);
  const dl      = deadlineLabel(item);
  const price   = orderPriceLabel(item);
  const href    = `/staff/orders/${item.id}?from=${encodeURIComponent("/staff/queue")}`;

  return (
    // Whole row is the click target (not just the name link), so tapping anywhere
    // on the row opens the order — matches the cursor-pointer affordance + mobile card.
    <tr
      onClick={() => router.push(href)}
      className={[
        "border-b border-line transition-colors hover:bg-surface-sink/70 cursor-pointer",
        overdue ? "border-s-[3px] border-s-danger" : item.checkout_group_id ? "border-s-[3px] border-s-orange-ink/40" : "",
      ].join(" ")}
    >
      {/* الطالب */}
      <td className="px-4 py-2.5">
        <div className="font-bold text-ink text-sm leading-snug">
          {item.checkout_group_id && (
            <span className="me-1.5 inline-block h-2 w-2 rounded-full bg-orange-ink/60 align-middle" title="باقة" />
          )}
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-orange-ink hover:underline underline-offset-2"
          >
            {item.student_name}
          </Link>
        </div>
        {(item.university_name || item.department) && (
          <div className="text-[11px] text-muted mt-0.5">
            {[item.university_name, item.department].filter(Boolean).join(" · ")}
          </div>
        )}
      </td>

      {/* المنتج (+ stage pill when showing all stages) */}
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${PRODUCT_CHIP[item.product_type] ?? "bg-ink/5 text-muted"}`}>
            {PRODUCT_TYPE_LABELS[item.product_type as keyof typeof PRODUCT_TYPE_LABELS] ?? item.product_name}
          </span>
          {showStage && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STAGE_PILL[item.status] ?? "bg-ink/5 text-muted"}`}>
              {ORDER_STATUS_LABELS[item.status] ?? item.status}
            </span>
          )}
        </div>
      </td>

      {/* السعر — «الطقم» when the figure is the bundle total (see orderPriceLabel) */}
      {showPrice && (
        <td className="px-4 py-2.5 whitespace-nowrap">
          {price ? (
            <div>
              <span className="text-sm font-bold tabular-nums text-ink">{price.text}</span>
              {price.isSet && <div className="text-[11px] text-muted mt-0.5">الطقم</div>}
            </div>
          ) : (
            <span className="text-[11px] text-muted">—</span>
          )}
        </td>
      )}

      {/* المصدر / الممثل */}
      <td className="px-4 py-2.5">
        {item.source === "wholesaler" ? (
          <div>
            <span className="text-xs font-semibold text-orange-ink">{ORDER_SOURCE_LABELS.wholesaler}</span>
            {item.wholesaler_name && (
              <div className="text-[11px] text-muted mt-0.5">{item.wholesaler_name}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-ink-soft">{ORDER_SOURCE_LABELS.retail}</span>
        )}
      </td>

      {/* الدفعة */}
      <td className="px-4 py-2.5">
        {item.batch_name ? (
          <span className="rounded-full border border-line bg-surface-sink px-2 py-0.5 text-[11px] text-muted">
            {item.batch_name}
          </span>
        ) : (
          <span className="text-[11px] text-muted">—</span>
        )}
      </td>

      {/* يعمل عليه */}
      <td className="px-4 py-2.5">
        {item.working_staff_name ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-orange-ink">
            <span aria-hidden>⚙</span>
            {item.working_staff_name}
          </span>
        ) : (
          <span className="text-[11px] text-muted">—</span>
        )}
      </td>

      {/* الاستحقاق / الوقت */}
      <td className="px-4 py-2.5 whitespace-nowrap">
        {overdue ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/8 px-2 py-0.5 text-[11px] font-bold text-danger">
            متأخر
          </span>
        ) : (
          <span className={`text-xs ${dl.cls}`}>{dl.text}</span>
        )}
      </td>

      {/* تنبيه */}
      <td className="px-4 py-2.5 text-center">
        {missing && (
          <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/8 px-2 py-0.5 text-[10px] font-bold text-danger">
            تصميم مفقود
          </span>
        )}
      </td>
      {canDelete && <td className="px-4 py-2.5"><button type="button" onClick={(event) => { event.stopPropagation(); onDelete(item.id); }} className="min-h-11 rounded-full border border-danger/30 px-3 text-xs font-semibold text-danger hover:bg-danger/5">حذف</button></td>}
    </tr>
  );
}

// ─── Rep card grid ────────────────────────────────────────────────────────────

function RepCardGrid({
  reps,
  onSelect,
}: {
  reps: RepCard[];
  onSelect: (name: string) => void;
}) {
  if (reps.length === 0)
    return <EmptyState message="لا توجد طلبات ممثلين في هذه المرحلة حالياً" />;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 p-4">
      {reps.map((rep) => (
        <button
          key={rep.name}
          type="button"
          onClick={() => onSelect(rep.name)}
          className="group flex flex-col rounded-2xl border border-line bg-surface p-4 text-start shadow-[var(--shadow-soft)] transition-colors hover:border-orange-ink/40 hover:bg-surface-sink min-h-[44px]"
        >
          <div className="flex w-full items-start justify-between gap-2">
            <span className="font-display text-base font-bold text-ink leading-snug">
              {rep.name}
            </span>
            <span className="shrink-0 rounded-full bg-orange-ink/10 px-2.5 py-0.5 text-xs font-bold tabular-nums text-orange-ink">
              {/* PIECES — `orderCount` is `repItems.length`, one queue row per piece. */}
              {rep.orderCount} قطعة
            </span>
          </div>
          {rep.batches.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {rep.batches.map((b) => (
                <span
                  key={b}
                  className="rounded-full border border-line bg-surface-sink px-2 py-0.5 text-[11px] text-muted"
                >
                  {b}
                </span>
              ))}
            </div>
          )}
          {rep.readyCount > 0 && (
            <p className="mt-2 text-xs font-semibold text-emerald-600">
              ✓ {rep.readyCount} جاهز
            </p>
          )}
          <p className="mt-2 text-xs font-medium text-orange-ink transition-opacity group-hover:opacity-80">
            عرض الطلبات ←
          </p>
        </button>
      ))}
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  total,
  page,
  onPage,
}: {
  total: number;
  page: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) {
      pages.push(p);
    }
  }

  const btn = (p: number, label: React.ReactNode, disabled = false) => (
    <button
      key={`pg-${p}`}
      type="button"
      onClick={() => !disabled && onPage(p)}
      disabled={disabled}
      className={[
        "inline-flex h-11 min-w-11 items-center justify-center rounded-lg border text-sm font-semibold transition-colors disabled:opacity-35 disabled:cursor-default",
        p === page
          ? "border-orange-ink bg-orange-ink text-white"
          : "border-line bg-surface text-muted hover:border-orange-ink/40 hover:text-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );

  let prev: number | null = null;
  const pageButtons: React.ReactNode[] = [];
  for (const p of pages) {
    if (prev !== null && p - prev > 1)
      pageButtons.push(<span key={`ell-${p}`} className="text-muted px-1 text-sm">…</span>);
    pageButtons.push(btn(p, p, page === p));
    prev = p;
  }

  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-line bg-beige px-4 py-3">
      {btn(page - 1, "‹", page === 1)}
      {pageButtons}
      {btn(page + 1, "›", page === totalPages)}
      {/* PIECES — `total` filters `items`, one row per piece. */}
      <span className="ms-2 text-xs text-muted">{total} قطعة</span>
    </div>
  );
}

// ─── Pill helper ─────────────────────────────────────────────────────────────

function chipCls(active: boolean) {
  return [
    "inline-flex min-h-11 items-center rounded-full border px-3 py-1 text-sm font-semibold whitespace-nowrap transition-colors",
    active
      ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
      : "border-line bg-surface text-muted hover:border-orange-ink/30 hover:text-ink",
  ].join(" ");
}

// ─── Session persistence — «getting back perfectly» (mirrors StationConsole.tsx) ──────
// The order page's back Link is always a BARE `/staff/queue` with NO query string (see
// lib/back.ts — `?from=/staff/queue` carries no filters), so stage/source/rep/zone (all
// URL-driven here) reset on the way back exactly like the local filters would. UI state is
// mirrored to sessionStorage and restored on mount. `ConsoleContent` only ever mounts
// client-side behind the /staff layout's auth gate (`useRequireAuth` renders a spinner
// until resolved — app/staff/layout.tsx), so lazy-reading storage here can never fight
// SSR/hydration.
interface StoredConsoleState {
  stage?: OrderStatus;
  source?: "retail" | "wholesaler";
  rep?: string;
  zone?: EmbroideryZone;
  batch?: string;
  search?: string;
  page?: number;
  /** The garment chip (`products.type`) — see `isGarmentView`. Not a URL param: it is a
   *  client-side filter over rows already fetched, exactly like المجهز's own console. */
  pieceType?: string;
  zonesOpen?: boolean;
  /** «the open-on-my-station default already ran this session». Without it, a worker who
   *  deliberately widened to «الكل» would be dragged back to «مرحلتي» on the next visit,
   *  because an absent `stage` means «الكل» and «never chosen» alike. */
  stageDefaulted?: boolean;
}
const STORAGE_KEY = "loloshop-console:production";

function readStored(): StoredConsoleState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as StoredConsoleState;
  } catch {
    return {};
  }
}

// ─── Main console content (wrapped in Suspense for useSearchParams) ───────────

function ConsoleContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentUser = getUser();
  const canDelete = currentUser?.role === "admin" || currentUser?.staff_type === "manager" || currentUser?.staff_types?.includes("manager") === true;

  // ── Whose chip set? (owner 2026-08-14, widened 2026-09-01) ─────────────────
  // قائمة الإنتاج is ONE page for every production role (StaffSidebar.tsx:114-121 gives the
  // link to all of them), so the scoping is done here rather than by editing
  // EMBROIDERY_ZONE_ORDER — /admin/orders and the designer/digitizer QueueView still need
  // the granular set. A المجهز holds ONE sash, so يمين/يسار/خلف as three chips is noise;
  // a التطريز staffer batches BY position and must keep them apart. Anyone who also
  // manages/embroiders/designs/digitizes keeps the granular set.
  const myTypes: StaffType[] =
    currentUser?.staff_types && currentUser.staff_types.length
      ? currentUser.staff_types
      : currentUser?.staff_type
        ? [currentUser.staff_type]
        : [];
  // ── ⚠️ A ZONE CHIP CANNOT NAME الشال، AND THAT IS NOT FIXABLE BY ADDING ONE ──────────
  // Every option in EMBROIDERY_ZONE_ORDER (and the PREPARER_ZONE_ORDER set it replaced) is a predicate over
  // `order_items.label_snapshot`, and a plain شال امريكي carries exactly two lines —
  // «السعر الأساسي» and «صورة الشال: شال» — neither of which is تطريز (migration 096 marks
  // the picker `is_embroidery = FALSE` on purpose). Measured on the dev DB: of the 600 شال
  // orders sitting at الكوي/التجهيز/جاهز, **zero** match any chip this page offers. So the
  // presser and the preparer both pressed «فلتر القطعة», got أوشحة, and concluded the
  // shawls were missing — they were simply unreachable.
  //
  // This is the ruling the owner already made for المجهز's own console on 2026-08-31 and
  // that never reached قائمة الإنتاج: «we must see the pieces even the pieces without تطريز
  // on filters» — so the piece filter is the GARMENT (`product_type`, which every piece
  // has), not the embroidery position. See PrepConsole.tsx's GARMENT_ORDER header.
  //
  // The two روب chips are NOT garments and stay: بكسرات/بدون كسرات is a spec the preparer
  // genuinely picks by (owner 2026-08-14), and it is the one thing product_type cannot say.
  // وشاح/قبعة move to the garment row — as zone chips they matched only pieces that CARRY
  // embroidery, so a plain وشاح عدل was as invisible as the شال.
  const isGarmentView =
    currentUser?.role !== "admin" &&
    myTypes.some((t) => t === "preparer" || t === "presser") &&
    !myTypes.some(
      (t) => t === "manager" || t === "embroiderer" || t === "designer" || t === "digitizer"
    );
  const zoneOptions = isGarmentView ? GARMENT_VIEW_ZONE_ORDER : EMBROIDERY_ZONE_ORDER;

  // Restore the last UI state (see StoredConsoleState above).
  const [stored] = useState<StoredConsoleState>(() => readStored());

  // ── URL state ──────────────────────────────────────────────────────────────
  const stage  = (searchParams.get("stage") || undefined) as OrderStatus | undefined;
  const source = (searchParams.get("source") || undefined) as "retail" | "wholesaler" | undefined;
  const repParam = searchParams.get("rep") ?? null;
  const zoneParam = (searchParams.get("zone") || undefined) as EmbroideryZone | undefined;
  // `?from=/staff/queue` (the order page's return link) is always a BARE path with no query
  // string, so on the way back this URL is momentarily empty even though the user had a zone
  // selected. Fall back to the last stored zone ONLY while the URL is still empty — once the
  // mount effect below rehydrates it, zoneParam itself carries the same value, so
  // `effectiveZone` never actually changes and `load` is never re-created (no double-fetch).
  const storedZoneFallback = searchParams.toString() === "" ? stored.zone : undefined;
  const effectiveZone = zoneParam ?? storedZoneFallback;

  // True once the restored stage/source/rep/zone (if any) are actually reflected in the URL —
  // either nothing needed rehydrating, or the mount-time `router.replace` below has committed.
  // Next's search-param update runs as a low-priority transition, so the (normal-priority) first
  // fetch's `setItems`/`setLoadedOnce` can commit BEFORE it — at that instant `stage`/`source`/
  // `repParam` still read their pre-rehydration (empty) values even though `loadedOnce` just
  // became true. The page-clamp effect below must wait for BOTH `loadedOnce` AND this flag, else
  // it clamps a restored page against a `filtered` list computed from stale (unrehydrated)
  // filters. `searchParams.toString() !== ""` is a safe proxy for "the rehydration landed" since
  // rehydration is the only thing that can turn an initially-bare URL non-empty.
  const needsRehydration = Boolean(stored.stage || stored.source || stored.rep || stored.zone);
  const rehydrated = searchParams.toString() !== "" || !needsRehydration;

  // ── Local state ────────────────────────────────────────────────────────────
  const [items,      setItems]      = useState<ProductionQueueItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  // TRUE after the first successful fetch — restored rep/batch/page validation must not run
  // (and wrongly wipe restored state) against the EMPTY pre-fetch `items` list.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error,      setError]      = useState(false);
  const [search,     setSearch]     = useState(stored.search ?? "");
  const [page,       setPage]       = useState(stored.page ?? 1);
  const [selectedBatch, setSelectedBatch] = useState(stored.batch ?? "");
  const [zonesOpen,  setZonesOpen]  = useState(stored.zonesOpen ?? false);
  const [pieceType,  setPieceType]  = useState(stored.pieceType ?? "");
  // The stages this viewer personally works — «مرحلتي». `[]` for manager/admin/مفصل, who
  // have no station and correctly keep opening on «الكل». Comes from the backend; never
  // re-derived here (see the viewerStages landmine).
  const [myStages,   setMyStages]   = useState<OrderStatus[]>([]);
  const [stageDefaulted, setStageDefaulted] = useState(stored.stageDefaulted === true);

  // ── Fetch — zone is the only server-side filter ────────────────────────────
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(false);
      try {
        // Pass zone only — stage/source/rep are client-side filters
        const res = await getQueueScoped(undefined, undefined, effectiveZone);
        setItems(res.items);
        setMyStages(res.myStages);
        setLoadedOnce(true);
      } catch (err) {
        toast.error(getApiErrorMessage(err, "تعذر تحميل قائمة الإنتاج"));
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [effectiveZone]
  );

  async function handleDelete(orderId: string) {
    if (!window.confirm("سيُحذف هذه القطعة فقط نهائياً — بقية قطع الطلب (إن وجدت) تبقى كما هي. هل أنت متأكد؟")) return;
    try {
      await deleteProductionOrder(orderId);
      toast.success("تم حذف القطعة");
      await load(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذّر حذف القطعة"));
    }
  }

  // Rehydrate stage/source/rep/zone into the URL once, IF this visit arrived with an empty
  // query string (the exact shape the order page's back Link produces). A URL that already
  // carries its own params (shared link, in-app rail click) is left alone. Runs once on mount.
  useEffect(() => {
    if (searchParams.toString() !== "") return;
    if (stored.stage || stored.source || stored.rep || stored.zone) {
      router.replace(
        buildUrl({ stage: stored.stage, source: stored.source, rep: stored.rep, zone: stored.zone })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open on «مرحلتي», once per session.
  //
  // WHY. Since 2026-08-31 this list is the WHOLE line for every line staff member
  // (LINE_VIEW_STAGES) — the right call for the line, but it meant a designer or an
  // embroiderer landed on hundreds of other stations' rows and said so. This changes the
  // DEFAULT only: «الكل» and every other stage stay one tap away on the rail, and nobody
  // loses the access the 08-31 decision granted.
  //
  // Three guards, all load-bearing: `stageDefaulted` (a deliberate «الكل» must survive —
  // an absent `stage` cannot tell «الكل» apart from «not chosen yet»), a URL that already
  // names a stage (a shared link or a rail click owns the choice), and `rehydrated` (the
  // restore above may still be landing, and replacing over it would eat the restored filters).
  useEffect(() => {
    if (!loadedOnce || stageDefaulted || !rehydrated) return;
    setStageDefaulted(true);
    if (stage || !myStages.length) return;
    const own = myStages.find((st) => items.some((i) => i.status === st)) ?? myStages[0];
    router.replace(buildUrl({ stage: own, source, rep: repParam ?? undefined, zone: zoneParam }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedOnce, rehydrated, stageDefaulted, myStages, stage]);

  // Mirror the UI state so back-navigation restores it exactly.
  useEffect(() => {
    try {
      const snapshot: StoredConsoleState = {
        stage,
        source,
        rep: repParam ?? undefined,
        zone: zoneParam,
        batch: selectedBatch,
        search,
        page,
        pieceType,
        zonesOpen,
        stageDefaulted,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* storage full/unavailable — persistence is best-effort */
    }
  }, [stage, source, repParam, zoneParam, selectedBatch, search, page, pieceType, zonesOpen, stageDefaulted]);

  // Scroll offset, restored alongside the filters above. Keyed on stage+page so paging or
  // switching stage starts at the top (a new list), while «رجوع» from a piece does not.
  useScrollRestore(`staff-queue:${stage}:${page}`, loadedOnce && !loading);

  // `load` only changes identity when `effectiveZone` genuinely changes (the mount-time URL
  // rehydration above never flips it — see storedZoneFallback), so this still fires exactly
  // once per real zone change. Skip the very first (mount) run's page reset so a restored page
  // survives; every later run is a real filter change.
  const isFirstLoadRef = useRef(true);
  useEffect(() => {
    load();
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
    } else {
      setPage(1);
    }
  }, [load]);

  // ── Silent 15 s polling ────────────────────────────────────────────────────
  usePolling(() => load(true), 15000);

  // Reset batch when rep changes. Skip while the initial fetch hasn't resolved yet — the
  // mount-time URL rehydration above can flip repParam from empty to a restored value before
  // data loads, and that transition must not wipe the also-restored batch chip. `loadedOnce`
  // is read via closure (not a dep) so this still fires only on a genuine repParam change.
  useEffect(() => {
    if (!loadedOnce) return;
    setSelectedBatch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repParam]);

  // ── URL helpers ────────────────────────────────────────────────────────────
  function buildUrl(params: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/staff/queue?${qs}` : "/staff/queue";
  }

  function setStage(s: OrderStatus | undefined) {
    router.push(buildUrl({ stage: s, source, rep: repParam ?? undefined, zone: zoneParam }));
    setPage(1);
  }

  function setSourceTab(s: "retail" | "wholesaler" | undefined) {
    router.push(buildUrl({ stage, source: s, zone: zoneParam }));
    setPage(1);
  }

  function setRep(name: string | null) {
    router.push(buildUrl({ stage, source: "wholesaler", rep: name ?? undefined, zone: zoneParam }));
    setPage(1);
  }

  function setZone(z: EmbroideryZone | undefined) {
    // The garment row and the pleat row are two answers to one question («أي قطعة؟»), so
    // they are exclusive: «شال» + «روب بكسرات» is an empty list dressed up as a filter.
    setPieceType("");
    router.push(buildUrl({ stage, source, rep: repParam ?? undefined, zone: z }));
    setPage(1);
  }

  function setGarment(t: string) {
    setPieceType(t);
    if (zoneParam) router.push(buildUrl({ stage, source, rep: repParam ?? undefined }));
    setPage(1);
  }

  // A zone key outside THIS viewer's chip set still filters the list server-side, but no chip
  // would be lit and «كل المناطق» would look inactive too — which reads as «الفلتر خربان»,
  // the exact failure staffController.js:217-222 guards against on its own zone param. It is
  // reachable: the zone is mirrored into sessionStorage (STORAGE_KEY above) and lib/auth.ts
  // logout() clears localStorage ONLY, so on a shared workshop iPad the next account inherits
  // it. Keep the stale key visible so it can be cleared with one tap.
  const visibleZones: EmbroideryZone[] =
    zoneParam && !zoneOptions.includes(zoneParam) ? [...zoneOptions, zoneParam] : zoneOptions;

  // ── Client-side filtering ──────────────────────────────────────────────────
  // Plain derived value, deliberately unmemoised: a manual useMemo here could not be
  // preserved because it aliased/reassigned `items`. ⚠️ It is NOT compiler-memoised either —
  // this line used to claim the React Compiler handled it, and the compiler is not enabled in
  // this app (no `experimental.reactCompiler`, no babel plugin). So this really does re-run on
  // every render; it is accepted at this row count, not free.
  const q = search.trim().toLowerCase();
  // Everything EXCEPT the garment chip — this is the population the chips count, so a chip
  // never disappears the moment it is pressed (same rule as PrepConsole's garmentChips).
  const beforeGarment = items.filter((i) => {
    if (stage && i.status !== stage) return false;
    // "الكل" means everything still in production — delivered shows only under its own chip.
    if (!stage && i.status === "delivered") return false;
    if (source === "retail" && i.source !== "retail") return false;
    if (source === "wholesaler" && i.source !== "wholesaler") return false;
    if (repParam !== null && source === "wholesaler") {
      if ((i.wholesaler_name ?? "—") !== repParam) return false;
      if (selectedBatch && i.batch_name !== selectedBatch) return false;
    }
    // Student / university / department / rep AND the التطريز text, Arabic-normalised —
    // shared with المجهز's console so the two screens cannot disagree about what "search"
    // means. See lib/queue-search.ts.
    if (!matchesQueueSearch(i, q)) return false;
    return true;
  });
  const filtered = pieceType
    ? beforeGarment.filter((i) => i.product_type === pieceType)
    : beforeGarment;

  // The garments actually present, in a fixed order — a chip is never offered for a garment
  // this list does not hold, so «شال ٠» can't happen.
  const garmentChips = GARMENT_FILTER_ORDER.map((t) => ({
    type: t,
    count: beforeGarment.filter((i) => i.product_type === t).length,
  })).filter((c) => c.count > 0);

  // A garment that leaves the list (switching stage, or the last شال packed) would otherwise
  // filter the page to nothing behind a chip row that no longer offers it.
  const garmentKeys = garmentChips.map((c) => c.type).join(",");
  useEffect(() => {
    if (!loadedOnce || !pieceType) return;
    if (!garmentKeys.split(",").includes(pieceType)) setPieceType("");
  }, [garmentKeys, pieceType, loadedOnce]);

  // Hand the order page its «السابق»/«التالي» (bug 8, part 3). The FILTERED list, not the
  // visible page, so stepping past the bottom of page 1 continues instead of dead-ending.
  // In an effect, not during render: this writes to sessionStorage.
  const filteredIds = filtered.map((i) => i.id).join(",");
  useEffect(() => {
    rememberQueueOrder(filteredIds ? filteredIds.split(",") : []);
  }, [filteredIds]);

  // ── Source counts (for tab badges) ────────────────────────────────────────
  const stageItems   = stage ? items.filter((i) => i.status === stage) : items;
  const countAll     = stageItems.length;
  const countRetail  = stageItems.filter((i) => i.source === "retail").length;
  const countWholer  = stageItems.filter((i) => i.source === "wholesaler").length;

  // ── Reps overview ──────────────────────────────────────────────────────────
  const wholesalerItems = useMemo(
    () => items.filter((i) => i.source === "wholesaler"),
    [items]
  );
  const repsOverview = useMemo(() => buildRepsOverview(wholesalerItems), [wholesalerItems]);

  // Batches for selected rep (memoized — it's a dependency of the prune effect below).
  const repBatches: string[] = useMemo(
    () =>
      !repParam
        ? []
        : [
            ...new Set(
              items
                .filter((i) => i.source === "wholesaler" && (i.wholesaler_name ?? "—") === repParam)
                .map((i) => i.batch_name)
                .filter((b): b is string => Boolean(b))
            ),
          ],
    [items, repParam]
  );

  // A restored rep/batch (from a stale sessionStorage snapshot) may no longer have live
  // orders — degrade to "الكل"/"كل الدفعات" instead of a stuck-empty drill-down. Gated on
  // loadedOnce so it never runs against the empty pre-fetch list.
  useEffect(() => {
    if (!loadedOnce || !repParam) return;
    const repStillExists = items.some(
      (i) => i.source === "wholesaler" && (i.wholesaler_name ?? "—") === repParam
    );
    if (!repStillExists) {
      router.replace(buildUrl({ stage, zone: zoneParam }));
      return;
    }
    if (selectedBatch && !repBatches.includes(selectedBatch)) setSelectedBatch("");
  }, [loadedOnce, items, repParam, selectedBatch, repBatches, stage, zoneParam, router]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const pageItems = filtered.slice((page - 1) * PER_PAGE, (page - 1) * PER_PAGE + PER_PAGE);
  // Derived from the WHOLE fetch, not the current page: whether money is visible is a
  // property of the viewer's role, so the column must not appear and vanish while paging
  // through (a page that happens to hold only rows with a null price would otherwise drop it).
  const showPrice = anyPriceVisible(items);

  // A restored page number may exceed the fresh list's page count — degrade to page 1 instead
  // of silently rendering an empty slice. Gated on `rehydrated` too (see definition above) so
  // this never clamps against a `filtered` count computed before the mount-time URL rehydration
  // has actually landed.
  useEffect(() => {
    if (!loadedOnce || !rehydrated) return;
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > totalPages) setPage(1);
  }, [loadedOnce, rehydrated, filtered.length, page]);

  // Whether to show rep grid vs table
  const showRepGrid     = source === "wholesaler" && repParam === null;
  const showRepDrillDown = source === "wholesaler" && repParam !== null;

  // ── Scroll table to top on page change ────────────────────────────────────
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tableRef.current?.scrollTo({ top: 0 });
  }, [page]);

  // ── Refresh button ─────────────────────────────────────────────────────────
  const [spinning, setSpinning] = useState(false);
  async function handleRefresh() {
    setSpinning(true);
    await load();
    setTimeout(() => setSpinning(false), 400);
  }

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="خط الإنتاج"
        subtitle="متابعة الطلبات الحيّة"
        action={
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              مباشر
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface-sink px-3 py-2 text-sm font-semibold text-muted transition-colors hover:border-orange-ink/40 hover:text-ink disabled:opacity-50 min-h-[44px]"
            >
              <svg
                aria-hidden
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={spinning ? "animate-spin" : ""}
              >
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
              تحديث
            </button>
          </div>
        }
      />

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div className="mb-4">
          <KpiStrip items={items} />
        </div>
      )}

      {/* Stage rail (sticky carded sidebar on desktop · horizontal strip on mobile) + content */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start">

        {/* Stage rail (desktop left sidebar + mobile horizontal strip) */}
        <StageRail
          items={items}
          activeStage={stage}
          mine={myStages}
          onSelect={setStage}
        />

        {/* ── Main column (carded panel) ──────────────────────────────────── */}
        <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
        {/* «التجميع» — the board (halves arriving + sashes ready to sew) sits above the flat
            list for anyone looking at that stage, not only برزان (line-wide view rule). */}
        {stage === "assembly" && (
          <div className="rounded-2xl border border-line bg-beige p-3">
            <AssemblyBoard />
          </div>
        )}
        <div className="flex w-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface">

          {/* Toolbar */}
          <div className="border-b border-line bg-beige px-4 py-2 space-y-2">

            {/* Row 1: source tabs + search */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Source tabs */}
              <div className="flex gap-1">
                {[
                  { key: undefined as "retail" | "wholesaler" | undefined, label: "الكل",       count: countAll },
                  { key: "retail"      as const,                           label: "تجزئة",      count: countRetail },
                  { key: "wholesaler"  as const,                           label: "ممثلين",     count: countWholer },
                ].map(({ key, label, count }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setSourceTab(key)}
                    className={[
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                      source === key
                        ? "border-orange-ink bg-orange-ink text-white"
                        : "border-line bg-surface text-muted hover:border-orange-ink/30 hover:text-ink",
                    ].join(" ")}
                  >
                    {label}
                    {!loading && (
                      <span
                        className={[
                          "inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                          source === key ? "bg-white/25 text-white" : "bg-orange-ink/10 text-orange-ink",
                        ].join(" ")}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1" />

              {/* Search */}
              <SearchField
                value={search}
                onChange={(v) => { setSearch(v); setPage(1); }}
                placeholder="بحث بالاسم أو الجامعة أو التطريز…"
                variant="pill"
                className="w-full min-w-0 sm:w-52"
                inputClassName="px-3"
              />
            </div>

            {/* Row 2: rep drill-down row (wholesaler + rep selected) */}
            {showRepDrillDown && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRep(null)}
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-muted hover:border-orange-ink/40 hover:text-ink transition-colors"
                >
                  ← كل الممثلين
                </button>
                <span className="text-sm font-bold text-ink">{repParam}</span>
                {repBatches.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedBatch("")}
                      className={chipCls(selectedBatch === "")}
                    >
                      كل الدفعات
                    </button>
                    {repBatches.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setSelectedBatch(b)}
                        className={chipCls(selectedBatch === b)}
                      >
                        {b}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Row 3: zone filter (collapsible) */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setZonesOpen((o) => !o)}
                className={[
                  "inline-flex min-h-[34px] items-center rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  zonesOpen || zoneParam || pieceType
                    ? "border-orange-ink text-orange-ink"
                    : "border-dashed border-line text-muted hover:border-orange-ink/40 hover:text-ink",
                ].join(" ")}
              >
                {isGarmentView ? "فلتر القطعة" : "فلتر المنطقة"} {zonesOpen ? "▲" : "▾"}
                {(zoneParam || pieceType) && <span className="ms-1 h-1.5 w-1.5 rounded-full bg-orange-ink" />}
              </button>

              {!loading && (
                <span className="me-auto text-xs text-muted ms-auto">
                  {/* PIECES — `filtered` holds queue rows, one per piece. */}
                  يُعرض <strong className="text-ink">{filtered.length}</strong> قطعة
                </span>
              )}
            </div>

            {/* Zone chips (expanded) */}
            {zonesOpen && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPieceType("");
                    setZone(undefined);
                  }}
                  className={chipCls(!zoneParam && !pieceType)}
                >
                  {isGarmentView ? "كل القطع" : "كل المناطق"}
                </button>
                {/* Garment chips — المكوجي/المجهز only. They carry a count because «شال ٥٩٢»
                    is the answer to the question that produced this row; the pleat chips
                    beside them stay bare, since they answer a spec question, not «how many
                    of these do I have». */}
                {isGarmentView &&
                  garmentChips.map((c) => (
                    <button
                      key={c.type}
                      type="button"
                      onClick={() => setGarment(pieceType === c.type ? "" : c.type)}
                      aria-pressed={pieceType === c.type}
                      className={chipCls(pieceType === c.type)}
                    >
                      {PRODUCT_TYPE_LABELS[c.type]}
                      <span className="ms-1 tabular-nums opacity-70">{c.count}</span>
                    </button>
                  ))}
                {visibleZones.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZone(z)}
                    className={chipCls(zoneParam === z)}
                  >
                    {EMBROIDERY_ZONE_LABELS[z]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Content area ────────────────────────────────────────────────── */}
          {loading ? (
            <div className="p-4"><TableSkeleton /></div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-10 text-center gap-3">
              <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
              <p className="text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
              <button
                type="button"
                onClick={() => load()}
                className="mt-1 rounded-full bg-orange-ink px-5 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : showRepGrid ? (
            <RepCardGrid
              reps={repsOverview}
              onSelect={(name) => setRep(name)}
            />
          ) : filtered.length === 0 ? (
            <EmptyState message="لا توجد طلبات مطابقة في هذه المرحلة" />
          ) : (
            <>
              {/* Desktop table */}
              <div
                ref={tableRef}
                className="hidden md:block overflow-x-auto"
              >
                <table
                  className="w-full text-sm border-collapse"
                  style={{ minWidth: showPrice ? 860 : 760 }}
                  aria-label="قائمة الطلبات"
                >
                  <thead>
                    <tr className="bg-beige border-b-2 border-line text-right text-[11px] uppercase tracking-wider text-muted">
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">الطالب / الجامعة</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">المنتج</th>
                      {showPrice && <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">السعر</th>}
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">المصدر / الممثل</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">الدفعة</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">يعمل عليه</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">الاستحقاق / الوقت</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold text-center">تنبيه</th>
                      {canDelete && <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">حذف</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((item) => (
                      <OrderTableRow
                        key={item.id}
                        item={item}
                        showStage={!stage}
                        showPrice={showPrice}
                        canDelete={canDelete}
                        onDelete={handleDelete}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="flex flex-col gap-2.5 p-3 md:hidden">
                {pageItems.map((item) => (
                  <OrderMobileCard key={item.id} item={item} canDelete={canDelete} onDelete={handleDelete} />
                ))}
              </div>

              {/* Pagination */}
              <Pagination
                total={filtered.length}
                page={page}
                onPage={(p) => setPage(p)}
              />
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page shell (Suspense boundary for useSearchParams) ───────────────────────

export default function StaffQueuePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ConsoleContent />
    </Suspense>
  );
}
