"use client";

/**
 * /admin/analytics — «الإحصائيات»: هل نكبر، منو يفتح التطبيق، ووين يقضون وقتهم.
 *
 * ⚠️ FOUR SOURCES ON ONE SCREEN, AND THE SCREEN'S WHOLE JOB IS TO KEEP THEM APART.
 * backend/lib/shopAnalytics.js's header is the contract; what it means here is that every
 * section states, in Arabic, what its number counts and since when. Two specific lies this
 * page must never tell:
 *   · «الأجهزة» is a FLOOR on installs (install + sign-in + notification permission). Printing
 *     it as «تنزيلات» would give the owner a number to plan on that is smaller than the truth
 *     by an unknown amount. The real download count exists only in the Play/App Store consoles.
 *   · «الزيارات» (sessions, anyone incl. anonymous) and «داخلين بحساب» (app_opens, signed-in
 *     only) measure different populations from different tables. They sit in the same strip
 *     because the owner asks about them together — they are never added, and never divided into
 *     each other to make a "login rate", because site_visits covers only the (student) routes.
 *
 * ⚠️ BUILT PHONE-FIRST ON PURPOSE. The owner reads this on the app, not the laptop: every grid
 * starts at 2 columns, every table is a stack of rows rather than a <table> that scrolls, and
 * nothing depends on hover. See CLAUDE.md's device priority — admin is laptop-primary for the
 * production screens, but this one was asked for on the phone.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { toArabicDigits } from "@/lib/format";
import { getUsageStats, type UsageStats } from "@/lib/admin";

const ROLE_LABEL: Record<string, string> = {
  retail: "الطلاب",
  wholesaler: "الممثلون",
  staff: "الموظفون",
  worker: "العمال",
  design_helper: "أيادي التصميم",
  admin: "الإدارة",
};

const PLATFORM_LABEL: Record<string, string> = {
  android: "أندرويد",
  ios: "آيفون",
  web: "متصفح",
  unknown: "غير معروف",
};

/** Arabic page names. An unmapped path prints raw — better a slug than a wrong label. */
const PATH_LABEL: Record<string, string> = {
  "/": "الرئيسية",
  "/shop": "المتجر",
  "/product/:id": "صفحة منتج",
  "/cart": "السلة",
  "/my-order": "طلبي",
  "/account": "حسابي",
  "/full-set": "الطقم الكامل",
  "/full-set/:id": "الطقم الكامل",
  "/sizes": "المقاسات",
  "/vip": "VIP",
  "/lolo": "لولو المساعدة",
  "/returned-orders": "الطلبات المرجعة",
  "/get-app": "تحميل التطبيق",
  "/design": "المصمم",
  "/join": "الانضمام لممثل",
};

function arMonth(key: string): string {
  const [y, m] = key.split("-");
  const names = ["كانون٢","شباط","آذار","نيسان","أيار","حزيران","تموز","آب","أيلول","تشرين١","تشرين٢","كانون١"];
  return `${names[Number(m) - 1] ?? m} ${toArabicDigits(y.slice(2))}`;
}

function arDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ar-IQ", { day: "numeric", month: "short" });
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white/60 px-3 py-3 sm:px-4">
      <p className="text-[11px] leading-tight text-ink/50">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-ink/40">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-beige p-4 sm:p-7">
      <h2 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">{title}</h2>
      {/* ⚠️ Never delete the note. It is the only thing standing between a young table and an
          owner reading a short bar as a bad month. */}
      <p className="mt-1.5 text-xs leading-relaxed text-ink/50">{note}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A row of bars. No chart library — same reasoning as AppStatsPanel: no new audit surface. */
