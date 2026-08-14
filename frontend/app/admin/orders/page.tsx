"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  getAdminOrders,
  getAdminOrderBundles,
  getAdminWholesalers,
  getRepsOverview,
  updateOrderCost,
  updateCheckoutGroup,
  approveOrderAdmin,
  rejectOrderAdmin,
} from "@/lib/admin";
import type { AdminBundle, AdminOrderWithApproval, RepOverview, WholesalerApproval } from "@/lib/admin";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_OPTIONS,
  EMBROIDERY_ZONE_LABELS,
  EMBROIDERY_ZONE_ORDER,
  type EmbroideryZone,
} from "@/lib/constants";
import { formatDateShort, formatIQD } from "@/lib/format";
import { moneyLabels, summariseOrderMoney } from "@/lib/orderMoney";
import type { AdminWholesaler, OrderStatus } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePolling } from "@/lib/hooks/usePolling";
import {
  CalculationDetails,
  OrderMoneyExplanation,
} from "@/components/admin/CalculationDetails";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = "item" | "bundle";
type OrderSource = "retail" | "wholesaler";
type SortKey = "profit" | "cost" | "price" | null;
type SortDir = "asc" | "desc";
type ApprovalFilter = WholesalerApproval | "";

const PRODUCT_TYPE_CHIPS: { value: string; label: string }[] = [
  { value: "", label: "الكل" },
  { value: "sash", label: "وشاح" },
  { value: "robe", label: "روب" },
  { value: "cap", label: "كاب" },
];

const SOURCE_TABS: { value: OrderSource; label: string; subtitle: string }[] = [
  { value: "retail", label: "طلبات التجزئة", subtitle: "طلبات الطلاب المستقلين" },
  { value: "wholesaler", label: "طلبات الممثلين", subtitle: "طلبات عبر ممثلي الجامعات" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Session persistence — «perfect back-navigation restore» ──────────────────
// Mirrors components/staff/station/StationConsole.tsx: lazy sessionStorage read +
// a single mirror-snapshot effect. Safe to lazy-init — this page only ever mounts
// client-side, behind AdminLayout's useRequireAuth loading gate (no SSR/hydration
// of the filtered UI). Excludes fetched data + transient modal state (rejectTarget,
// depositDraft, loading flags) — only the filter/view UI state is persisted.
interface StoredOrdersState {
  activeSource?: OrderSource;
  wholesalerId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: OrderStatus | "";
  typeFilter?: string;
  zoneFilter?: EmbroideryZone | "";
  approvalFilter?: ApprovalFilter;
  batchId?: string;
  viewMode?: ViewMode;
  sortKey?: SortKey;
  sortDir?: SortDir;
}
const STORAGE_KEY = "loloshop-admin-orders";

function readStoredOrdersState(): StoredOrdersState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as StoredOrdersState;
  } catch {
    return {};
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function profitColor(profit: number | null | undefined): string {
  if (profit == null) return "text-ink-soft";
  return profit < 0 ? "text-danger" : "text-ink";
}

function OrdersTableSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="skeleton h-10 w-full rounded-xl" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

function BundlesSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton h-40 w-full rounded-2xl" />
      ))}
    </div>
  );
}

// ─── Approval helpers ─────────────────────────────────────────────────────────

const APPROVAL_BADGE: Record<
  WholesalerApproval,
  { label: string; className: string }
> = {
  pending: {
    label: "بانتظار موافقة الممثل",
    className:
      "bg-amber-50 text-amber-700 border border-amber-200",
  },
  approved: {
    label: "موافق عليه",
    className:
      "bg-green-50 text-green-700 border border-green-200",
  },
  rejected: {
    label: "مُرجَع",
    className:
      "bg-red-50 text-red-700 border border-red-200",
  },
};

