"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { getAdminAnalytics, getAdminAccounting, getPendingApprovalCount, getVisitorStats, type VisitorStats } from "@/lib/admin";
import { PromoControl } from "@/components/admin/PromoControl";
import { MaintenanceControl } from "@/components/admin/MaintenanceControl";
import { getTailorSummary, type TailorSummary } from "@/lib/staff";
import Link from "next/link";
import { formatIQD } from "@/lib/format";
import type { AdminAccounting, AdminAnalytics } from "@/lib/types";
import { usePolling } from "@/lib/hooks/usePolling";
import { useProductionEvents } from "@/hooks/useProductionEvents";
import { useMoneyGate } from "@/hooks/useMoneyGate";
import { MoneyMask } from "@/components/MoneyMask";
import { MoneyRevealTrigger } from "@/components/MoneyRevealTrigger";
import { setMoneyGate } from "@/lib/money-gate";
import { CalculationDetails } from "@/components/admin/CalculationDetails";
import { Count } from "@/components/ui/Count";

const DashboardCharts = dynamic(
  () =>
    import("@/components/admin/DashboardCharts").then((m) => m.DashboardCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-2xl bg-ink/5" />
        <div className="h-72 animate-pulse rounded-2xl bg-ink/5" />
      </div>
    ),
  }
);

/* Latin → Arabic-Indic digits, for counts rendered outside formatIQD. */
const toArabicDigits = (n: number | string) =>
  String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/* ── Editorial money: big numeral, quiet unit ──
   formatIQD returns "<number> د.ع"; we split the unit so the figure reads as
   a magazine number with a muted currency tag rather than a wall of text. */
function Money({ amount, className = "" }: { amount: number; className?: string }) {
  const formatted = formatIQD(amount);
  const unit = " د.ع";
  const num = formatted.endsWith(unit)
    ? formatted.slice(0, -unit.length)
    : formatted;
  return (
    <span dir="ltr" className={`tabular-nums ${className}`}>
      {num}
      <span className="ms-1.5 align-baseline text-[0.42em] font-semibold tracking-wide text-[var(--shop-muted)]">
        د.ع
      </span>
    </span>
  );
}

/* A single ledger figure: small label over a large numeral. The whole
   dashboard speaks in these instead of bordered stat cards. */
function Figure({
  label,
  value,
  hint,
  accent,
  size = "lg",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: boolean;
  size?: "lg" | "sm";
}) {
  return (
    <div className="px-5 py-6 sm:px-7 lg:py-7">
      <dt className="text-sm font-medium text-[var(--shop-muted)]">{label}</dt>
      <dd
        className={`mt-3 font-bold leading-none ${
          size === "lg"
            ? "text-[1.7rem] lg:text-[2.1rem]"
            : "text-2xl lg:text-[1.75rem]"
        } ${accent ? "text-orange-ink" : "text-ink"}`}
      >
        {value}
      </dd>
      {hint && (
        <dd className="mt-2.5 text-xs font-medium text-[var(--shop-muted)]">
          {hint}
        </dd>
      )}
    </div>
  );
}

/* Editorial section header: display-serif title + thin warm rule. */
function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="section-heading mb-7">
      <h2 className="shrink-0 font-display text-xl font-bold tracking-tight text-ink lg:text-2xl">
        {title}
      </h2>
      {meta && (
        <span className="order-last shrink-0 text-sm font-medium text-[var(--shop-muted)]">
          {meta}
        </span>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div dir="rtl" lang="ar" className="mx-auto max-w-6xl animate-fade-page-in">
      <div className="mb-10 space-y-3">
        <div className="skeleton h-9 w-52" />
        <div className="skeleton h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 border-y border-ink/10 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-5 py-7 sm:px-7">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton mt-4 h-8 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-14 space-y-4">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton h-56 w-full rounded-2xl" />
      </div>
    </div>
  );
}

/* Discreet, admin-only affordance to SET the money-gate secret the first time
   (shown only when the server reports no gate configured). Kept quiet — the
   whole page is admin-only, so this is a one-time setup nudge, not a warning. */
