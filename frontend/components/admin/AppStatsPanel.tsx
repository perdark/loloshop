"use client";

/**
 * «إحصائيات التطبيق على المنصتين» — how the app is doing on Android and iOS.
 *
 * ⚠️ THE TWO BLOCKS MEASURE DIFFERENT THINGS AND ARE NEVER ADDED TOGETHER.
 *   · أجهزة — a row exists only if the person installed the app, signed in, AND granted the
 *     notification prompt. It is a FLOOR on installs; someone who declined notifications is a
 *     real user with no row. Calling it «تنزيلات» would be a lie the owner would then plan on.
 *   · فتحات — real usage, but only since migration 087 deployed. There is nothing to backfill
 *     from, so the panel states the start date instead of drawing a flat line at zero, which
 *     reads as «nobody uses the app».
 *
 * ⚠️ iOS shows zero everywhere until someone installs 1.0.4 from TestFlight and grants the
 * prompt. That is a fact about the release, not a bug in this page. The panel used to say so in
 * a banner; the owner asked for it removed (2026-08-25), so the explanation lives here instead —
 * do not read a zero iOS column as a broken push pipeline without checking device_tokens first.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { toArabicDigits } from "@/lib/format";
import { getAppStats, type AppStats } from "@/lib/admin";

const ROLE_LABEL: Record<string, string> = {
  retail: "طلاب",
  wholesaler: "ممثلون",
  staff: "موظفون",
  admin: "إدارة",
};

const PLATFORM_LABEL: Record<string, string> = {
  android: "أندرويد",
  ios: "آيفون",
  web: "متصفح",
  unknown: "غير معروف",
};

const PLATFORM_BAR: Record<string, string> = {
  android: "bg-orange",
  ios: "bg-ink/60",
  web: "bg-ink/25",
  unknown: "bg-ink/15",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white/60 px-4 py-3">
      <p className="text-[11px] text-ink/50">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-ink/40">{hint}</p>}
    </div>
  );
}

/** Arabic date, short. Falls back to the raw string rather than throwing on a bad value. */
function arDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ar-IQ", { day: "numeric", month: "short" });
}