function ApprovalBadge({ approval }: { approval: WholesalerApproval | null }) {
  if (!approval) return null;
  const cfg = APPROVAL_BADGE[approval];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

/** Modal for the admin to type a rejection reason. */
function RejectReasonModal({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) { toast.error("سبب الإرجاع مطلوب"); return; }
    onConfirm(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="إرجاع الطلب"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="surface-card w-full max-w-sm rounded-2xl p-6 shadow-[var(--shadow-card)]"
      >
        <h2 className="font-display-ar text-lg font-bold text-ink">إرجاع الطلب</h2>
        <p className="mt-1 text-sm text-ink-soft">يُرسَل السبب إلى الطالب والممثل.</p>
        <textarea
          className="mt-4 w-full rounded-xl border border-line bg-beige px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
          rows={3}
          placeholder="اكتب سبب الإرجاع…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
          required
          dir="rtl"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-orange-ink/40"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[44px] items-center rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "جارٍ الإرجاع…" : "إرجاع"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format an Iraqi phone as a tel: link-friendly string; strips leading 0 and prepends 964. */
function iqPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("0") ? `964${digits.slice(1)}` : digits;
}

/** Days from today to event_date. Negative = past. */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.round(diff / 86_400_000);
}

// ─── Bundle card ──────────────────────────────────────────────────────────────

function BundleCard({
  bundle,
  source,
  onBundlesChange,
  onApprove,
  onReject,
}: {
  bundle: AdminBundle;
  source: OrderSource;
  onBundlesChange: (updater: (prev: AdminBundle[]) => AdminBundle[]) => void;
  onApprove: (cgId: string) => void;
  onReject: (cgId: string) => void;
}) {
  const isSingle = bundle.items.length === 1 && bundle.checkout_group_id === null;
  const { intake } = bundle;

  // Inline deposit editor state
  const [depositDraft, setDepositDraft] = useState<string | null>(null);
  const [savingDeposit, setSavingDeposit] = useState(false);

  async function handleSaveDeposit() {
    if (!bundle.checkout_group_id || depositDraft === null) return;
    const raw = depositDraft.trim().replace(/[^\d]/g, "");
    const val = raw === "" ? 0 : parseInt(raw, 10);
    if (isNaN(val) || val < 0) { toast.error("عربون غير صالح"); return; }
    setSavingDeposit(true);
    try {
      const updated = await updateCheckoutGroup(bundle.checkout_group_id, { deposit: val });
      // Optimistic update — splice new intake into bundles list
      onBundlesChange((prev) =>
        prev.map((b) =>
          b.checkout_group_id === bundle.checkout_group_id
            ? { ...b, intake: updated }
            : b
        )
      );
      setDepositDraft(null);
      toast.success("تم حفظ العربون");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ العربون"));
    } finally {
      setSavingDeposit(false);
    }
  }

  const days = intake?.event_date ? daysUntil(intake.event_date) : null;
  const remaining = intake ? bundle.total_price - intake.deposit : null;
  const phone1Int = iqPhone(intake?.phone_primary);
  const phone2Int = iqPhone(intake?.phone_secondary);
  const countedItems = bundle.items.filter((item) => item.status !== "cancelled");
  const cancelledCount = bundle.items.length - countedItems.length;

  return (
    <article className={`surface-card rounded-2xl p-4 shadow-[var(--shadow-card)] ${isSingle ? "border border-line" : "border-2 border-orange-ink/20"}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-display-ar font-bold text-ink">
            {intake?.customer_name || bundle.student_name}
          </p>
          {intake?.instagram_username && (
            <p className="text-sm text-orange-ink">@{intake.instagram_username}</p>
          )}
          {bundle.university_name && !intake && (
            <p className="text-sm text-ink-soft">{bundle.university_name}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            {!isSingle && (
              <span className="rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2.5 py-0.5 text-xs font-semibold text-orange-ink">
                باقة ({bundle.items.length})
              </span>
            )}
            <span className="text-xs text-muted">{formatDateShort(bundle.created_at)}</span>
          </div>
          {bundle.wholesalerApproval && (
            <ApprovalBadge approval={bundle.wholesalerApproval} />
          )}
          {bundle.wholesalerApproval === "rejected" && bundle.wholesalerRejectReason && (
            <p className="text-xs text-red-600">السبب: {bundle.wholesalerRejectReason}</p>
          )}
        </div>
      </div>

      {/* Admin approval override buttons (wholesaler bundles pending approval) */}
      {bundle.wholesalerApproval === "pending" && bundle.checkout_group_id && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <span className="flex-1 text-xs font-medium text-amber-800">بانتظار موافقة الممثل</span>
          <button
            type="button"
            onClick={() => onApprove(bundle.checkout_group_id!)}
            className="inline-flex min-h-[36px] items-center rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            موافقة مدير
          </button>
          <button
            type="button"
            onClick={() => onReject(bundle.checkout_group_id!)}
            className="inline-flex min-h-[36px] items-center rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            إرجاع
          </button>
        </div>
      )}

      {/* Intake strip */}
      {intake && (
        <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface-sink px-3 py-3 text-sm">
          {/* Location */}
          {(intake.governorate || intake.area_details) && (
            <p className="text-ink-soft">
              {[intake.governorate, intake.area_details].filter(Boolean).join(" / ")}
            </p>
          )}

          {/* Phones */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {phone1Int && (
              <a
                href={`tel:+${phone1Int}`}
                className="font-medium text-orange-ink underline-offset-2 hover:underline"
                dir="ltr"
              >
                +{phone1Int}
              </a>
            )}
            {phone2Int && (
              <a
                href={`tel:+${phone2Int}`}
                className="font-medium text-orange-ink underline-offset-2 hover:underline"
                dir="ltr"
              >
                +{phone2Int}
              </a>
            )}
          </div>

          {/* Event date + countdown */}
          {intake.event_date && (
            <div className="flex items-center gap-2">
              <span className="text-ink-soft">
                الحفلة: {intake.event_date}
              </span>
              {days !== null && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    days === 0
                      ? "bg-danger/15 text-danger"
                      : days < 0
                        ? "bg-ink/10 text-ink-soft"
                        : days <= 7
                          ? "bg-danger/10 text-danger"
                          : "bg-ink/8 text-ink-soft"
                  }`}
                >
                  {days === 0
                    ? "اليوم"
                    : days < 0
                      ? `قبل ${Math.abs(days)} يوم`
                      : `حفلتهم بعد ${days} يوم`}
                </span>
              )}
            </div>
          )}

          {/* Deposit + remaining */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-ink-soft">
              واصل:{" "}
              <span className="font-semibold tabular-nums text-ink" dir="ltr">
                {formatIQD(intake.deposit)}
              </span>
            </span>
            {remaining !== null && (
              <span className="text-ink-soft">
                المتبقي:{" "}
                <span
                  className={`font-semibold tabular-nums ${remaining > 0 ? "text-ink" : "text-ink-soft"}`}
                  dir="ltr"
                >
                  {formatIQD(Math.max(0, remaining))}
                </span>
              </span>
            )}

            {/* Inline deposit edit */}
            {bundle.checkout_group_id && (
              depositDraft === null ? (
                <button
                  type="button"
                  onClick={() => setDepositDraft(String(intake.deposit))}
                  className="ms-1 rounded-md px-2 py-0.5 text-xs font-medium text-orange-ink ring-1 ring-orange-ink/30 transition-colors hover:bg-orange-ink/10"
                >
                  تعديل العربون
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={depositDraft}
                    onChange={(e) => setDepositDraft(e.target.value.replace(/[^\d]/g, ""))}
                    className="w-28 rounded-lg border border-orange-ink/40 bg-white px-2 py-1 text-sm tabular-nums text-ink outline-none focus:ring-2 focus:ring-orange-ink/20"
                    dir="ltr"
                    aria-label="العربون"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={savingDeposit}
                    onClick={handleSaveDeposit}
                    className="rounded-lg bg-orange-ink px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {savingDeposit ? "..." : "حفظ"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositDraft(null)}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-ink/5"
                  >
                    إلغاء
                  </button>
                </div>
              )
            )}
          </div>

          {/* Notes */}
          {intake.notes && (
            <p className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-soft">
              {intake.notes}
            </p>
          )}
        </div>
      )}

      {/* Items */}
      <ul className="mt-3 space-y-2">
        {bundle.items.map((item) => (
          <li
            key={item.order_id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line bg-surface-sink px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Link
                href={`/staff/orders/${item.order_id}?from=${encodeURIComponent("/admin/orders")}`}
                className="font-medium text-orange-ink hover:underline"
              >
                {item.product_name}
              </Link>
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft">
                {ORDER_STATUS_LABELS[item.status] ?? item.status}
              </span>
            </div>
            <div className="flex items-center gap-4 tabular-nums text-xs">
              <span className="text-ink-soft" dir="ltr">{formatIQD(item.price)}</span>
              <span className={profitColor(item.profit)} dir="ltr">
                {item.profit != null ? formatIQD(item.profit) : "—"}
              </span>
            </div>
            <OrderMoneyExplanation
              price={item.price}
              cost={item.cost}
              profit={item.profit}
              calculation={item.calculation}
              source={source}
              className="w-full bg-surface"
            />
          </li>
        ))}
      </ul>

      {/* Bundle totals */}
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-orange-ink/15 bg-orange-ink/5 px-3 py-2 text-xs">
        <div>
          <p className="text-muted">الإجمالي</p>
          <p className="font-semibold tabular-nums text-ink" dir="ltr">
            {formatIQD(bundle.total_price)}
          </p>
        </div>
        <div>
          <p className="text-muted">
            {source === "wholesaler" ? "حصة الإدارة" : "التكلفة"}
          </p>
          <p className="font-semibold tabular-nums text-ink-soft" dir="ltr">
            {formatIQD(bundle.total_cost)}
          </p>
        </div>
        <div>
          {/* The receipt below already said «ربح الممثل»; this tile did not, so the same
              bundle read two different ways depending on where the eye landed. */}
          <p className="text-muted">
            {source === "wholesaler" ? "ربح الممثل" : "الربح"}
          </p>
          <p className={`font-semibold tabular-nums ${profitColor(bundle.total_profit)}`} dir="ltr">
            {formatIQD(bundle.total_profit)}
          </p>
        </div>
      </div>
      <CalculationDetails summary="كيف حُسب إجمالي الباقة؟" className="mt-2">
        <div className="space-y-1.5">
          {countedItems.map((item) => (
            <div key={item.order_id} className="flex items-center justify-between gap-3">
              <span className="truncate">{item.product_name}</span>
              <span className="shrink-0 tabular-nums text-ink" dir="ltr">
                {formatIQD(item.price)} − {formatIQD(item.cost)} = {formatIQD(item.profit)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 rounded-lg bg-ink/[0.04] px-2.5 py-2 text-ink">
          <p>الإيراد = مجموع أسعار القطع غير الملغاة = <span dir="ltr">{formatIQD(bundle.total_price)}</span></p>
          <p>{source === "wholesaler" ? "حصة الإدارة" : "التكلفة"} = مجموع تكاليف القطع غير الملغاة = <span dir="ltr">{formatIQD(bundle.total_cost)}</span></p>
          <p>{source === "wholesaler" ? "ربح الممثل" : "الربح"} = الإيراد − {source === "wholesaler" ? "حصة الإدارة" : "التكلفة"} = <span dir="ltr">{formatIQD(bundle.total_profit)}</span></p>
        </div>
        {cancelledCount > 0 && (
          <p className="mt-2 text-amber-800">تم استبعاد {cancelledCount} قطعة ملغاة من إجمالي الباقة.</p>
        )}
      </CalculationDetails>
    </article>
  );
}

// ─── Orders section (used for both retail + wholesaler) ───────────────────────

interface OrdersSectionProps {
  orders: AdminOrderWithApproval[];
  bundles: AdminBundle[];
  viewMode: ViewMode;
  loading: boolean;
  fetchError: boolean;
  costDraftById: Record<string, string>;
  savingCostId: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  typeFilter: string;
  activeSource: OrderSource;
  onCostInput: (orderId: string, raw: string) => void;
  onSaveCost: (orderId: string) => void;
  onSort: (key: SortKey) => void;
  onRetry: () => void;
  onBundlesChange: (updater: (prev: AdminBundle[]) => AdminBundle[]) => void;
  onApproveBundle: (cgId: string) => void;
  onRejectBundle: (cgId: string) => void;
}

function OrdersSection({
  orders,
  bundles,
  viewMode,
  loading,
  fetchError,
  costDraftById,
  savingCostId,
  sortKey,
  sortDir,
  typeFilter: _typeFilter,
  activeSource,
  onCostInput,
  onSaveCost,
  onSort,
  onRetry,
  onBundlesChange,
  onApproveBundle,
  onRejectBundle,
}: OrdersSectionProps) {
  function sortArrow(key: SortKey) {
    if (sortKey !== key) return <span className="ms-1 opacity-30">↕</span>;
    return <span className="ms-1 opacity-80">{sortDir === "desc" ? "↓" : "↑"}</span>;
  }

  const totalPrice = orders.reduce((s, o) => s + (o.price ?? 0), 0);
  const totalCost = orders.reduce((s, o) => s + (o.cost ?? 0), 0);
  // «الربح» on a rep's order is the REP's margin, not the shop's — bug 11, which Track A
  // fixed on /admin and which lived on here. summariseOrderMoney keeps the two screens on
  // one definition; see frontend/lib/orderMoney.ts and backend/lib/counts.js.
  const money = summariseOrderMoney(orders);
  const labels = moneyLabels(activeSource);
  const isRepView = activeSource === "wholesaler";
  // Unchanged arithmetic — on a rep row this already equalled the rep's margin. What was
  // wrong was the word above it and the absence of the shop's own figure beside it.
  const totalProfit = orders.reduce((s, o) => s + (o.profit ?? 0), 0);
  const isEmpty = viewMode === "bundle" ? bundles.length === 0 : orders.length === 0;

  if (loading) {
    return viewMode === "bundle" ? <BundlesSkeleton /> : <OrdersTableSkeleton />;
  }

  if (fetchError) {
    return (
      <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={onRetry}>إعادة المحاولة</Button>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        title="لا توجد طلبات"
        message="لا توجد طلبات مطابقة للفلاتر المحددة."
      />
    );
  }

  if (viewMode === "bundle") {
    return (
      <div className="space-y-4">
        {bundles.map((b, idx) => (
          <BundleCard
            key={b.checkout_group_id ?? `single-${idx}`}
            bundle={b}
            source={activeSource}
            onBundlesChange={onBundlesChange}
            onApprove={onApproveBundle}
            onReject={onRejectBundle}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div
        className="surface-card hidden overflow-x-auto rounded-2xl md:block"
        tabIndex={0}
        role="region"
        aria-label="جدول الطلبات"
      >
        <table className="w-full min-w-[820px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-ink/10 bg-ink/[0.04] text-right text-xs uppercase tracking-wide text-[var(--shop-muted)]">
              <th className="px-4 py-3 font-semibold">الاسم الكامل</th>
              <th className="px-4 py-3 font-semibold">المنتج</th>
              <th
                className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                onClick={() => onSort("price")}
              >
                {labels.price} {sortArrow("price")}
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                onClick={() => onSort("cost")}
              >
                {labels.cost} {sortArrow("cost")}
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 font-semibold hover:text-ink/90"
                onClick={() => onSort("profit")}
              >
                {labels.profit} {sortArrow("profit")}
              </th>
              <th className="px-4 py-3 font-semibold">الحالة</th>
              <th className="px-4 py-3 font-semibold">تعديل التكلفة</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                className="border-b border-ink/5 transition-colors odd:bg-cream/40 last:border-0 hover:bg-peach/25"
              >
                <td className="px-4 py-3 font-medium text-ink">
                  {order.studentName}
                  {order.workingStaffName && (
                    <span className="mt-1 block text-[11px] font-medium text-orange-ink">
                      ⚙ الموظف {order.workingStaffName} يعمل عليه الآن
                    </span>
                  )}
                </td>
                <td className="min-w-[260px] px-4 py-3 text-ink-soft">
                  <span>{order.productName}</span>
                  <OrderMoneyExplanation
                    price={order.price}
                    cost={order.cost}
                    profit={order.profit}
                    calculation={order.calculation}
                    source={activeSource}
                    className="mt-2"
                  />
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">{formatIQD(order.price)}</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                  {order.cost != null ? formatIQD(order.cost) : "—"}
                </td>
                <td
                  className={`px-4 py-3 font-semibold tabular-nums ${profitColor(order.profit)}`}
                  dir="ltr"
                >
                  {order.profit != null ? formatIQD(order.profit) : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-medium text-muted">
                      {ORDER_STATUS_LABELS[order.status]}
                    </span>
                    {order.wholesalerApproval && (
                      <ApprovalBadge approval={order.wholesalerApproval} />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      className="max-w-[8rem]"
                      value={costDraftById[order.id] ?? ""}
                      onChange={(e) => onCostInput(order.id, e.target.value)}
                      placeholder="د.ع"
                      dir="ltr"
                      aria-label="التكلفة"
                    />
                    <Button
                      className="min-h-9 px-3 py-2 text-xs"
                      loading={savingCostId === order.id}
                      onClick={() => onSaveCost(order.id)}
                    >
                      حفظ
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink/20 bg-ink/[0.04] font-semibold text-sm">
              <td className="px-4 py-3 text-muted" colSpan={2}>
                الإجمالي ({orders.length} قطعة)
                {isRepView && (
                  <span className="ms-2 font-normal text-[var(--shop-muted)]">
                    · دخل المحل{" "}
                    <span className="font-semibold text-ink tabular-nums" dir="ltr">
                      {formatIQD(money.shopIncome)}
                    </span>
                  </span>
                )}
              </td>
              <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                {formatIQD(totalPrice)}
              </td>
              <td className="px-4 py-3 tabular-nums text-ink-soft" dir="ltr">
                {formatIQD(totalCost)}
              </td>
              <td
                className={`px-4 py-3 tabular-nums ${profitColor(totalProfit)}`}
                dir="ltr"
              >
                {formatIQD(totalProfit)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {orders.map((order) => (
          <article
            key={order.id}
            className="surface-card card-lift rounded-2xl p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{order.studentName}</p>
                {order.workingStaffName && (
                  <p className="text-[11px] font-medium text-orange-ink">
                    ⚙ الموظف {order.workingStaffName} يعمل عليه الآن
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted">{formatDateShort(order.createdAt)}</span>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {order.productName}
              {order.wholesalerName ? ` · ${order.wholesalerName}` : ""}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-[var(--shop-muted)]">{labels.price}: </span>
                <span className="tabular-nums" dir="ltr">{formatIQD(order.price)}</span>
              </div>
              <div>
                <span className="text-[var(--shop-muted)]">{labels.cost}: </span>
                <span className="tabular-nums" dir="ltr">{order.cost != null ? formatIQD(order.cost) : "—"}</span>
              </div>
              <div className="col-span-2">
                <span className="text-[var(--shop-muted)]">{labels.profit}: </span>
                <span
                  className={`font-semibold tabular-nums ${profitColor(order.profit)}`}
                  dir="ltr"
                >
                  {order.profit != null ? formatIQD(order.profit) : "—"}
                </span>
              </div>
            </div>
            <OrderMoneyExplanation
              price={order.price}
              cost={order.cost}
              profit={order.profit}
              calculation={order.calculation}
              source={activeSource}
              className="mt-3"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
              <span className="text-sm text-[var(--shop-muted)]">تعديل التكلفة:</span>
              <Input
                type="text"
                inputMode="numeric"
                className="max-w-[7rem]"
                value={costDraftById[order.id] ?? ""}
                onChange={(e) => onCostInput(order.id, e.target.value)}
                placeholder="د.ع"
                dir="ltr"
                aria-label="التكلفة"
              />
              <Button
                className="min-h-9 px-3 py-2 text-xs"
                loading={savingCostId === order.id}
                onClick={() => onSaveCost(order.id)}
              >
                حفظ
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--shop-muted)]">
                {ORDER_STATUS_LABELS[order.status]} · {formatDateShort(order.createdAt)}
              </span>
              {order.wholesalerApproval && (
                <ApprovalBadge approval={order.wholesalerApproval} />
              )}
            </div>
          </article>
        ))}

        {/* Mobile summary card */}
        <div className="surface-card rounded-2xl border-2 border-ink/10 p-4 text-sm">
          <p className="mb-3 font-semibold text-ink">
            الإجمالي — {orders.length} قطعة
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[var(--shop-muted)]">{labels.price}: </span>
              <span className="tabular-nums" dir="ltr">{formatIQD(totalPrice)}</span>
            </div>
            <div>
              <span className="text-[var(--shop-muted)]">{labels.cost}: </span>
              <span className="tabular-nums" dir="ltr">{formatIQD(totalCost)}</span>
            </div>
            <div className="col-span-2">
              <span className="text-[var(--shop-muted)]">{labels.profit}: </span>
              <span
                className={`font-semibold tabular-nums ${profitColor(totalProfit)}`}
                dir="ltr"
              >
                {formatIQD(totalProfit)}
              </span>
            </div>
            {isRepView && (
              <div className="col-span-2 border-t border-line pt-2">
                <span className="text-[var(--shop-muted)]">دخل المحل: </span>
                <span className="font-semibold tabular-nums text-ink" dir="ltr">
                  {formatIQD(money.shopIncome)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function AdminOrdersContent() {
  const searchParams = useSearchParams();
  const requestedWholesaler = searchParams.get("wholesaler") || "";
  const initialWholesaler = UUID_RE.test(requestedWholesaler) ? requestedWholesaler : "";

  // Restore the last UI state — but a URL ?wholesaler= (a fresh incoming link, e.g. from
  // a rep's student roster) always wins over a stale snapshot: when present, `stored` stays
  // empty so every field below falls back to its normal default, exactly like today.
  const [stored] = useState<StoredOrdersState>(() =>
    initialWholesaler ? {} : readStoredOrdersState()
  );

  // TRUE after the first successful load — a restored wholesalerId/batchId is only
  // pruned against FRESH data, never against the empty pre-fetch state.
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Source tab
  const [activeSource, setActiveSource] = useState<OrderSource>(
    initialWholesaler ? "wholesaler" : stored.activeSource ?? "retail"
  );

  // Shared filters (per-source)
  const [wholesalerId, setWholesalerId] = useState(initialWholesaler || stored.wholesalerId || "");
  const [dateFrom, setDateFrom] = useState(stored.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(stored.dateTo ?? "");

  // Item-mode-only
  const [status, setStatus] = useState<OrderStatus | "">(stored.status ?? "");
  const [typeFilter, setTypeFilter] = useState(stored.typeFilter ?? "");
  const [zoneFilter, setZoneFilter] = useState<EmbroideryZone | "">(stored.zoneFilter ?? "");

  // Approval filter (wholesaler source only)
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>(stored.approvalFilter ?? "");

  // Reject reason modal
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectLoading, setRejectLoading] = useState(false);

  // Reps drill-down (ممثلين tab): selected batch + the reps→batches landing grid
  const [batchId, setBatchId] = useState(initialWholesaler ? "" : stored.batchId ?? "");
  const [repsOverview, setRepsOverview] = useState<RepOverview[]>([]);

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>(stored.viewMode ?? "item");

  // Data — separate per source
  const [retailOrders, setRetailOrders] = useState<AdminOrderWithApproval[]>([]);
  const [wholesalerOrders, setWholesalerOrders] = useState<AdminOrderWithApproval[]>([]);
  const [retailBundles, setRetailBundles] = useState<AdminBundle[]>([]);
  const [wholesalerBundles, setWholesalerBundles] = useState<AdminBundle[]>([]);
  const [wholesalers, setWholesalers] = useState<AdminWholesaler[]>([]);

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  // Item mode extras
  const [costDraftById, setCostDraftById] = useState<Record<string, string>>({});
  const [savingCostId, setSavingCostId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(stored.sortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(stored.sortDir ?? "desc");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setFetchError(false);
    try {
      const [wholesalersData, repsData] = await Promise.all([
        getAdminWholesalers(),
        getRepsOverview(),
      ]);
      setWholesalers(wholesalersData);
      setRepsOverview(repsData);

      if (viewMode === "bundle") {
        const [retailB, wholesalerB] = await Promise.all([
          getAdminOrderBundles({
            source: "retail",
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          }),
          getAdminOrderBundles({
            wholesalerId: wholesalerId || undefined,
            batchId: batchId || undefined,
            source: "wholesaler",
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            approval: approvalFilter || undefined,
          }),
        ]);
        setRetailBundles(retailB);
        setWholesalerBundles(wholesalerB);
      } else {
        const [retailData, wholesalerData] = await Promise.all([
          getAdminOrders({
            source: "retail",
            status: status || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            type: typeFilter || undefined,
            zone: zoneFilter || undefined,
          }),
          getAdminOrders({
            wholesalerId: wholesalerId || undefined,
            batchId: batchId || undefined,
            source: "wholesaler",
            status: status || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            type: typeFilter || undefined,
            zone: zoneFilter || undefined,
            approval: approvalFilter || undefined,
          }),
        ]);
        setRetailOrders(retailData);
        setWholesalerOrders(wholesalerData);
        // Merge cost drafts for both sets
        const allOrders = [...retailData, ...wholesalerData];
        setCostDraftById(
          Object.fromEntries(
            allOrders.map((o) => [o.id, o.cost != null ? String(o.cost) : ""])
          )
        );
      }
      setLoadedOnce(true);
    } catch (e) {
      if (!silent) toast.error(getApiErrorMessage(e, "تعذر تحميل الطلبات"));
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [viewMode, wholesalerId, batchId, status, dateFrom, dateTo, typeFilter, zoneFilter, approvalFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Internal links from a representative's student list land directly on the
  // representative-orders tab and keep working on client-side navigation.
  useEffect(() => {
    if (!UUID_RE.test(requestedWholesaler)) return;
    setActiveSource("wholesaler");
    setWholesalerId(requestedWholesaler);
    setBatchId("");
    setApprovalFilter("approved");
  }, [requestedWholesaler]);

  // Mirror the UI state so back-navigation (e.g. from an order opened via
  // /staff/orders/[id]?from=/admin/orders) restores it exactly — single snapshot,
  // same approach as StationConsole's sessionStorage mirror.
  useEffect(() => {
    try {
      const snapshot: StoredOrdersState = {
        activeSource,
        wholesalerId,
        dateFrom,
        dateTo,
        status,
        typeFilter,
        zoneFilter,
        approvalFilter,
        batchId,
        viewMode,
        sortKey,
        sortDir,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* storage full/unavailable — persistence is best-effort */
    }
  }, [
    activeSource,
    wholesalerId,
    dateFrom,
    dateTo,
    status,
    typeFilter,
    zoneFilter,
    approvalFilter,
    batchId,
    viewMode,
    sortKey,
    sortDir,
  ]);

  // A restored wholesalerId/batchId might no longer exist (rep deleted, data changed
  // since the snapshot was taken) — degrade gracefully to the all-reps view instead of
  // an inert filter. Gated on loadedOnce so this never runs against the empty pre-fetch
  // lists and wipes a legitimately restored selection.
  useEffect(() => {
    if (!loadedOnce || !wholesalerId) return;
    if (!wholesalers.some((w) => w.id === wholesalerId)) {
      setWholesalerId("");
      setBatchId("");
      setApprovalFilter("");
      return;
    }
    const rep = repsOverview.find((r) => r.id === wholesalerId);
    if (batchId && rep && !rep.batches.some((b) => b.id === batchId)) {
      setBatchId("");
    }
  }, [loadedOnce, wholesalers, repsOverview, wholesalerId, batchId]);

  // Live polling — refresh every 12 s silently
  usePolling(() => load(true), 12000);

  async function handleSaveCost(orderId: string) {
    const raw = (costDraftById[orderId] ?? "").trim().replace(/[^\d]/g, "");
    if (raw === "") {
      toast.error("أدخل رقماً للتكلفة (دينار عراقي)");
      return;
    }
    const cost = Number.parseInt(raw, 10);
    if (Number.isNaN(cost) || cost < 0) {
      toast.error("تكلفة غير صالحة");
      return;
    }
    setSavingCostId(orderId);
    try {
      await updateOrderCost(orderId, cost);
      toast.success("تم حفظ التكلفة");
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ التكلفة"));
    } finally {
      setSavingCostId(null);
    }
  }

  function handleCostInput(orderId: string, raw: string) {
    const digits = raw.replace(/[^\d]/g, "");
    setCostDraftById((p) => ({ ...p, [orderId]: digits }));
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function handleApproveBundle(cgId: string) {
    try {
      await approveOrderAdmin(cgId);
      toast.success("تمت الموافقة على الطلب");
      await load(true);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر الموافقة على الطلب"));
    }
  }


  function handleRejectBundle(cgId: string) {
    setRejectTarget(cgId);
  }

  async function handleConfirmReject(reason: string) {
    if (!rejectTarget) return;
    setRejectLoading(true);
    try {
      await rejectOrderAdmin(rejectTarget, reason);
      toast.success("تم إرجاع الطلب");
      setRejectTarget(null);
      await load(true);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إرجاع الطلب"));
    } finally {
      setRejectLoading(false);
    }
  }

  function sortOrders(list: AdminOrderWithApproval[]) {
    if (!sortKey) return list;
    return [...list].sort((a, b) => {
      const av = (a[sortKey] as number | null) ?? -Infinity;
      const bv = (b[sortKey] as number | null) ?? -Infinity;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }

  const activeOrders = sortOrders(activeSource === "retail" ? retailOrders : wholesalerOrders);
  const activeBundles = activeSource === "retail" ? retailBundles : wholesalerBundles;
  // The headline tiles said «الربح» over a figure that, on the rep tab, is the REP's margin
  // — bug 11 again. `دخل المحل` is what the shop actually takes: حصة الإدارة on a rep's
  // order, the full price on a retail one. See frontend/lib/orderMoney.ts.
  const activeIsRep = activeSource === "wholesaler";
  const activeLabels = moneyLabels(activeSource);
  const activeMoney = summariseOrderMoney(activeOrders);
  const bundleShopIncome = activeBundles.reduce(
    (s, b) => s + (activeIsRep ? b.total_cost : b.total_price),
    0
  );

  function handleBundlesChange(updater: (prev: AdminBundle[]) => AdminBundle[]) {
    if (activeSource === "retail") {
      setRetailBundles(updater);
    } else {
      setWholesalerBundles(updater);
    }
  }

  const wholesalerOptions = [
    { value: "", label: "كل الممثلين" },
    ...wholesalers.map((w) => ({ value: w.id, label: w.name })),
  ];

  const statusOptions = [
    { value: "", label: "كل الحالات" },
    ...ORDER_STATUS_OPTIONS.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
  ];

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="الطلبات"
        subtitle="مقسّمة حسب المصدر — تجزئة وممثلين"
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/custom-order"
              className="inline-flex shrink-0 items-center rounded-full bg-orange-ink px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              طلب مخصص
            </Link>
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-ink/15 bg-beige px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink disabled:opacity-50"
            >
              <svg
                aria-hidden
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-500 ${loading ? "animate-spin" : "group-hover:rotate-180"}`}
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

      {/* ── Source tabs ── */}
      <div className="mb-6 flex items-stretch gap-0 overflow-hidden rounded-2xl border border-line bg-surface-sink">
        {SOURCE_TABS.map((tab) => {
          const count = tab.value === "retail"
            ? (viewMode === "bundle" ? retailBundles.length : retailOrders.length)
            : (viewMode === "bundle" ? wholesalerBundles.length : wholesalerOrders.length);
          const isActive = activeSource === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveSource(tab.value)}
              className={`flex flex-1 flex-col items-start gap-0.5 border-e border-line px-4 py-3.5 last:border-e-0 transition-colors min-h-[44px] ${
                isActive
                  ? "bg-orange-ink text-white"
                  : "bg-surface hover:bg-beige text-ink"
              }`}
            >
              <span className={`text-sm font-bold ${isActive ? "text-white" : "text-ink"}`}>
                {tab.label}
              </span>
              <span className={`text-xs ${isActive ? "text-white/80" : "text-ink-soft"}`}>
                {tab.subtitle}
                {!loading && (
                  <span className={`ms-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                    isActive ? "bg-white/20 text-white" : "bg-orange-ink/10 text-orange-ink"
                  }`}>
                    {count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── View mode toggle ── */}
      <div className="mb-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setViewMode("item")}
          className={`inline-flex min-h-[44px] items-center rounded-full border px-5 py-2 text-sm font-semibold transition-colors ${
            viewMode === "item"
              ? "border-orange-ink bg-orange-ink text-white"
              : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
          }`}
        >
          عرض كقطع
        </button>
        <button
          type="button"
          onClick={() => setViewMode("bundle")}
          className={`inline-flex min-h-[44px] items-center rounded-full border px-5 py-2 text-sm font-semibold transition-colors ${
            viewMode === "bundle"
              ? "border-orange-ink bg-orange-ink text-white"
              : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
          }`}
        >
          عرض كباقات
        </button>
      </div>

      {/* ── Filters ── */}
      <div className="surface-card mb-4 grid gap-3 rounded-2xl p-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Only show wholesaler filter on the wholesaler tab */}
        {activeSource === "wholesaler" && (
          <Select
            label="الممثل"
            options={wholesalerOptions}
            value={wholesalerId}
            onChange={(e) => setWholesalerId(e.target.value)}
          />
        )}
        {viewMode === "item" && (
          <Select
            label="الحالة"
            options={statusOptions}
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | "")}
          />
        )}
        <div dir="rtl" className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted">من تاريخ</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-line bg-beige px-3 py-2 text-end text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
          />
        </div>
        <div dir="rtl" className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted">إلى تاريخ</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-line bg-beige px-3 py-2 text-end text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
          />
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <Button onClick={() => load()} loading={loading}>
            تطبيق الفلاتر
          </Button>
        </div>
      </div>

      {/* ── Approval filter chips — wholesaler source only ── */}
      {activeSource === "wholesaler" && (
        <div className="mb-5 flex flex-wrap gap-2">
          {(
            [
              { value: "" as ApprovalFilter, label: "كل حالات الموافقة" },
              { value: "pending" as ApprovalFilter, label: "بانتظار موافقة الممثل" },
              { value: "approved" as ApprovalFilter, label: "موافق عليه" },
              { value: "rejected" as ApprovalFilter, label: "مُرجَع" },
            ] as const
          ).map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setApprovalFilter(chip.value)}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                approvalFilter === chip.value
                  ? "border-orange-ink bg-orange-ink text-white"
                  : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Component type chips — item mode only ── */}
      {viewMode === "item" && (
        <div className="mb-5 flex flex-wrap gap-2">
          {PRODUCT_TYPE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setTypeFilter(chip.value)}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                typeFilter === chip.value
                  ? "border-orange-ink bg-orange-ink text-white"
                  : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Embroidery-zone / pleat filter — item mode (وشاح R/L/back · قبعة جانب/أعلى · روب كسرات) ── */}
      {viewMode === "item" && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setZoneFilter("")}
            className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              zoneFilter === ""
                ? "border-orange-ink bg-orange-ink text-white"
                : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
            }`}
          >
            كل التطريز
          </button>
          {EMBROIDERY_ZONE_ORDER.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoneFilter(z)}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                zoneFilter === z
                  ? "border-orange-ink bg-orange-ink text-white"
                  : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
              }`}
            >
              {EMBROIDERY_ZONE_LABELS[z]}
            </button>
          ))}
        </div>
      )}

      {/* ── Totals summary row (quick overview for active tab) ── */}
      {!loading && !fetchError && (
        <div className="mb-5 grid grid-cols-2 gap-3 rounded-2xl border border-orange-ink/15 bg-orange-ink/5 p-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">
              {activeSource === "retail" ? "طلبات التجزئة" : "طلبات الممثلين"}
            </p>
            <p className="mt-0.5 font-bold tabular-nums text-ink">
              {viewMode === "bundle" ? activeBundles.length : activeOrders.length} طلب
            </p>
          </div>
          {viewMode === "item" && (
            <>
              <div>
                <p className="text-xs text-muted">
                  {activeIsRep ? "دفع الطلاب" : "إجمالي الإيراد"}
                </p>
                <p className="mt-0.5 font-bold tabular-nums text-ink" dir="ltr">
                  {formatIQD(activeMoney.grossCollected)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">
                  {activeIsRep ? "دخل المحل" : "إجمالي التكلفة"}
                </p>
                <p
                  className={`mt-0.5 font-bold tabular-nums ${activeIsRep ? "text-ink" : "text-ink-soft"}`}
                  dir="ltr"
                >
                  {formatIQD(
                    activeIsRep
                      ? activeMoney.shopIncome
                      : activeOrders.reduce((s, o) => s + (o.cost ?? 0), 0)
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">{activeLabels.profit}</p>
                <p
                  className={`mt-0.5 font-bold tabular-nums ${profitColor(activeOrders.reduce((s, o) => s + (o.profit ?? 0), 0))}`}
                  dir="ltr"
                >
                  {formatIQD(activeOrders.reduce((s, o) => s + (o.profit ?? 0), 0))}
                </p>
                {activeIsRep && (
                  <p className="mt-0.5 text-[0.7rem] leading-tight text-muted">
                    يبقى عند الممثل
                  </p>
                )}
              </div>
            </>
          )}
          {viewMode === "bundle" && (
            <>
              <div>
                <p className="text-xs text-muted">
                  {activeIsRep ? "دفع الطلاب" : "إجمالي الإيراد"}
                </p>
                <p className="mt-0.5 font-bold tabular-nums text-ink" dir="ltr">
                  {formatIQD(activeBundles.reduce((s, b) => s + b.total_price, 0))}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">
                  {activeIsRep ? "دخل المحل" : "إجمالي التكلفة"}
                </p>
                <p
                  className={`mt-0.5 font-bold tabular-nums ${activeIsRep ? "text-ink" : "text-ink-soft"}`}
                  dir="ltr"
                >
                  {formatIQD(bundleShopIncome)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">{activeLabels.profit}</p>
                <p
                  className={`mt-0.5 font-bold tabular-nums ${profitColor(activeBundles.reduce((s, b) => s + b.total_profit, 0))}`}
                  dir="ltr"
                >
                  {formatIQD(activeBundles.reduce((s, b) => s + b.total_profit, 0))}
                </p>
                {activeIsRep && (
                  <p className="mt-0.5 text-[0.7rem] leading-tight text-muted">
                    يبقى عند الممثل
                  </p>
                )}
              </div>
            </>
          )}
          <CalculationDetails
            summary="كيف حُسبت إجماليات هذه الصفحة؟"
            className="col-span-2 bg-surface sm:col-span-4"
          >
            <p>
              هذه الأرقام هي مجموع كل النتائج المطابقة للمصدر والفلاتر الحالية، وليست أول صفحة فقط.
              {activeSource === "wholesaler" && approvalFilter === "approved"
                ? " وتشمل الطلبات الموافق عليها فقط."
                : activeSource === "wholesaler" && approvalFilter
                  ? ` وتشمل حالة الموافقة المحددة فقط (${APPROVAL_BADGE[approvalFilter].label}).`
                  : activeSource === "wholesaler"
                    ? " وبسبب عدم اختيار حالة موافقة، قد تشمل الموافق عليها والمعلّقة والمُرجعة؛ هذا عرض تشغيلي وليس رصيد تسوية."
                    : " والطلبات الملغاة مستبعدة افتراضياً ما لم يُختر فلتر الحالة الملغاة."
              }
            </p>
            <div className="mt-2 space-y-1 rounded-lg bg-ink/[0.04] px-2.5 py-2 text-ink">
              <p>الإيراد = مجموع أسعار {viewMode === "bundle" ? "الباقات" : "الطلبات"} الظاهرة.</p>
              <p>{activeSource === "wholesaler" ? "حصة الإدارة" : "التكلفة"} = مجموع المبلغ المحاسبي المخزن لكل طلب.</p>
              <p>{activeSource === "wholesaler" ? "ربح الممثل" : "الربح"} = الإيراد − {activeSource === "wholesaler" ? "حصة الإدارة" : "التكلفة"}.</p>
              {activeIsRep && (
                <>
                  <p className="font-semibold">
                    دخل المحل = حصة الإدارة. أما «ربح الممثل» فيبقى عند الممثل ولا يدخل المحل.
                  </p>
                  <p>الطالب يدفع للممثل، والممثل يسلّم حصة الإدارة للمحل. الفرق ربحه هو.</p>
                </>
              )}
              {!activeIsRep && activeMoney.rows > 0 && activeMoney.rowsCosted === 0 && (
                <p className="font-semibold">
                  لم تُدخل تكلفة إنتاج لأي طلب هنا، لذلك «الربح» أعلاه إيراد وليس ربحاً.
                </p>
              )}
              {viewMode === "bundle" && <p>داخل كل باقة، القطع الملغاة ظاهرة للمراجعة لكنها مستبعدة من المبالغ.</p>}
            </div>
          </CalculationDetails>
        </div>
      )}

      {/* ── ممثلين drill-down: rep grid → click a rep → their students' orders ── */}
      {activeSource === "wholesaler" && !wholesalerId ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {repsOverview.length === 0 ? (
            <p className="text-sm text-ink-soft">لا يوجد ممثلون بعد.</p>
          ) : (
            repsOverview.map((rep) => (
              <button
                key={rep.id}
                type="button"
                onClick={() => {
                  setWholesalerId(rep.id);
                  setBatchId("");
                  // default to الموافق عليها so admin's count matches what the rep sees (his approved list)
                  setApprovalFilter("approved");
                }}
                className="surface-card card-lift rounded-2xl p-4 text-start transition-colors hover:border-orange-ink/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display-ar text-base font-bold text-ink">{rep.name}</span>
                  <span className="shrink-0 rounded-full bg-orange-ink/10 px-2 py-0.5 text-xs font-bold tabular-nums text-orange-ink">
                    {rep.order_count} طلب
                  </span>
                </div>
                {rep.batches.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rep.batches.map((b) => (
                      <span
                        key={b.id}
                        className="rounded-full border border-line bg-surface-sink px-2 py-0.5 text-[11px] text-ink-soft"
                      >
                        {b.name_ar}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs font-medium text-orange-ink">عرض طلبات الممثل ←</p>
              </button>
            ))
          )}
        </div>
      ) : (
        <>
          {/* When a rep is selected: back-to-all + their batch (دفعة) chips */}
          {activeSource === "wholesaler" && wholesalerId && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setWholesalerId("");
                  setBatchId("");
                  setApprovalFilter("");
                }}
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-ink-soft transition-colors hover:border-orange-ink/40"
              >
                → كل الممثلين
              </button>
              {(repsOverview.find((r) => r.id === wholesalerId)?.batches.length ?? 0) > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setBatchId("")}
                    className={`min-h-9 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      batchId === ""
                        ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                        : "border-line bg-surface-sink text-ink-soft hover:border-orange-ink/40"
                    }`}
                  >
                    كل الدفعات
                  </button>
                  {repsOverview
                    .find((r) => r.id === wholesalerId)
                    ?.batches.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBatchId(b.id)}
                        className={`min-h-9 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          batchId === b.id
                            ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                            : "border-line bg-surface-sink text-ink-soft hover:border-orange-ink/40"
                        }`}
                      >
                        {b.name_ar}
                      </button>
                    ))}
                </>
              )}
            </div>
          )}
          <OrdersSection
            orders={activeOrders}
            bundles={activeBundles}
            viewMode={viewMode}
            loading={loading}
            fetchError={fetchError}
            costDraftById={costDraftById}
            savingCostId={savingCostId}
            sortKey={sortKey}
            sortDir={sortDir}
            typeFilter={typeFilter}
            activeSource={activeSource}
            onCostInput={handleCostInput}
            onSaveCost={handleSaveCost}
            onSort={handleSort}
            onRetry={load}
            onBundlesChange={handleBundlesChange}
            onApproveBundle={handleApproveBundle}
            onRejectBundle={handleRejectBundle}
          />
        </>
      )}

      {/* Cross-source counts for admin awareness */}
      {!loading && !fetchError && (
        <div className="mt-6 rounded-xl border border-line bg-surface-sink px-4 py-3 text-xs text-muted">
          <span className="font-semibold text-ink-soft">إجمالي النظام: </span>
          طلبات التجزئة {viewMode === "bundle" ? retailBundles.length : retailOrders.length}
          {" · "}
          طلبات الممثلين {viewMode === "bundle" ? wholesalerBundles.length : wholesalerOrders.length}
          {" · "}
          المجموع {
            viewMode === "bundle"
              ? retailBundles.length + wholesalerBundles.length
              : retailOrders.length + wholesalerOrders.length
          }
        </div>
      )}

      {/* Reject reason modal */}
      <RejectReasonModal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleConfirmReject}
        loading={rejectLoading}
      />

    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense
      fallback={
        <div dir="rtl" lang="ar" className="space-y-6">
          <PageHeader title="الطلبات" subtitle="جارٍ تجهيز فلاتر الطلبات…" />
          <OrdersTableSkeleton />
        </div>
      }
    >
      <AdminOrdersContent />
    </Suspense>
  );
}