function MoneyGateSetup({ onSaved }: { onSaved: (secret: string) => void }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const value = secret.trim();
    if (value.length < 4) {
      toast.error("الرمز قصير جداً (٤ أحرف على الأقل)");
      return;
    }
    setSaving(true);
    try {
      await setMoneyGate(value);
      toast.success("تم تعيين رمز إخفاء المبالغ");
      setSecret("");
      setOpen(false);
      onSaved(value);
    } catch {
      toast.error("تعذر حفظ الرمز");
    } finally {
      setSaving(false);
    }
  }, [secret, onSaved]);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--shop-muted)]">
      <span className="inline-flex items-center gap-1.5">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="4" y="11" width="16" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        المبالغ مخفية — عيّن رمزاً لكشفها عند الحاجة
      </span>
      {open ? (
        <span className="inline-flex items-center gap-1.5">
          <input
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            placeholder="الرمز"
            aria-label="رمز إخفاء المبالغ"
            className="h-9 w-28 rounded-lg border border-line bg-white px-2.5 text-center text-sm tracking-widest text-ink outline-none focus:border-orange-ink"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || secret.trim().length < 4}
            className="inline-flex h-9 items-center rounded-lg bg-orange-ink px-3 text-xs font-bold text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            {saving ? "…" : "حفظ"}
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-semibold text-orange-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink"
        >
          تعيين الرمز
        </button>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [accounting, setAccounting] = useState<AdminAccounting | null>(null);
  const [tailor, setTailor] = useState<TailorSummary | null>(null);
  const [pendingApproval, setPendingApproval] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Money-gate: sensitive figures stay masked until the admin opens the gate
  // with the shared secret (auto-hides after idle). `configuredLocal` flips
  // true the instant a secret is set this session, so the setup nudge hides
  // without waiting for a remount.
  const gate = useMoneyGate();
  const [configuredLocal, setConfiguredLocal] = useState(false);
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);
  const moneyConfigured = gate.configured || configuredLocal;
  const showMoney = gate.revealed;
  const onGateSaved = useCallback(
    (secret: string) => {
      setConfiguredLocal(true);
      // Verify + reveal immediately so the admin sees the figures they just
      // unlocked (fails safe — if verify somehow rejects, they stay masked).
      void gate.reveal(secret);
    },
    [gate]
  );

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [analytics, acct] = await Promise.all([
        getAdminAnalytics(),
        getAdminAccounting(),
      ]);
      setData(analytics);
      setAccounting(acct);
    } catch {
      toast.error("تعذر تحميل الإحصائيات");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // الفصال (tailor) is a non-critical parallel widget — fetch separately so a
    // failure here never blocks the core dashboard.
    try {
      setTailor(await getTailorSummary());
    } catch {
      /* leave previous value */
    }
    try {
      setVisitors(await getVisitorStats());
    } catch {
      /* leave previous value */
    }
    // Pending approval count — non-critical, fetched separately.
    try {
      setPendingApproval(await getPendingApprovalCount());
    } catch {
      /* leave previous value */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time: refresh the dashboard (orders, status counts, profit/revenue)
  // whenever the server pushes a production event. Debounced so a burst of
  // events (e.g. an order moving stage emits status + presence) coalesces into
  // one reload. A slow poll stays as a backstop for missed events.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => load(true), 400);
  }, [load]);
  useEffect(
    () => () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    },
    []
  );
  useProductionEvents(scheduleReload);
  usePolling(() => load(true), 30000);

  if (loading || !data || !accounting) {
    return <DashboardSkeleton />;
  }

  // ── THE MONEY (bug 11, 2026-08-13) ──
  // «إجمالي الربح» used to print SUM(orders.profit), which on a representative's order is
  // `price − حصة الإدارة` — the REP's margin, money that never reaches this shop. The same
  // number is labelled «ربح الممثل» on the rep's own page. What the shop actually takes in
  // is حصة الإدارة on rep orders plus the full price on retail ones; that is `shopIncome`,
  // and the reps' margin is now shown beside it, named as theirs. See backend/lib/counts.js.
  const money = data.money;
  // Share of everything students paid that reaches the shop. Replaces «هامش الربح», which
  // divided the reps' profit by the reps' gross and called the result the shop's margin.
  const shopShare =
    money.grossCollected > 0
      ? `${Math.round((money.shopIncome / money.grossCollected) * 100)}٪ مما دفعه الطلاب`
      : undefined;
  // No production cost has ever been entered against a retail order, so retail income is
  // REVENUE, not profit. Say it rather than printing a net-profit figure that cannot be true.
  const retailCostMissing = money.retailPiecesCosted === 0 && money.retailPieces > 0;

  // Breakdown groups for the accounting receipt; empty groups are dropped.
  const accountingGroups = [
    { title: "حسب الدفعة", rows: accounting.byBatch },
    { title: "حسب الممثل", rows: accounting.byWholesaler },
    { title: "تجزئة مستقلة", rows: [accounting.independentRetail] },
  ].filter((g) => g.rows.length > 0);

  return (
    <div dir="rtl" lang="ar" className="mx-auto max-w-6xl animate-page-in">
      {/* Editorial masthead */}
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink lg:text-4xl">
            لوحة التحكم
          </h1>
          <p className="mt-2 text-base text-ink-soft">
            نظرة عامة على الأرباح والطلبات
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="group inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-ink/15 bg-beige px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink disabled:opacity-50 sm:self-auto"
        >
          <svg
            aria-hidden
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-500 ${
              refreshing ? "animate-spin" : "group-hover:rotate-180"
            }`}
          >
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          تحديث
        </button>
      </header>

      {/* Hero — what is still ON you, not what you have ever sold. «قيد التنفيذ»
          = طلب with at least one piece not yet «جاهز»: a student cannot collect his
          طقم while the قبعة is unfinished, so the whole order stays open.
          The three units are named outright; none of them is the bare word «طلب». */}
      <section className="mb-8 rounded-2xl border border-ink/10 bg-beige px-6 py-5">
        <p className="text-sm font-semibold text-ink-soft">قيد التنفيذ</p>
        <p className="mt-1 font-display text-4xl font-bold leading-none text-ink lg:text-5xl">
          <Count value={data.headline.inProgress} unit="order" unitClassName="text-[0.45em] font-bold opacity-60" />
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          من <Count value={data.headline.bundles} unit="order" /> ·{" "}
          <Count value={data.headline.pieces} unit="piece" /> ·{" "}
          <Count value={data.headline.students} unit="student" />
        </p>
      </section>

      {/* Rank ladder — the long game. Climbs on RETAIL طلب (direct students, no rep),
          final rung 3000. Identical ladder + rung to the TV board: both read
          adminController/tvBoardController's shared rankFor(), so they cannot disagree. */}
      <section className="mb-8 rounded-2xl border border-orange/25 bg-gradient-to-l from-orange/[0.07] to-transparent px-6 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">الرتبة</p>
            <p className="mt-0.5 font-display text-2xl font-bold text-ink">{data.rank.label}</p>
          </div>
          <p className="text-sm text-ink-soft">
            <Count value={data.rank.total} unit="order" /> تجزئة
          </p>
        </div>

        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-gradient-to-l from-[#FFB100] to-[#F47B42] transition-[width] duration-700"
            style={{ width: `${Math.min(100, Math.max(2, data.rank.progress))}%` }}
          />
        </div>

        <p className="mt-2 text-sm text-ink-soft">
          {data.rank.nextLabel ? (
            <>
              المتبقّي لرتبة «{data.rank.nextLabel}»:{" "}
              <strong className="text-ink">
                <Count value={data.rank.toNext} unit="order" /> تجزئة
              </strong>
            </>
          ) : (
            "أعلى رتبة — الهدف مكتمل"
          )}
        </p>

        {/* The whole ladder, so the 3000 goal is visible from rung one. */}
        <ol className="mt-3 flex flex-wrap gap-1.5">
          {data.rank.ladder.map((r) => {
            const reached = data.rank.total >= r.min;
            const current = r.key === data.rank.key;
            return (
              <li
                key={r.key}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  current
                    ? "border-orange bg-orange text-white"
                    : reached
                      ? "border-orange/30 bg-orange/10 text-orange-ink"
                      : "border-ink/10 bg-ink/[0.03] text-ink-soft"
                }`}
                title={`${r.label} — ${toArabicDigits(r.min)}`}
              >
                {r.label}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Headline ledger — what the SHOP takes in, and where it comes from.
          The three money figures mask behind the gate; the order count is
          never sensitive and always shows. The first figure is the sum of the
          next two, so the row reconciles on sight. */}
      <dl className="grid grid-cols-2 divide-x divide-y divide-ink/10 border-y border-ink/10 [&>*]:border-ink/10 lg:grid-cols-4 lg:divide-y-0">
        <Figure
          label="دخل المحل"
          value={
            <MoneyMask show={showMoney}>
              <Money amount={money.shopIncome} />
            </MoneyMask>
          }
          accent
          hint={showMoney ? shopShare : undefined}
        />
        <Figure
          label="حصة الإدارة من الممثلين"
          value={
            <MoneyMask show={showMoney}>
              <Money amount={money.repAdminShare} />
            </MoneyMask>
          }
        />
        <Figure
          label="مبيعات التجزئة"
          value={
            <MoneyMask show={showMoney}>
              <Money amount={money.retailRevenue} />
            </MoneyMask>
          }
        />
        {/* SCOPE, not unit: this figure sits in the MONEY ledger, so it counts only
            settled طلبات (retail + rep-approved) — deliberately fewer than the
            operational total in the hero above. The label says which, so the two
            numbers can never look like a contradiction. */}
        <Figure label="طلبات محتسبة" value={`${toArabicDigits(money.orders)} طلب`} />
      </dl>

      {/* The representatives' money — collected through the shop, but not the shop's.
          Kept OUT of the ledger above and labelled outright, because printing it as
          «إجمالي الربح» was the whole bug. Hidden entirely when no rep has sold
          anything, so a retail-only shop isn't shown a row of zeros to interpret. */}
      {money.repGross > 0 && (
      <section className="mt-4 rounded-2xl border border-ink/10 bg-surface px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div>
            <p className="text-sm font-semibold text-ink">مال الممثلين — ليس من دخل المحل</p>
            <p className="mt-1 text-xs text-[var(--shop-muted)]">
              الطالب يدفع للممثل، والممثل يسلّم حصة الإدارة. الفرق ربحه هو.
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-7 gap-y-2">
            <div>
              <dt className="text-xs text-[var(--shop-muted)]">دفعه الطلاب للممثلين</dt>
              <dd className="mt-0.5 text-lg font-bold text-ink-soft">
                <MoneyMask show={showMoney} placeholder="••••">
                  <Money amount={money.repGross} />
                </MoneyMask>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--shop-muted)]">ربح الممثلين</dt>
              <dd className="mt-0.5 text-lg font-bold text-ink-soft">
                <MoneyMask show={showMoney} placeholder="••••">
                  <Money amount={money.repMargin} />
                </MoneyMask>
              </dd>
            </div>
          </dl>
        </div>
      </section>
      )}

      {/* Honest gap, not a warning: with no production cost entered anywhere, the shop's
          NET profit is simply unknown. Better an admitted blank than a confident lie. */}
      {retailCostMissing && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          لم تُدخل تكلفة إنتاج لأي طلب تجزئة (٠ من {toArabicDigits(money.retailPieces)} قطعة)، لذلك
          «مبيعات التجزئة» إيراد وليس ربحاً، ولا يمكن حساب صافي ربح المحل بعد. أدخل التكلفة من
          صفحة الطلبات ليصبح الرقم صافياً.
        </p>
      )}

      <CalculationDetails summary="كيف حُسبت أرقام لوحة التحكم؟" className="mt-3 bg-surface">
        <p>
          المحاسبة تشمل طلبات التجزئة غير الملغاة، وطلبات الممثلين الموافق عليها وغير الملغاة فقط.
          الطلب المعلّق أو المُرجع لا يدخل في أي رقم هنا.
        </p>
        <div className="mt-2 space-y-1 rounded-lg bg-ink/[0.04] px-2.5 py-2 text-ink">
          <p>دخل المحل = حصة الإدارة من طلبات الممثلين + مبيعات التجزئة.</p>
          <p>حصة الإدارة = المبلغ الذي يسلّمه الممثل للمحل عن كل طلب.</p>
          <p>مبيعات التجزئة = ما يدفعه الطالب للمحل مباشرة (بدون ممثل).</p>
          <p>ربح الممثلين = ما دفعه الطلاب للممثلين − حصة الإدارة. هذا المبلغ يبقى عند الممثل.</p>
          <p>
            صافي ربح المحل = دخل المحل − تكلفة الإنتاج، ولا يظهر هنا لأن تكلفة الإنتاج غير مُدخلة.
          </p>
          <p>عدد الطلبات / الباقات = كل طلب منفرد مرة، وكل مجموعة شراء مرتبطة مرة واحدة مهما كان عدد قطعها.</p>
        </div>
      </CalculationDetails>

      {/* Live storefront visitors — first-party, never money → always visible */}
      <section className="mt-6 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-line bg-surface p-4 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-soft">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            يشاهدون الآن
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{toArabicDigits(visitors?.now ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 text-center">
          <p className="text-xs text-ink-soft">زوّار اليوم</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{toArabicDigits(visitors?.today ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 text-center">
          <p className="text-xs text-ink-soft">إجمالي الزوّار</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{toArabicDigits(visitors?.total ?? 0)}</p>
        </div>
      </section>

      {/* First-run nudge to set the gate secret (only when none configured). */}
      {!moneyConfigured && <MoneyGateSetup onSaved={onGateSaved} />}

      {/* Pending approval count — shown only when > 0 */}
      {pendingApproval !== null && pendingApproval > 0 && (
        <section className="mt-8">
          <Link
            href="/admin/orders"
            className="flex items-center justify-between gap-4 rounded-2xl border-2 border-amber-300 bg-amber-50 px-6 py-5 transition-colors hover:bg-amber-100"
          >
            <div>
              <p className="text-sm font-semibold text-amber-900">بانتظار موافقة الممثل</p>
              <p className="mt-0.5 text-xs text-amber-700">
                طلبات وصلت ولم يوافق عليها الممثل بعد — يمكنك الموافقة مباشرةً
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[2rem] font-bold tabular-nums text-amber-800 leading-none">
                {toArabicDigits(pendingApproval)}
              </span>
              <span className="text-2xl" aria-hidden>←</span>
            </div>
          </Link>
        </section>
      )}

      {/* Analytics — order-only charts. Derived purely from counts, so they
          stay informative even while the money figures are masked. Replaces
          the old daily-orders bar + status figure-grid with richer visuals. */}
      <section className="mt-14">
        <SectionHead title="نظرة تحليلية" meta="بيانات الطلبات" />
        <DashboardCharts daily={data.dailyOrders} funnel={data.funnel} />
        <CalculationDetails summary="كيف حُسبت الرسوم؟" className="mt-4 bg-surface">
          <p>
            «حركة الطلبات» تعرض خطّين: «كل الطلبات» يشمل كل طلب غير ملغى في ذلك اليوم، و«طلبات
            محتسبة» هو الجزء الداخل في المحاسبة فقط (تجزئة، أو طلب ممثل موافق عليه). الفرق بينهما
            هو الطلبات التي لم يوافق عليها الممثل بعد.
          </p>
          <p className="mt-2">
            «مراحل الإنتاج» تُحسب بالقطعة لأن المرحلة تخصّ القطعة لا الطلب. كل عمود مقسوم إلى
            «قابل للعمل» — وهو نفسه ما يراه الموظف في قائمته — و«بانتظار موافقة الممثل» و«مُرجع
            للطالب»، وهي أعمال لا تظهر لأي محطة. مجموع الثلاثة يساوي إجمالي المرحلة بالضبط.
          </p>
          <p className="mt-2">
            شريط «طلاب لديهم قطعة هنا» عدد انتماء لا حصة: الطالب الذي له قطعتان في مرحلتين يُحسب في
            الاثنتين، فلا تُجمع هذه الأرقام.
          </p>
        </CalculationDetails>
      </section>

      {/* Promo / Discount Popup control */}
      <section className="mt-16">
        <SectionHead title="الإعلانات والعروض" />
        <PromoControl />
      </section>

      {/* Maintenance mode control */}
      <section className="mt-16">
        <SectionHead title="الموقع" />
        <MaintenanceControl />
      </section>

      {/* الفصال — parallel tailoring progress (independent of the pipeline) */}
      {tailor && tailor.total > 0 && (
        <section className="mt-16">
          <SectionHead title="الفصال" meta="بالتوازي مع الإنتاج" />
          <Link
            href="/staff/tailor"
            className="block rounded-2xl border border-ink/10 bg-beige p-6 transition-colors hover:border-orange/40 sm:p-7"
          >
            <div className="grid grid-cols-3 divide-x divide-ink/10 [&>*]:border-ink/10">
              <div className="px-4 text-center sm:px-6">
                <dt className="text-sm font-medium text-[var(--shop-muted)]">قيد الفصال</dt>
                <dd className="mt-3 text-[1.7rem] font-bold leading-none text-orange-ink lg:text-[2.1rem]">
                  {toArabicDigits(tailor.pending)}
                </dd>
              </div>
              <div className="px-4 text-center sm:px-6">
                <dt className="text-sm font-medium text-[var(--shop-muted)]">تم الفصال</dt>
                <dd className="mt-3 text-[1.7rem] font-bold leading-none text-ink lg:text-[2.1rem]">
                  {toArabicDigits(tailor.done)}
                </dd>
              </div>
              <div className="px-4 text-center sm:px-6">
                <dt className="text-sm font-medium text-[var(--shop-muted)]">الإجمالي</dt>
                <dd className="mt-3 text-[1.7rem] font-bold leading-none text-ink lg:text-[2.1rem]">
                  {toArabicDigits(tailor.total)}
                </dd>
              </div>
            </div>
            {/* Progress bar — share of retail orders whose tailoring is finished */}
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-ink/8">
              <div
                className="h-full rounded-full bg-orange-ink transition-[width]"
                style={{ width: `${tailor.total > 0 ? Math.round((tailor.done / tailor.total) * 100) : 0}%` }}
              />
            </div>
          </Link>
        </section>
      )}

      {/* Accounting — system receipt */}
      <section className="mt-16">
        <div className="max-w-[560px] rounded-2xl border border-[var(--color-neutral)] bg-[var(--shop-sink)] p-7 sm:p-8">
          <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink pb-4">
            <h2 className="font-display text-2xl font-bold text-ink">محاسبة النظام</h2>
            <span className="text-xs tracking-[0.06em] text-[var(--shop-muted)]">
              إيصال النظام
            </span>
          </div>
          {/* The receipt subtracts its way to the bottom line, so the arithmetic is
              visible: ما دفعه الطلاب − ربح الممثلين = دخل المحل. Both identities are
              computed from one set of rows on the server, so they always tie out. */}
          <ul className="mt-3.5 list-none p-0">
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">إجمالي ما دفعه الطلاب</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                <MoneyMask show={showMoney} placeholder="••••">
                  {formatIQD(accounting.totals.grossCollected)}
                </MoneyMask>
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">− ربح الممثلين (يبقى عندهم)</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                <MoneyMask show={showMoney} placeholder="••••">
                  {formatIQD(accounting.totals.repMargin)}
                </MoneyMask>
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">تكلفة الإنتاج</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                {retailCostMissing ? (
                  <span className="text-[0.8rem] font-semibold text-[var(--shop-muted)]">
                    غير مُدخلة
                  </span>
                ) : (
                  <MoneyMask show={showMoney} placeholder="••••">
                    {formatIQD(accounting.totals.retailCost)}
                  </MoneyMask>
                )}
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">عدد الطلبات</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                {toArabicDigits(accounting.totals.orders)}
              </span>
            </li>
            {accountingGroups.map((group) => (
              <Fragment key={group.title}>
                <li className="pt-4 pb-0.5 text-[0.74rem] font-bold tracking-[0.04em] text-[var(--shop-muted)]">
                  {group.title}
                  <span className="ms-1.5 font-medium tracking-normal">
                    — دخل المحل
                  </span>
                </li>
                {group.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-baseline justify-between gap-4 py-1.5"
                  >
                    <span className="text-[0.92rem] text-ink-soft">
                      {row.label}
                      <span className="text-xs text-[var(--shop-muted)]">
                        {" · "}
                        {toArabicDigits(row.orders)} طلب
                        {row.repMargin > 0 && (
                          <>
                            {" · للممثل "}
                            <span dir="ltr" className="tabular-nums">
                              <MoneyMask show={showMoney} placeholder="••••">
                                {formatIQD(row.repMargin)}
                              </MoneyMask>
                            </span>
                          </>
                        )}
                      </span>
                    </span>
                    <span
                      className="text-[0.95rem] font-bold tabular-nums text-ink"
                      dir="ltr"
                    >
                      <MoneyMask show={showMoney} placeholder="••••">
                        {formatIQD(row.shopIncome)}
                      </MoneyMask>
                    </span>
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
          <div className="mt-3.5 flex items-center justify-between gap-4 border-t-2 border-ink pt-4">
            <span className="font-display text-xl font-bold text-ink">دخل المحل</span>
            <span
              className="text-[2rem] font-bold tabular-nums text-orange-ink"
              dir="ltr"
              style={{ fontFamily: "var(--font-amiri)" }}
            >
              <MoneyMask show={showMoney} placeholder="••••">
                {formatIQD(accounting.totals.shopIncome)}
              </MoneyMask>
            </span>
          </div>
          <CalculationDetails summary="شرح إيصال المحاسبة" className="mt-4 bg-surface">
            <p>
              دخل المحل = إجمالي ما دفعه الطلاب − ربح الممثلين. وهو نفسه = حصة الإدارة من طلبات
              الممثلين + مبيعات التجزئة.
            </p>
            <p className="mt-2">
              كل صف يعرض ما دخل المحل من ذلك المصدر، وبجانبه ما بقي عند الممثل. صفوف «حسب الدفعة»
              و«حسب الممثل» طريقتان بديلتان لعرض طلبات الممثلين نفسها؛ لا تُجمع إحداهما مع الأخرى.
              «تجزئة مستقلة» تعرض الطلبات التي لا ترتبط بممثل، ومجموع «حسب الممثل» مع «تجزئة مستقلة»
              يساوي دخل المحل.
            </p>
            <p className="mt-2">
              هذا الرقم دخل وليس صافي ربح: صافي الربح = دخل المحل − تكلفة الإنتاج، وتكلفة الإنتاج
              غير مُدخلة على طلبات التجزئة.
            </p>
            <p className="mt-2">
              عدد الطلبات يحسب الباقة مرة واحدة، والحساب لا يشمل طلبات الممثلين المعلّقة أو المُرجعة ولا أي طلب ملغى.
            </p>
          </CalculationDetails>
        </div>
      </section>

      {/* Top wholesalers — ranked editorial list */}
      <section className="mt-16 mb-4">
        <SectionHead
          title="أفضل الممثلين"
          meta={data.topWholesalers.length ? `${data.topWholesalers.length} ممثل` : undefined}
        />
        {data.topWholesalers.length ? (
          <>
            <ol className="border-t border-ink/10">
              {data.topWholesalers.map((w, i) => (
                <li
                  key={w.id}
                  className="flex items-center gap-5 border-b border-ink/8 py-4 transition-colors hover:bg-[var(--shop-sink)]"
                >
                  <span
                    className={`w-8 shrink-0 text-center font-display text-2xl font-bold tabular-nums ${
                      i === 0 ? "text-orange-ink" : "text-ink/30"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate font-medium text-ink">
                    {w.name}
                  </span>
                  <span className="shrink-0 text-sm text-ink-soft">
                    <span className="font-bold tabular-nums text-ink">
                      {w.orderCount}
                    </span>{" "}
                    طلب
                  </span>
                </li>
              ))}
            </ol>
            <CalculationDetails summary="كيف تم ترتيب الممثلين؟" className="mt-4 bg-surface">
              <p>
                الترتيب حسب عدد الطلبات الموافق عليها وغير الملغاة. كل باقة مرتبطة بمجموعة شراء تُحسب طلباً واحداً، لا بعدد قطعها.
              </p>
            </CalculationDetails>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-[var(--shop-muted)]">
            لا يوجد ممثلون بعد
          </p>
        )}
      </section>

      {/* Disguised reveal control (🎓). Only offered once a gate secret exists;
          before that the inline MoneyGateSetup nudge handles configuration. */}
      {moneyConfigured && (
        <MoneyRevealTrigger
          position="fixed"
          revealed={gate.revealed}
          onSubmit={gate.reveal}
          onHide={gate.hide}
        />
      )}
    </div>
  );
}
