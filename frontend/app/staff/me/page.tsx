"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { getMyActivity, getMyGoal, getMySalary, type MyActivityRow } from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import { ORDER_STATUS_LABELS, SALARY_TXN_LABELS } from "@/lib/constants";
import { formatDateShort, formatIQD } from "@/lib/format";
import type { OrderStatus, StaffGoal, StaffSalary } from "@/lib/types";

function GoalCard({ goal }: { goal: StaffGoal }) {
  const pct = Math.min(100, Math.round((goal.progress / goal.targetCount) * 100));
  const done = goal.achieved;
  const expired = goal.expired;
  return (
    <section
      className={`rounded-2xl border p-5 shadow-[var(--shadow-soft)] ${
        done
          ? "border-emerald-500/40 bg-emerald-50/60"
          : expired
            ? "border-line bg-surface-sink"
            : "border-orange-ink/25 bg-warm-veil"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink">
          {goal.titleAr || "هدف الحافز"}
        </h2>
        {goal.bonusAmount > 0 && (
          <span className="shrink-0 rounded-full border border-orange-ink/30 bg-orange-ink/10 px-2.5 py-1 text-xs font-bold text-orange-ink">
            حافز {formatIQD(goal.bonusAmount)}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-ink-soft">
        أكمل <span className="font-bold text-ink">{goal.targetCount}</span> طلب قبل{" "}
        {formatDateShort(goal.deadline)}
      </p>

      {/* progress bar */}
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-surface-sink">
        <div
          className={`h-full rounded-full transition-all ${done ? "bg-emerald-500" : "bg-orange-ink"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className="font-semibold text-ink">
          {goal.progress} / {goal.targetCount} ({pct}%)
        </span>
        <span
          className={
            done ? "font-semibold text-emerald-600" : expired ? "text-muted" : "text-ink-soft"
          }
        >
          {done
            ? goal.awarded
              ? "✓ تحقق — تمت إضافة الحافز"
              : "✓ تحقق الهدف"
            : expired
              ? "انتهى الوقت"
              : "قيد التنفيذ"}
        </span>
      </div>
    </section>
  );
}

const ACTION_LABELS: Record<string, string> = {
  advance: "تقديم مرحلة",
  revert: "إرجاع للتعديل",
  claim: "بدء العمل",
  approve_design: "اعتماد تصميم",
  reject_design: "رفض تصميم",
};

function stageLabel(s: OrderStatus | null): string {
  if (!s) return "—";
  return ORDER_STATUS_LABELS[s] ?? s;
}

export default function StaffMePage() {
  const [salary, setSalary] = useState<StaffSalary | null>(null);
  const [activity, setActivity] = useState<MyActivityRow[]>([]);
  const [goal, setGoal] = useState<StaffGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, a, g] = await Promise.all([getMySalary(), getMyActivity(), getMyGoal()]);
      setSalary(s);
      setActivity(a);
      setGoal(g);
    } catch (e) {
      setError(getApiErrorMessage(e, "تعذر تحميل بياناتك"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="animate-step-in" dir="rtl">
      <PageHeader title="راتبي ونشاطي" subtitle="راتبك الحالي وسجل عملك" />

      {loading ? (
        <p className="text-sm text-ink-soft">جارٍ التحميل…</p>
      ) : error ? (
        <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => { setLoading(true); load(); }}
            className="mt-3 min-h-[44px] rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Incentive goal + progress */}
          {goal && <GoalCard goal={goal} />}

          {/* Salary summary */}
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
              <p className="text-xs font-medium text-ink-soft">الراتب الأساسي</p>
              <p className="mt-1 font-display text-2xl font-bold text-ink">
                {formatIQD(salary?.baseSalary ?? 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-orange-ink/20 bg-warm-veil p-5 shadow-[var(--shadow-soft)]">
              <p className="text-xs font-medium text-orange-ink">الرصيد الحالي</p>
              <p className="mt-1 font-display text-2xl font-bold text-orange-ink">
                {formatIQD(salary?.balance ?? 0)}
              </p>
            </div>
          </section>

          {/* Ledger */}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
            <h2 className="mb-3 font-display text-base font-semibold text-ink">سجل الراتب</h2>
            {(salary?.transactions.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-soft">لا توجد حركات بعد.</p>
            ) : (
              <ul className="divide-y divide-line">
                {salary!.transactions.map((t) => {
                  const sign = t.type === "deduction" ? "−" : t.type === "bonus" ? "+" : "=";
                  const tone =
                    t.type === "deduction"
                      ? "text-danger"
                      : t.type === "bonus"
                        ? "text-emerald-600"
                        : "text-ink";
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{SALARY_TXN_LABELS[t.type]}</p>
                        {t.reasonAr && <p className="truncate text-xs text-ink-soft">{t.reasonAr}</p>}
                        <p className="text-xs text-muted">{formatDateShort(t.createdAt)}</p>
                      </div>
                      <span className={`shrink-0 font-display text-sm font-bold ${tone}`}>
                        {sign} {formatIQD(t.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Activity */}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
            <h2 className="mb-3 font-display text-base font-semibold text-ink">سجل النشاط</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-ink-soft">لا يوجد نشاط بعد.</p>
            ) : (
              <ul className="divide-y divide-line">
                {activity.map((a) => (
                  <li key={a.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-ink">
                        {ACTION_LABELS[a.action] ?? a.action}
                        {a.productName ? ` — ${a.productName}` : ""}
                      </p>
                      <p className="shrink-0 text-xs text-muted">{formatDateShort(a.createdAt)}</p>
                    </div>
                    {(a.fromStage || a.toStage) && (
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {stageLabel(a.fromStage)} ← {stageLabel(a.toStage)}
                        {a.studentName ? ` · ${a.studentName}` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
