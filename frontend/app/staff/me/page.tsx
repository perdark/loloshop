"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { PayoutAccountPanel } from "@/components/payments/PayoutAccountPanel";
import { MyMonthPanel } from "@/components/staff/MyMonthPanel";
import { MonthlyStatementCard } from "@/components/staff/MonthlyStatementCard";
import { ActivityList } from "@/components/staff/ActivityList";
import {
  getMyActivity,
  getMyGoal,
  getMySalary,
  type MyActivityRow,
} from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import { SALARY_TXN_LABELS } from "@/lib/constants";
import { formatDateShort, formatIQD, monthLabel, recentMonthOptions } from "@/lib/format";
import type { StaffGoal, StaffSalary } from "@/lib/types";
import { getUser } from "@/lib/auth";
import {
  getMyStaffPayoutAccount,
  saveMyStaffPayoutAccount,
  type PayoutAccount,
} from "@/lib/payments";

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
        {/* PIECES — progress counts one activity-log row per piece advanced, not per bundle.
            Same number the team page shows; the two must use the same word. */}
        أكمل <span className="font-bold text-ink">{goal.targetCount}</span> قطعة قبل{" "}
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

// This month + the previous 5, computed once when the module loads.
const MONTH_OPTIONS = recentMonthOptions();

export default function StaffMePage() {
  const [salary, setSalary] = useState<StaffSalary | null>(null);
  const [activity, setActivity] = useState<MyActivityRow[]>([]);
  const [month, setMonth] = useState(MONTH_OPTIONS[0].value);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [goal, setGoal] = useState<StaffGoal | null>(null);
  const [payoutAccount, setPayoutAccount] = useState<PayoutAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, a, g, payout] = await Promise.all([
        getMySalary(),
        getMyActivity(month),
        getMyGoal(),
        getMyStaffPayoutAccount(),
      ]);
      setSalary(s);
      setActivity(a);
      setGoal(g);
      setPayoutAccount(payout);
    } catch (e) {
      setError(getApiErrorMessage(e, "تعذر تحميل بياناتك"));
    } finally {
      setLoading(false);
    }
    // Only the initial load — a later month switch goes through `handleMonthChange`, which
    // refreshes only the activity list, not the whole page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMonthChange(next: string) {
    setMonth(next);
    setLoadingActivity(true);
    try {
      setActivity(await getMyActivity(next));
    } catch (e) {
      // A separate toast on purpose — the page's own `error` state blanks the whole screen
      // (see MyMonthPanel's header comment for why that must never happen to a section fetch).
      toast.error(getApiErrorMessage(e, "تعذر تحميل نشاط هذا الشهر"));
    } finally {
      setLoadingActivity(false);
    }
  }

  return (
    <div className="animate-step-in" dir="rtl">
      <PageHeader
        title="راتبي ونشاطي"
        subtitle="دوامك وساعاتك وفتحاتك وخصوماتك وحوافزك — بالتفصيل"
      />

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
          {/* «حصيلة شهرك وراتبك» — first, above everything. It is the number a person opens
              this page for, it renders nothing when no statement is published, and it has its
              own fetch so a failure here cannot blank the rest of the page. */}
          <MonthlyStatementCard />

          {/* Incentive goal + progress */}
          {goal && <GoalCard goal={goal} />}

          {/* The month: attendance, hours, breaks, lateness, pieces. Its own fetch and its
              own error state on purpose — a failure here must not blank the salary card,
              which is the one number a person opens this page for. */}
          <MyMonthPanel />

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

          {/* Workshop crew (e.g. ابو عبدو الفصال) don't manage their own card — admin does. */}
          {payoutAccount?.eligible !== false && <PayoutAccountPanel
            account={payoutAccount}
            ownerName={getUser()?.name || "الموظف"}
            onSave={async (input) => {
              try {
                const saved = await saveMyStaffPayoutAccount(input);
                setPayoutAccount(saved);
                return saved;
              } catch (caught) {
                toast.error(getApiErrorMessage(caught, "تعذّر حفظ بيانات SuperQi"));
                throw caught;
              }
            }}
          />}

          {/* Ledger */}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
            <h2 className="font-display text-base font-semibold text-ink">سجل الراتب</h2>
            {/* This list IS the balance above — every deduction and bonus that actually
                moved money, each with its reason. Lateness is not here because it never
                becomes a transaction; it has its own section in the month panel. */}
            <p className="mb-3 mt-1 text-xs text-muted">
              كل خصم وحافز أثّر على رصيدك، مع سببه.
            </p>
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

          {/* Activity — one month at a time, grouped by day */}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="min-w-0 font-display text-base font-semibold text-ink">
                سجل النشاط — {monthLabel(month)} ({activity.length})
              </h2>
              <select
                value={month}
                onChange={(e) => handleMonthChange(e.target.value)}
                disabled={loadingActivity}
                aria-label="شهر النشاط"
                className="min-h-11 shrink-0 rounded-lg border border-line bg-beige px-2 py-1 text-xs text-ink outline-none focus:border-orange-ink disabled:opacity-60"
              >
                {MONTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="mt-3">
              {loadingActivity ? (
                <div className="skeleton h-16 w-full rounded-xl" />
              ) : (
                <ActivityList rows={activity} />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
