"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatIQD } from "@/lib/format";
import type { StaffBreak, StaffBreakBalance } from "@/lib/types";

const DURATION_CHIPS = [15, 30, 60, 120];

export function minutesLabel(minutes: number | null | undefined) {
  const total = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours} ساعة و${mins} دقيقة`;
  if (hours) return `${hours} ساعة`;
  return `${mins} دقيقة`;
}

/** mm:ss-style clock for the live "you are out" timer. */
function clockLabel(minutes: number) {
  const total = Math.max(0, minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * الخروج المؤقت — the button beside بصمة, plus the monthly allowance bar.
 *
 * Three states in one place, because they are three steps of one action:
 *   nothing open  → «خروج مؤقت» opens the request form
 *   requested     → waiting for the admin, with the «خرجت بدون موافقة» escape hatch
 *   out           → live timer + «رجعت»
 */
export function StaffBreakControl({
  balance,
  activeBreak,
  busy,
  deductionPerMinute,
  onRequest,
  onStart,
  onEnd,
  onCancel,
  compact = false,
  className = "",
}: {
  balance: StaffBreakBalance;
  activeBreak: StaffBreak | null;
  busy: boolean;
  deductionPerMinute: number;
  onRequest: (input: { reasonAr: string; requestedMinutes: number | null }) => void;
  onStart: (breakId: string, withoutApproval: boolean) => void;
  onEnd: (breakId: string) => void;
  onCancel: (breakId: string) => void;
  compact?: boolean;
  className?: string;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [requestedMinutes, setRequestedMinutes] = useState<number | null>(null);
  // Live timer. Seeded from the server's openMinutes so the first paint is right,
  // then recomputed from leftAt on every tick — reading the clock during render
  // would be impure and would drift after the tab sleeps.
  const [elapsed, setElapsed] = useState(activeBreak?.openMinutes ?? 0);

  const isOut = activeBreak?.state === "out";
  const isWaiting = activeBreak?.state === "requested";
  const approved = activeBreak?.approval === "approved";
  const rejected = activeBreak?.approval === "rejected";
  const leftAt = activeBreak?.leftAt ?? null;

  useEffect(() => {
    if (!isOut || !leftAt) {
      setElapsed(0);
      return;
    }
    const startedAt = new Date(leftAt).getTime();
    const compute = () =>
      setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 60000)));
    compute();
    const id = setInterval(compute, 30000);
    return () => clearInterval(id);
  }, [isOut, leftAt]);

  const remaining = balance.remainingMinutes;
  const usedPct = balance.monthlyMinutes
    ? Math.min(100, Math.round((balance.usedMinutes / balance.monthlyMinutes) * 100))
    : 100;
  // What the minutes currently outside will cost if this break is never approved.
  const liveRisk = isOut
    ? Math.max(0, elapsed - (approved ? remaining : 0)) * deductionPerMinute
    : 0;

  function submitRequest() {
    onRequest({ reasonAr: reason.trim(), requestedMinutes });
    setFormOpen(false);
    setReason("");
    setRequestedMinutes(null);
  }

  // ── currently outside the shop ────────────────────────────────────────────
  if (isOut && activeBreak) {
    return (
      <div
        className={`rounded-xl border border-orange-ink/30 bg-peach/40 p-3 ${className}`}
        aria-label="أنت خارج المحل"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink">
              أنت خارج المحل — {clockLabel(elapsed)}
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">
              {activeBreak.leftWithoutApproval
                ? liveRisk > 0
                  ? `بدون موافقة · الخصم حتى الآن ${formatIQD(liveRisk)}`
                  : "بدون موافقة — كل دقيقة تُخصم حتى يوافق المدير"
                : liveRisk > 0
                  ? `تجاوزت رصيدك · الخصم حتى الآن ${formatIQD(liveRisk)}`
                  : `مصرَّح · بقي من رصيدك ${minutesLabel(Math.max(0, remaining - elapsed))}`}
            </p>
          </div>
          <Button type="button" onClick={() => onEnd(activeBreak.id)} loading={busy} disabled={busy} size="sm">
            رجعت
          </Button>
        </div>
        {activeBreak.openTooLong && (
          <p className="mt-2 rounded-lg border border-danger/25 bg-danger/5 px-2.5 py-1.5 text-xs font-bold text-danger">
            مضى وقت طويل — سجّل رجوعك أو راجع المدير
          </p>
        )}
      </div>
    );
  }

  // ── request sent, waiting on the admin ────────────────────────────────────
  if (isWaiting && activeBreak) {
    return (
      <div
        className={`rounded-xl border border-orange-ink/25 bg-surface/75 p-3 ${className}`}
        aria-label="طلب خروج مؤقت"
      >
        <p className="text-sm font-bold text-ink">
          {rejected
            ? "المدير رفض طلب الخروج"
            : approved
              ? "وافق المدير — اضغط «طلعت» عند مغادرتك"
              : "بانتظار موافقة المدير…"}
        </p>
        {activeBreak.requestedMinutes ? (
          <p className="mt-0.5 text-xs text-ink-soft">
            طلبت {minutesLabel(activeBreak.requestedMinutes)}
            {activeBreak.reasonAr ? ` · ${activeBreak.reasonAr}` : ""}
          </p>
        ) : null}
        {activeBreak.decisionNoteAr && (
          <p className="mt-1 text-xs text-ink-soft">ملاحظة المدير: {activeBreak.decisionNoteAr}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {approved ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onStart(activeBreak.id, false)}
              loading={busy}
              disabled={busy}
            >
              طلعت الآن
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => onStart(activeBreak.id, true)}
              disabled={busy}
            >
              خرجت بدون موافقة
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onCancel(activeBreak.id)}
            disabled={busy}
          >
            إلغاء الطلب
          </Button>
        </div>
        {!approved && (
          <p className="mt-2 text-xs font-semibold text-danger">
            الخروج بدون موافقة يُخصم من راتبك ({formatIQD(deductionPerMinute)} للدقيقة) حتى يوافق
            المدير.
          </p>
        )}
      </div>
    );
  }

  // ── the request form ──────────────────────────────────────────────────────
  if (formOpen) {
    return (
      <div
        className={`rounded-xl border border-orange-ink/25 bg-surface/75 p-3 ${className}`}
        aria-label="طلب خروج مؤقت"
      >
        <p className="text-sm font-bold text-ink">كم تحتاج؟</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DURATION_CHIPS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setRequestedMinutes(requestedMinutes === m ? null : m)}
              className={`min-h-11 rounded-full border px-4 text-sm font-bold transition ${
                requestedMinutes === m
                  ? "border-orange-ink bg-orange-ink text-white"
                  : "border-orange-ink/25 bg-surface text-ink"
              }`}
            >
              {minutesLabel(m)}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-xs font-semibold text-ink-soft" htmlFor="break-reason">
          السبب (اختياري)
        </label>
        <input
          id="break-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoComplete="off"
          maxLength={200}
          placeholder="مثلاً: مراجعة الطبيب"
          className="mt-1 min-h-11 w-full rounded-xl border border-orange-ink/20 bg-surface px-3 text-sm text-ink"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={submitRequest} loading={busy} disabled={busy}>
            إرسال الطلب للمدير
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFormOpen(false)}
            disabled={busy}
          >
            تراجع
          </Button>
        </div>
      </div>
    );
  }

  // ── idle: the button beside بصمة + the allowance bar ──────────────────────
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setFormOpen(true)}
        disabled={busy}
      >
        خروج مؤقت
      </Button>
      <div className={compact ? "min-w-32" : "min-w-40 flex-1"}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-ink-soft">رصيد هذا الشهر</span>
          <span className={remaining > 0 ? "font-bold text-ink" : "font-bold text-danger"}>
            {remaining > 0 ? `بقي ${minutesLabel(remaining)}` : "خلص رصيدك"}
          </span>
        </div>
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-orange-ink/15"
          role="progressbar"
          aria-valuenow={balance.usedMinutes}
          aria-valuemin={0}
          aria-valuemax={balance.monthlyMinutes}
          aria-label="رصيد الخروج المؤقت"
        >
          <div
            className={`h-full rounded-full ${remaining > 0 ? "bg-orange-ink" : "bg-danger"}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        {!compact && (
          <p className="mt-1 text-[11px] text-muted">
            استهلكت {minutesLabel(balance.usedMinutes)} من {minutesLabel(balance.monthlyMinutes)}
            {balance.deductionAmount > 0 ? ` · خصم ${formatIQD(balance.deductionAmount)}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
