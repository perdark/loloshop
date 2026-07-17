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

  const margin =
    data.totalRevenue > 0
      ? `هامش الربح ${Math.round((data.totalProfit / data.totalRevenue) * 100)}٪`
      : undefined;

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

      {/* Headline ledger — the four figures that define the business.
          The three money figures mask behind the gate; the order count is
          never sensitive and always shows. */}
      <dl className="grid grid-cols-2 divide-x divide-y divide-ink/10 border-y border-ink/10 [&>*]:border-ink/10 lg:grid-cols-4 lg:divide-y-0">
        <Figure
          label="إجمالي الإيرادات"
          value={
            <MoneyMask show={showMoney}>
              <Money amount={data.totalRevenue} />
            </MoneyMask>
          }
        />
        <Figure
          label="إجمالي التكلفة"
          value={
            <MoneyMask show={showMoney}>
              <Money amount={data.totalCost} />
            </MoneyMask>
          }
        />
        <Figure
          label="إجمالي الربح"
          value={
            <MoneyMask show={showMoney}>
              <Money amount={data.totalProfit} />
            </MoneyMask>
          }
          accent
          hint={showMoney ? margin : undefined}
        />
        <Figure label="عدد الطلبات / الباقات" value={String(data.orderCount)} />
      </dl>
      <CalculationDetails summary="كيف حُسبت أرقام لوحة التحكم؟" className="mt-3 bg-surface">
        <p>
          المحاسبة تشمل طلبات التجزئة غير الملغاة، وطلبات الممثلين الموافق عليها وغير الملغاة فقط.
          الطلب المعلّق أو المُرجع لا يدخل في الإيراد أو التكلفة أو الربح.
        </p>
        <div className="mt-2 space-y-1 rounded-lg bg-ink/[0.04] px-2.5 py-2 text-ink">
          <p>الإيراد = مجموع السعر النهائي المخزن للطلبات الداخلة في المحاسبة.</p>
          <p>التكلفة = مجموع تكلفة التجزئة أو حصة الإدارة في طلبات الممثلين.</p>
          <p>الربح = الإيراد − التكلفة.</p>
          <p>هامش الربح = الربح ÷ الإيراد × ١٠٠، مقرباً لأقرب نسبة صحيحة.</p>
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
        <DashboardCharts
          daily={data.dailyOrders}
          ordersByStatus={data.ordersByStatus}
        />
        <CalculationDetails summary="كيف حُسبت الرسوم؟" className="mt-4 bg-surface">
          <p>
            الرسم اليومي يعد الطلبات المنطقية: الباقة متعددة القطع تظهر مرة واحدة في يوم إنشائها.
            رسم الحالات يعد القطع داخل الطلبات، لأن كل قطعة قد تكون في مرحلة إنتاج مختلفة.
            النطاق المحاسبي نفسه مطبق هنا: لا ملغى، ولا طلب ممثل معلّق أو مُرجع.
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
          <ul className="mt-3.5 list-none p-0">
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">الإيراد</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                <MoneyMask show={showMoney} placeholder="••••">
                  {formatIQD(accounting.totals.revenue)}
                </MoneyMask>
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-[0.92rem] text-ink-soft">التكلفة</span>
              <span className="text-[0.95rem] font-bold tabular-nums text-ink" dir="ltr">
                <MoneyMask show={showMoney} placeholder="••••">
                  {formatIQD(accounting.totals.cost)}
                </MoneyMask>
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
                      </span>
                    </span>
                    <span
                      className="text-[0.95rem] font-bold tabular-nums text-ink"
                      dir="ltr"
                    >
                      <MoneyMask show={showMoney} placeholder="••••">
                        {formatIQD(row.profit)}
                      </MoneyMask>
                    </span>
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
          <div className="mt-3.5 flex items-center justify-between gap-4 border-t-2 border-ink pt-4">
            <span className="font-display text-xl font-bold text-ink">صافي الربح</span>
            <span
              className="text-[2rem] font-bold tabular-nums text-orange-ink"
              dir="ltr"
              style={{ fontFamily: "var(--font-amiri)" }}
            >
              <MoneyMask show={showMoney} placeholder="••••">
                {formatIQD(accounting.totals.profit)}
              </MoneyMask>
            </span>
          </div>
          <CalculationDetails summary="شرح إيصال المحاسبة" className="mt-4 bg-surface">
            <p>
              صافي الربح = الإيراد − التكلفة. صفوف «حسب الدفعة» و«حسب الممثل» طريقتان بديلتان لعرض طلبات الممثلين نفسها؛ لا تُجمع إحداهما مع الأخرى.
              «تجزئة مستقلة» تعرض الطلبات التي لا ترتبط بممثل.
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