export function AppStatsPanel() {
  const [stats, setStats] = useState<AppStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await getAppStats(30));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل إحصائيات التطبيق"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** One bar per day, stacked by platform. A plain div chart — no library, no audit surface. */
  const chart = useMemo(() => {
    if (!stats) return { days: [], max: 0, platforms: [] as string[] };
    const byDay = new Map<string, Record<string, number>>();
    const platforms = new Set<string>();
    for (const row of stats.usage.daily) {
      const key = String(row.day).slice(0, 10);
      const bucket = byDay.get(key) ?? {};
      bucket[row.platform] = (bucket[row.platform] ?? 0) + row.opens;
      byDay.set(key, bucket);
      platforms.add(row.platform);
    }
    const days = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({
        day,
        counts,
        total: Object.values(counts).reduce((n, v) => n + v, 0),
      }));
    return { days, max: Math.max(1, ...days.map((d) => d.total)), platforms: [...platforms] };
  }, [stats]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-24 w-full rounded-2xl" />
        <div className="skeleton h-48 w-full rounded-2xl" />
      </div>
    );
  }
  if (!stats) return null;

  const { android, ios } = stats.devices.by_platform;

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      {/* ── Devices ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-ink/10 bg-beige p-5 sm:p-7">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">الأجهزة المسجّلة</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink/50">
          هذا مو عدد التنزيلات — الجهاز ينحسب بس إذا نزّل التطبيق، وسجّل دخول، ووافق على
          الإشعارات. يعني الرقم الحقيقي أكبر من هذا دائماً.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="أندرويد" value={toArabicDigits(android.devices)} hint={`${toArabicDigits(android.new_7d)} جديد هذا الأسبوع`} />
          <Stat label="آيفون" value={toArabicDigits(ios.devices)} hint={`${toArabicDigits(ios.new_7d)} جديد هذا الأسبوع`} />
          <Stat label="المجموع" value={toArabicDigits(stats.devices.total)} hint={`${toArabicDigits(stats.devices.people)} شخص`} />
          <Stat
            label="فعّالة آخر ٧ أيام"
            value={toArabicDigits(android.active_7d + ios.active_7d)}
            hint="الجهاز يستلم الإشعارات"
          />
        </div>

      </section>

      {/* ── Usage ───────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-ink/10 bg-beige p-5 sm:p-7">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">فتحات التطبيق</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink/50">
          كل مرة ينفتح بيها التطبيق بعد ما يكون مسكّر أكثر من نص ساعة. تبديل التبويب ما ينحسب
          فتحة جديدة.
        </p>

        {!stats.usage.tracking_since ? (
          <div className="mt-4 rounded-xl border border-ink/10 bg-white/60 px-4 py-5 text-center">
            <p className="text-sm font-semibold text-ink">القياس ما بدأ بعد.</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/50">
              أول قراءة تجي أول ما يفتح أي شخص التطبيق بعد آخر تحديث. ما نقدر نرجع للأيام
              الماضية — ما كان في شي يسجّلها.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="فتحات اليوم" value={toArabicDigits(stats.usage.today_opens)} />
              <Stat label="ناس فتحوا اليوم" value={toArabicDigits(stats.usage.today_users)} />
              <Stat
                label={`ناس فتحوا آخر ${toArabicDigits(stats.window_days)} يوم`}
                value={toArabicDigits(stats.usage.active_users)}
              />
              <Stat label="القياس بدأ" value={arDate(stats.usage.tracking_since)} hint="ما قبله ما مسجّل" />
            </div>

            {/* Daily bars */}
            <div className="mt-6">
              <div className="flex h-40 items-end gap-[3px] overflow-x-auto rounded-xl border border-ink/10 bg-white/60 p-3">
                {chart.days.map((d) => (
                  <div
                    key={d.day}
                    className="flex min-w-[8px] flex-1 flex-col justify-end"
                    title={`${d.day} — ${d.total}`}
                  >
                    {Object.entries(d.counts).map(([platform, n]) => (
                      <div
                        key={platform}
                        className={`w-full ${PLATFORM_BAR[platform] ?? PLATFORM_BAR.unknown}`}
                        style={{ height: `${(n / chart.max) * 100}%` }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-ink/50">
                {chart.platforms.map((p) => (
                  <span key={p} className="flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${PLATFORM_BAR[p] ?? PLATFORM_BAR.unknown}`} />
                    {PLATFORM_LABEL[p] ?? p}
                  </span>
                ))}
                <span className="ms-auto tabular-nums">آخر {toArabicDigits(stats.window_days)} يوم</span>
              </div>
            </div>

            {/* Which build people are actually on — the row that explains a platform with
                zero device tokens. An app older than the version beacon reports nothing, and on
                iOS that is itself the likely answer: a build before 1.0.4 cannot register for
                push at all. */}
            {stats.usage.by_version.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-xs font-semibold text-ink/70">نسخة التطبيق المستعملة</h3>
                <ul className="space-y-2">
                  {stats.usage.by_version.map((v) => (
                    <li
                      key={`${v.platform}:${v.app_version}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white/60 px-4 py-2.5"
                    >
                      <span className="text-sm text-ink">
                        {PLATFORM_LABEL[v.platform] ?? v.platform}
                        <span className="ms-2 text-xs text-ink/50">{v.app_version}</span>
                      </span>
                      <span className="text-xs tabular-nums text-ink/60">
                        {toArabicDigits(v.users)} شخص
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Who */}
            {stats.usage.by_role.length > 0 && (
              <ul className="mt-5 space-y-2">
                {stats.usage.by_role.map((r) => (
                  <li
                    key={r.role}
                    className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white/60 px-4 py-2.5"
                  >
                    <span className="text-sm text-ink">{ROLE_LABEL[r.role] ?? r.role}</span>
                    <span className="text-xs tabular-nums text-ink/60">
                      {toArabicDigits(r.users)} شخص · {toArabicDigits(r.opens)} فتحة
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ── Registration failures ───────────────────────────────────────── */}
      {stats.register_errors.length > 0 && (
        <section className="rounded-2xl border border-danger/30 bg-danger/5 p-5 sm:p-7">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">
            أجهزة ما كدرت تسجّل للإشعارات
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-ink/60">
            هذا السبب اللي يعطيه التلفون نفسه. ظهور أي سطر هنا يعني الإشعارات ما توصل لهذاك
            الجهاز، وسبب المشكلة مكتوب بالسطر.
          </p>
          <ul className="mt-4 space-y-2">
            {stats.register_errors.map((e, i) => (
              <li
                key={`${e.platform}:${e.app_version}:${i}`}
                className="rounded-xl border border-danger/20 bg-white/70 px-4 py-3"
              >
                <p className="text-xs font-semibold text-ink">
                  {PLATFORM_LABEL[e.platform ?? "unknown"] ?? e.platform}
                  {e.app_version ? ` · ${e.app_version}` : ""} ·{" "}
                  {toArabicDigits(e.hits)} مرة
                </p>
                <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-danger">
                  {e.message || "—"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
