"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PageLoader } from "@/components/ui/Spinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { getQueue } from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import {
  ORDER_STATUS_LABELS,
  ORDER_SOURCE_LABELS,
  EMBROIDERY_ZONE_LABELS,
  EMBROIDERY_ZONE_ORDER,
  PRODUCT_TYPE_LABELS,
  type EmbroideryZone,
} from "@/lib/constants";
import { usePolling } from "@/lib/hooks/usePolling";
import type { ProductionQueueItem } from "@/lib/staff-types";
import type { OrderStatus } from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES: OrderStatus[] = [
  "design_complete",
  "converting",
  "embroidery",
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
  const postDesignStages: OrderStatus[] = ["embroidery", "pressing", "preparing", "ready"];
  if (!postDesignStages.includes(item.status)) return false;
  if (!item.has_embroidery && !item.design_id) return false;
  return !item.final_design_url;
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
}

function StageRail({ items, activeStage, onSelect }: StageRailProps) {
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
        {railItem(undefined, "الكل", total, 0, 0, false, 100)}
        {STAGES.map((s) => {
          const st = statByStage[s] ?? { count: 0, overdue: 0, missing: 0 };
          return railItem(s, ORDER_STATUS_LABELS[s], st.count, st.overdue, st.missing, s === "ready");
        })}
      </div>

      {/* Desktop vertical rail */}
      <nav
        className="hidden md:flex flex-col w-[210px] shrink-0 overflow-hidden rounded-2xl border border-line bg-beige sticky top-4 self-start"
        aria-label="مراحل الإنتاج"
      >
        {desktopRailItem(undefined, "الكل", total, 0, 0, false, 100)}
        {STAGES.map((s) => {
          const st = statByStage[s] ?? { count: 0, overdue: 0, missing: 0 };
          const pct = total ? Math.round((st.count / total) * 100) : 0;
          return desktopRailItem(
            s,
            ORDER_STATUS_LABELS[s],
            st.count,
            st.overdue,
            st.missing,
            s === "ready",
            pct
          );
        })}
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

// ─── Mobile order card ────────────────────────────────────────────────────────

function OrderMobileCard({ item }: { item: ProductionQueueItem }) {
  const overdue = isOverdue(item);
  const missing = isMissingDesign(item);
  const dl      = deadlineLabel(item);

  return (
    <Link
      href={`/staff/orders/${item.id}?from=${encodeURIComponent("/staff/queue")}`}
      className={[
        "block rounded-xl border p-3 transition-colors hover:bg-surface-sink",
        overdue ? "border-danger/50 bg-danger/5" : "border-line bg-surface",
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
  );
}

// ─── Desktop table row ────────────────────────────────────────────────────────

function OrderTableRow({
  item,
  showStage,
}: {
  item: ProductionQueueItem;
  showStage: boolean;
}) {
  const router  = useRouter();
  const overdue = isOverdue(item);
  const missing = isMissingDesign(item);
  const dl      = deadlineLabel(item);
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
              {rep.orderCount} طلب
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
        "inline-flex h-9 min-w-[36px] items-center justify-center rounded-lg border text-sm font-semibold transition-colors disabled:opacity-35 disabled:cursor-default",
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
      <span className="ms-2 text-xs text-muted">{total} طلب</span>
    </div>
  );
}

// ─── Pill helper ─────────────────────────────────────────────────────────────

function chipCls(active: boolean) {
  return [
    "inline-flex min-h-[36px] items-center rounded-full border px-3 py-1 text-sm font-semibold whitespace-nowrap transition-colors",
    active
      ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
      : "border-line bg-surface text-muted hover:border-orange-ink/30 hover:text-ink",
  ].join(" ");
}

// ─── Main console content (wrapped in Suspense for useSearchParams) ───────────

function ConsoleContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ── URL state ──────────────────────────────────────────────────────────────
  const stage  = (searchParams.get("stage") || undefined) as OrderStatus | undefined;
  const source = (searchParams.get("source") || undefined) as "retail" | "wholesaler" | undefined;
  const repParam = searchParams.get("rep") ?? null;
  const zoneParam = (searchParams.get("zone") || undefined) as EmbroideryZone | undefined;

  // ── Local state ────────────────────────────────────────────────────────────
  const [items,      setItems]      = useState<ProductionQueueItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(false);
  const [search,     setSearch]     = useState("");
  const [page,       setPage]       = useState(1);
  const [selectedBatch, setSelectedBatch] = useState("");
  const [zonesOpen,  setZonesOpen]  = useState(false);

  // ── Fetch — zone is the only server-side filter ────────────────────────────
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(false);
      try {
        // Pass zone only — stage/source/rep are client-side filters
        const data = await getQueue(undefined, undefined, zoneParam);
        setItems(data);
      } catch (err) {
        toast.error(getApiErrorMessage(err, "تعذر تحميل قائمة الإنتاج"));
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [zoneParam]
  );

  useEffect(() => {
    load();
    setPage(1);
  }, [load]);

  // ── Silent 15 s polling ────────────────────────────────────────────────────
  usePolling(() => load(true), 15000);

  // Reset batch when rep changes
  useEffect(() => {
    setSelectedBatch("");
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
    router.push(buildUrl({ stage, source, rep: repParam ?? undefined, zone: z }));
    setPage(1);
  }

  // ── Client-side filtering ──────────────────────────────────────────────────
  // Plain derived value — the React Compiler memoizes it automatically (a manual
  // useMemo here could not be preserved because it aliased/reassigned `items`).
  const q = search.trim().toLowerCase();
  const filtered = items.filter((i) => {
    if (stage && i.status !== stage) return false;
    // "الكل" means everything still in production — delivered shows only under its own chip.
    if (!stage && i.status === "delivered") return false;
    if (source === "retail" && i.source !== "retail") return false;
    if (source === "wholesaler" && i.source !== "wholesaler") return false;
    if (repParam !== null && source === "wholesaler") {
      if ((i.wholesaler_name ?? "—") !== repParam) return false;
      if (selectedBatch && i.batch_name !== selectedBatch) return false;
    }
    if (q) {
      const hit =
        i.student_name.toLowerCase().includes(q) ||
        (i.university_name ?? "").toLowerCase().includes(q) ||
        (i.department ?? "").toLowerCase().includes(q) ||
        (i.wholesaler_name ?? "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

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

  // Batches for selected rep (compiler-memoized plain value).
  const repBatches: string[] = !repParam
    ? []
    : [
        ...new Set(
          items
            .filter((i) => i.source === "wholesaler" && (i.wholesaler_name ?? "—") === repParam)
            .map((i) => i.batch_name)
            .filter((b): b is string => Boolean(b))
        ),
      ];

  // ── Pagination ────────────────────────────────────────────────────────────
  const pageItems = filtered.slice((page - 1) * PER_PAGE, (page - 1) * PER_PAGE + PER_PAGE);

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
          onSelect={setStage}
        />

        {/* ── Main column (carded panel) ──────────────────────────────────── */}
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
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors min-h-[36px]",
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
              <input
                type="search"
                placeholder="بحث باسم الطالب…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                dir="rtl"
                className="min-h-[36px] w-40 sm:w-52 rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink placeholder:text-muted focus:border-orange-ink focus:outline-none"
              />
            </div>

            {/* Row 2: rep drill-down row (wholesaler + rep selected) */}
            {showRepDrillDown && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRep(null)}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-muted hover:border-orange-ink/40 hover:text-ink transition-colors"
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
                  zonesOpen || zoneParam
                    ? "border-orange-ink text-orange-ink"
                    : "border-dashed border-line text-muted hover:border-orange-ink/40 hover:text-ink",
                ].join(" ")}
              >
                فلتر المنطقة {zonesOpen ? "▲" : "▾"}
                {zoneParam && <span className="ms-1 h-1.5 w-1.5 rounded-full bg-orange-ink" />}
              </button>

              {!loading && (
                <span className="me-auto text-xs text-muted ms-auto">
                  يُعرض <strong className="text-ink">{filtered.length}</strong> طلب
                </span>
              )}
            </div>

            {/* Zone chips (expanded) */}
            {zonesOpen && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setZone(undefined)}
                  className={chipCls(!zoneParam)}
                >
                  كل المناطق
                </button>
                {EMBROIDERY_ZONE_ORDER.map((z) => (
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
                  style={{ minWidth: 760 }}
                  aria-label="قائمة الطلبات"
                >
                  <thead>
                    <tr className="bg-beige border-b-2 border-line text-right text-[11px] uppercase tracking-wider text-muted">
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">الطالب / الجامعة</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">المنتج</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">المصدر / الممثل</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">الدفعة</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">يعمل عليه</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold">الاستحقاق / الوقت</th>
                      <th className="sticky top-0 bg-beige z-10 px-4 py-2.5 font-bold text-center">تنبيه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((item) => (
                      <OrderTableRow
                        key={item.id}
                        item={item}
                        showStage={!stage}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="flex flex-col gap-2.5 p-3 md:hidden">
                {pageItems.map((item) => (
                  <OrderMobileCard key={item.id} item={item} />
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