function Bars({
  rows,
  emptyLabel,
}: {
  rows: { key: string; label: string; value: number; sub?: string }[];
  emptyLabel: string;
}) {
  if (!rows.length) return <p className="text-sm text-ink/40">{emptyLabel}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11px] text-ink/50 sm:w-20">{r.label}</span>
          <div className="h-6 flex-1 overflow-hidden rounded-lg bg-ink/5">
            <div
              className="h-full rounded-lg bg-orange/80"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-left font-display text-xs font-bold tabular-nums text-ink sm:w-20">
            {toArabicDigits(r.value)}
            {r.sub && <span className="block text-[10px] font-normal text-ink/40">{r.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await getUsageStats(30));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل الإحصائيات"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div dir="rtl" className="space-y-3">
        <div className="skeleton h-24 w-full rounded-2xl" />
        <div className="skeleton h-56 w-full rounded-2xl" />
        <div className="skeleton h-56 w-full rounded-2xl" />
      </div>
    );
  }
  if (!stats) return null;

  const totalAccounts = stats.accounts.reduce((n, r) => n + r.accounts, 0);
  const students = stats.reach.by_role.find((r) => r.role === "retail");
  const androidDev = stats.installs.by_platform.find((r) => r.platform === "android");
  const iosDev = stats.installs.by_platform.find((r) => r.platform === "ios");
  const totalDevices = stats.installs.by_platform.reduce((n, r) => n + r.devices, 0);

  return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          الإحصائيات
        </h1>
        <p className="mt-1.5 text-sm text-ink/50">
          هل نكبر، منو يفتح التطبيق، ووين يقضون وقتهم. كل قسم يكول من أي يوم بدأ القياس مالته.
        </p>
      </header>

      {/* ── اليوم ─────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-ink/10 bg-beige p-4 sm:p-7">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">اليوم</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="زيارات الآن"
            value={toArabicDigits(stats.live.sessions_now)}
            hint="آخر ٣٠ دقيقة"
          />
          <Stat label="زيارات اليوم" value={toArabicDigits(stats.live.sessions_today)} hint="أي زائر" />
          <Stat
            label="داخلين بحساب"
            value={toArabicDigits(stats.live.people_today)}
            hint="مسجّلين دخول بس"
          />
          <Stat label="فتحات اليوم" value={toArabicDigits(stats.live.opens_today)} />
        </div>
        {/* ⚠️ This sentence is why the two numbers may sit side by side at all. */}
        <p className="mt-3 text-[11px] leading-relaxed text-ink/40">
          «الزيارات» تحسب أي واحد يفتح الموقع حتى لو ما عنده حساب، و«داخلين بحساب» تحسب بس
          المسجّلين دخول. مصدرين مختلفين — ما ننجمعهم ولا نقسمهم على بعض.
        </p>
      </section>

      {/* ── النمو ─────────────────────────────────────────────────────────── */}
      <Section
        title="النمو"
        note={`الحسابات كلها منذ فتح المحل${
          stats.since.users ? ` (${arDay(stats.since.users)})` : ""
        } — ${toArabicDigits(totalAccounts)} حساب.`}
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-bold text-ink/60">تسجيلات جديدة بالشهر</p>
            <Bars
              emptyLabel="ما بعد أكو تسجيلات."
              rows={stats.growth.by_month.map((m) => ({
                key: m.month,
                label: arMonth(m.month),
                value: m.total,
                sub: m.reps ? `${toArabicDigits(m.reps)} ممثل` : undefined,
              }))}
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-bold text-ink/60">الطلبات بالأسبوع</p>
            <Bars
              emptyLabel="ما بعد أكو طلبات."
              rows={stats.growth.orders_by_week.map((w) => ({
                key: w.week,
                label: arDay(w.week),
                value: w.orders,
                sub: `${toArabicDigits(w.students)} طالب`,
              }))}
            />
          </div>
        </div>
      </Section>

      {/* ── منو يفتح التطبيق ──────────────────────────────────────────────── */}
      <Section
        title="منو يفتح التطبيق"
        note={
          stats.since.app_opens
            ? `القياس بدأ ${arDay(stats.since.app_opens)} — ما قبله ما مسجّل بأي مكان. ويحسب بس اللي داخل بحساب.`
            : "ما وصلت أي فتحة بعد."
        }
      >
        <div className="space-y-3">
          {stats.reach.by_role
            .filter((r) => r.accounts > 0)
            .map((r) => {
              const pct = r.accounts ? Math.round((r.ever_opened / r.accounts) * 100) : 0;
              const nativePct = r.accounts ? Math.round((r.native_users / r.accounts) * 100) : 0;
              return (
                <div key={r.role} className="rounded-2xl border border-ink/10 bg-white/60 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-ink">{ROLE_LABEL[r.role] ?? r.role}</span>
                    <span className="text-xs text-ink/50">
                      {toArabicDigits(r.accounts)} حساب
                    </span>
                  </div>
                  {/* Two nested bars, not two rows: النسبة على التطبيق دائماً جزء من اللي فتحوا. */}
                  <div className="relative mt-2 h-6 overflow-hidden rounded-lg bg-ink/5">
                    <div className="absolute inset-y-0 right-0 bg-orange/25" style={{ width: `${pct}%` }} />
                    <div className="absolute inset-y-0 right-0 bg-orange/80" style={{ width: `${nativePct}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink/50">
                    فتحوا ولو مرة: <b className="text-ink">{toArabicDigits(r.ever_opened)}</b> (
                    {toArabicDigits(pct)}٪) · منهم على التطبيق:{" "}
                    <b className="text-ink">{toArabicDigits(r.native_users)}</b> ({toArabicDigits(nativePct)}٪)
                  </p>
                </div>
              );
            })}
        </div>

        <p className="mt-4 mb-2 text-xs font-bold text-ink/60">على أي جهاز (آخر {toArabicDigits(stats.window_days)} يوم)</p>
        <Bars
          emptyLabel="ما أكو فتحات بهذه المدة."
          rows={stats.reach.by_platform.map((p) => ({
            key: `${p.platform}-${p.role}`,
            label: PLATFORM_LABEL[p.platform] ?? p.platform,
            value: p.people,
            sub: ROLE_LABEL[p.role] ?? p.role,
          }))}
        />
        {students && (
          <p className="mt-3 text-[11px] leading-relaxed text-ink/40">
            المهم قبل ما نقفل المتصفح: {toArabicDigits(students.accounts - students.native_users)} طالب
            ما فتح التطبيق ولا مرة — هؤلاء اللي راح يوصلهم «نزّل التطبيق».
          </p>
        )}
      </Section>

      {/* ── الأجهزة ───────────────────────────────────────────────────────── */}
      <Section
        title="الأجهزة المسجّلة"
        note="هذا مو عدد التنزيلات — الجهاز ينحسب بس إذا نزّل، وسجّل دخول، ووافق على الإشعارات. الرقم الحقيقي أكبر، وما نعرفه إلا من حساب Google Play و App Store."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="أندرويد"
            value={toArabicDigits(androidDev?.devices ?? 0)}
            hint={`${toArabicDigits(androidDev?.new_7d ?? 0)} جديد هذا الأسبوع`}
          />
          <Stat
            label="آيفون"
            value={toArabicDigits(iosDev?.devices ?? 0)}
            hint={`${toArabicDigits(iosDev?.new_7d ?? 0)} جديد هذا الأسبوع`}
          />
          <Stat label="المجموع" value={toArabicDigits(totalDevices)} />
          <Stat
            label="بلا حساب"
            value={toArabicDigits((androidDev?.anon ?? 0) + (iosDev?.anon ?? 0))}
            hint="جهاز وافق على الإشعارات بلا تسجيل دخول"
          />
        </div>
        <p className="mt-4 mb-2 text-xs font-bold text-ink/60">أجهزة جديدة بالأسبوع</p>
        <Bars
          emptyLabel="ما بعد أكو أجهزة."
          rows={stats.installs.by_week.map((w) => ({
            key: `${w.week}-${w.platform}`,
            label: arDay(w.week),
            value: w.devices,
            sub: PLATFORM_LABEL[w.platform] ?? w.platform,
          }))}
        />
        <Link
          href="/admin/app"
          className="mt-4 inline-block text-xs font-bold text-orange underline underline-offset-4"
        >
          تفاصيل التطبيق والإشعارات ←
        </Link>
      </Section>

      {/* ── وين يقضون وقتهم ───────────────────────────────────────────────── */}
      <Section
        title="وين يقضون وقتهم"
        note={`كل سطر ${toArabicDigits(stats.pages.slice_minutes)} دقائق تقريباً، محسوبة من الزيارات${
          stats.since.visits ? ` منذ ${arDay(stats.since.visits)}` : ""
        }. تشمل الزوار بلا حساب، بس ما تميّز التطبيق عن المتصفح، وتغطي صفحات الطلاب فقط.`}
      >
        <div className="space-y-2">
          {stats.pages.top.length === 0 && <p className="text-sm text-ink/40">ما أكو زيارات بهذه المدة.</p>}
          {stats.pages.top.map((p) => {
            const perSession = p.sessions ? p.approx_minutes / p.sessions : 0;
            return (
              <div
                key={p.path}
                className="flex items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white/60 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">
                    {PATH_LABEL[p.path] ?? p.path}
                  </p>
                  <p className="truncate text-[10px] text-ink/40">{p.path}</p>
                </div>
                <div className="shrink-0 text-left">
                  <p className="font-display text-sm font-bold tabular-nums text-ink">
                    {toArabicDigits(p.sessions)} زيارة
                  </p>
                  <p className="text-[10px] text-ink/50">
                    ~{toArabicDigits(perSession.toFixed(1))} دقيقة للزيارة
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* ⚠️ THE GATE'S SCOREBOARD. This is the only split that sees a visitor with no
            account, so after «التطبيق فقط» is switched on it is what says whether browser
            traffic actually moved to the app. «غير معروف» is everything recorded before the
            platform column existed — it is not «متصفح» and must not be added to it. */}
        <p className="mt-5 mb-2 text-xs font-bold text-ink/60">
          من التطبيق لو من المتصفح (آخر {toArabicDigits(stats.window_days)} يوم)
        </p>
        <Bars
          emptyLabel="ما أكو زيارات بهذه المدة."
          rows={stats.pages.by_platform.map((p) => ({
            key: p.platform,
            label: PLATFORM_LABEL[p.platform] ?? p.platform,
            value: p.sessions,
          }))}
        />
        {stats.pages.by_platform.some((p) => p.platform === "unknown") && (
          <p className="mt-2 text-[10px] leading-relaxed text-ink/40">
            «غير معروف» = زيارات انسجّلت قبل ما نبدي نميّز التطبيق عن المتصفح. تنقص لحالها كل
            أسبوع.
          </p>
        )}

        <p className="mt-4 mb-2 text-xs font-bold text-ink/60">الزيارات بالأسبوع</p>
        <Bars
          emptyLabel="ما أكو زيارات."
          rows={stats.pages.sessions_by_week.map((w) => ({
            key: w.week,
            label: arDay(w.week),
            value: w.sessions,
          }))}
        />
      </Section>
    </div>
  );
}
