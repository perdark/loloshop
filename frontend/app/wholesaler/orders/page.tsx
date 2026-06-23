"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getRepOrders,
  approveRepOrder,
  rejectRepOrder,
  bulkRepOrders,
  type RepOrderRow,
} from "@/lib/wholesaler";
import { getApiErrorMessage } from "@/lib/api";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type ApprovalFilter = "pending" | "approved" | "rejected";

function approvalLabel(s: ApprovalFilter): string {
  if (s === "approved") return "موافق عليه";
  if (s === "rejected") return "مرفوض";
  return "بانتظار الموافقة";
}

function approvalPillClass(s: "pending" | "approved" | "rejected"): string {
  if (s === "approved") return "bg-orange-ink/10 text-orange-ink";
  if (s === "rejected") return "border border-danger/40 bg-danger/10 text-danger";
  return "border border-line bg-[var(--shop-sink)] text-ink-soft";
}

function formatPrice(n: number): string {
  return n.toLocaleString("ar-IQ") + " د.ع";
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ar-IQ", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function WholesalerOrdersPage() {
  const [tab, setTab] = useState<ApprovalFilter>("pending");
  const [rows, setRows] = useState<RepOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Reject modal state
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  // Bulk state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Stats derived from a "all" fetch would need extra call — compute from current rows only
  const stats = useMemo(() => {
    const pending = rows.filter((r) => r.approval === "pending").length;
    return { total: rows.length, pending };
  }, [rows]);

  const fetchOrders = useCallback(
    (filter: ApprovalFilter) => {
      setLoading(true);
      setLoadError(false);
      setSelected(new Set());
      getRepOrders(filter)
        .then(setRows)
        .catch((err) => {
          setLoadError(true);
          toast.error(getApiErrorMessage(err, "تعذر تحميل الطلبات"));
        })
        .finally(() => setLoading(false));
    },
    []
  );

  useEffect(() => {
    fetchOrders(tab);
  }, [tab, fetchOrders]);

  // ── Single approve ──
  async function handleApprove(cg: string) {
    try {
      await approveRepOrder(cg);
      toast.success("تمت الموافقة على الطلب");
      fetchOrders(tab);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر الموافقة"));
    }
  }

  // ── Single reject ──
  function openReject(cg: string) {
    setRejectTarget(cg);
    setRejectReason("");
  }

  async function handleRejectConfirm() {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast.error("سبب الإرجاع مطلوب");
      return;
    }
    setRejectBusy(true);
    try {
      await rejectRepOrder(rejectTarget, reason);
      toast.success("تم إرجاع الطلب إلى الطالب");
      setRejectTarget(null);
      setRejectReason("");
      fetchOrders(tab);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إرجاع الطلب"));
    } finally {
      setRejectBusy(false);
    }
  }

  // ── Bulk approve ──
  async function handleBulkApprove() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      const result = await bulkRepOrders(ids, "approve");
      toast.success(`تمت الموافقة على ${result.done} طلب${result.done !== 1 ? "ات" : ""}`);
      setSelected(new Set());
      fetchOrders(tab);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذرت الموافقة الجماعية"));
    }
  }

  // ── Checkbox helpers ──
  function toggleSelect(cg: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cg)) next.delete(cg);
      else next.add(cg);
      return next;
    });
  }

  function toggleAll() {
    const pendingIds = rows
      .filter((r) => r.approval === "pending")
      .map((r) => r.checkout_group_id);
    if (pendingIds.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingIds));
    }
  }

  const pendingRows = rows.filter((r) => r.approval === "pending");
  const allPendingSelected =
    pendingRows.length > 0 &&
    pendingRows.every((r) => selected.has(r.checkout_group_id));

  if (loading) return <PageLoader />;

  if (loadError) {
    return (
      <EmptyState
        title="تعذر تحميل الطلبات"
        message="تحقق من الاتصال ثم حاول مجدداً."
        action={
          <Button variant="ghost" onClick={() => fetchOrders(tab)}>
            إعادة المحاولة
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="section-heading font-display-ar text-xl font-bold text-ink">
        طلبات الطلاب
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="الكل" value={String(stats.total)} />
        <StatCard
          label="بانتظار الموافقة"
          value={String(stats.pending)}
          accent={stats.pending > 0 ? "profit" : "default"}
        />
      </div>

      {/* Tab strip */}
      <div className="surface-card flex gap-1 rounded-2xl p-1.5">
        {(["pending", "approved", "rejected"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all duration-150 ${
              tab === t
                ? "bg-orange-ink text-white shadow-sm"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {approvalLabel(t)}
          </button>
        ))}
      </div>

      {/* Bulk approve bar — shown only in pending tab when items are selected */}
      {tab === "pending" && selected.size > 0 && (
        <div className="sticky top-[72px] z-10 flex items-center justify-between gap-3 rounded-2xl border border-orange-ink/30 bg-orange/10 px-4 py-3 shadow-sm">
          <span className="text-sm font-semibold text-orange-ink">
            {selected.size} طلب محدد
          </span>
          <Button variant="primary" onClick={handleBulkApprove}>
            موافقة جماعية
          </Button>
        </div>
      )}

      {/* Select all row — only in pending tab */}
      {tab === "pending" && pendingRows.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <input
            id="select-all"
            type="checkbox"
            checked={allPendingSelected}
            onChange={toggleAll}
            className="h-5 w-5 rounded accent-orange-ink"
            aria-label="تحديد الكل"
          />
          <label
            htmlFor="select-all"
            className="text-sm font-medium text-ink-soft"
          >
            تحديد الكل
          </label>
        </div>
      )}

      {/* Order list */}
      {rows.length === 0 ? (
        <EmptyState
          message={
            tab === "pending"
              ? "لا توجد طلبات بانتظار الموافقة"
              : tab === "approved"
              ? "لا توجد طلبات موافق عليها"
              : "لا توجد طلبات مرفوضة"
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.checkout_group_id}
              className="surface-card card-lift rounded-2xl p-4"
            >
              <div className="flex items-start gap-3">
                {/* Checkbox (pending only) */}
                {tab === "pending" && (
                  <input
                    type="checkbox"
                    checked={selected.has(row.checkout_group_id)}
                    onChange={() => toggleSelect(row.checkout_group_id)}
                    className="mt-1 h-5 w-5 shrink-0 rounded accent-orange-ink"
                    aria-label={`تحديد طلب ${row.student_name}`}
                  />
                )}

                {/* Card body */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-display-ar font-bold text-ink">
                      {row.student_name}
                    </p>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${approvalPillClass(
                        row.approval
                      )}`}
                    >
                      {approvalLabel(row.approval)}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-ink-soft">
                    {row.product_summary}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-semibold text-orange-ink tabular-nums">
                      {formatPrice(row.total_price)}
                    </span>
                    <span className="text-ink-soft" dir="ltr">
                      {formatDate(row.submitted_at)}
                    </span>
                  </div>

                  {/* Reject reason */}
                  {row.approval === "rejected" && row.reject_reason && (
                    <p className="mt-2 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
                      السبب: {row.reject_reason}
                    </p>
                  )}

                  {/* Action buttons (pending only) */}
                  {row.approval === "pending" && (
                    <div className="mt-3 flex gap-2 border-t border-line pt-3">
                      <Button
                        variant="primary"
                        onClick={() => handleApprove(row.checkout_group_id)}
                        className="flex-1"
                      >
                        موافقة
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => openReject(row.checkout_group_id)}
                        className="flex-1 border border-danger/30 text-danger hover:bg-danger/5"
                      >
                        إرجاع
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Reject reason modal */}
      <Modal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        title="سبب الإرجاع"
        footer={
          <>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setRejectTarget(null)}
              disabled={rejectBusy}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={handleRejectConfirm}
              disabled={rejectBusy || !rejectReason.trim()}
            >
              {rejectBusy ? "جارٍ الإرسال…" : "إرسال"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            اكتب سبب الإرجاع ليظهر للطالب ويتمكن من التعديل وإعادة الإرسال.
          </p>
          <textarea
            className="w-full rounded-xl border border-line bg-cream px-3 py-2.5 text-sm text-ink placeholder:text-ink-soft focus:border-orange-ink focus:outline-none focus:ring-1 focus:ring-orange-ink"
            rows={4}
            placeholder="مثال: يرجى تصحيح اسم الطالب أو تفاصيل التطريز…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            aria-label="سبب الإرجاع"
          />
        </div>
      </Modal>
    </div>
  );
}
