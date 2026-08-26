"use client";

/**
 * «راتبي ونشاطي» — the month, in the order a person asks about it.
 *
 * Owner request 2026-08-27: «الأيام يلي أنجز بيها والساعات وعدد الفتحات وتقصيره والخصومات
 * وليش والحوافز وليش وكلشي». So the rule this panel is built on is: **every number carries
 * its own sentence**. A figure with no reason beside it is the thing this page exists to
 * remove, and anything that cannot explain itself does not get a tile.
 *
 * ⚠️ THE TWO LEDGERS ARE KEPT APART ON PURPOSE. «مبلغ التأخير» on an attendance record is
 * NEVER posted to the salary ledger — nothing writes that transaction, and
 * `deduction_transaction_id` is only ever cleared. Folding it into «الرصيد» would show a debt
 * the shop has not charged, so the التأخير section says «معروض — ما انخصم من راتبك» in as many
 * words. If lateness ever does start charging, that sentence is the first thing to change.
 *
 * Phone-first: staff are on an iPad and a phone. No table anywhere — a table at 390px either
 * scrolls sideways or shrinks past reading size, and this screen is about being readable.
 */

import { useCallback, useEffect, useState } from "react";
import { getMySummary, type MySummary, type MySummaryDay } from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import { formatIQD, formatShiftRange, formatTime12 } from "@/lib/format";

/** 480 → «٨ ساعة» … no: «8 س 0 د». Minutes matter to someone checking their own hours. */
function hours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!minutes) return "—";
  if (!h) return `${m} د`;
  return m ? `${h} س ${m} د` : `${h} س`;
}

/** An ISO timestamp → the wall clock at the shop, in ص/م. */
function clockAt(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return formatTime12(parts);
}

/** 'YYYY-MM' shifted by whole months, without a date library. */
function shiftMonth(monthKey: string, by: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHS_AR = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}

function Tile({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "warm" | "danger" | "good";
}) {
  const cls =
    tone === "warm"
      ? "border-orange-ink/20 bg-warm-veil"
      : tone === "danger"
        ? "border-danger/25 bg-danger/5"
        : tone === "good"
          ? "border-emerald-500/30 bg-emerald-50/60"
          : "border-line bg-surface";
  return (
    <div className={`rounded-2xl border p-4 shadow-[var(--shadow-soft)] ${cls}`}>
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function DayRow({ d, timeZone }: { d: MySummaryDay; timeZone: string }) {
  const worked = !!d.check_in_at;
  const badge = d.holiday_ar
    ? { text: d.holiday_ar, cls: "bg-orange/10 text-orange-ink" }
    : d.is_off
      ? { text: "مغلق", cls: "bg-surface-sink text-muted" }
      : d.absent
        ? { text: "غياب", cls: "bg-danger/10 text-danger" }
        : worked
          ? d.late_minutes > 0
            ? { text: `تأخير ${d.late_minutes} د`, cls: "bg-danger/10 text-danger" }
            : { text: "بالوقت", cls: "bg-emerald-500/10 text-emerald-700" }
          : null;

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-sm font-bold text-ink">{d.date.slice(8)}</span>
          <span className="text-xs text-ink-soft">{d.weekday_label_ar}</span>
        </div>
        {badge && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
            {badge.text}
          </span>
        )}
      </div>

      {worked ? (
        <p className="mt-0.5 text-xs text-ink-soft">
          {clockAt(d.check_in_at, timeZone)} ← {clockAt(d.check_out_at, timeZone)}
          {" · "}
          <span className="font-medium text-ink">{hours(d.worked_minutes)}</span>
          {d.break_minutes > 0 && ` · فتحات ${d.break_minutes} د`}
          {d.pieces > 0 && ` · ${d.pieces} قطعة`}
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-muted">
          {d.is_off || d.holiday_ar
            ? "ما في دوام"
            : `الدوام ${formatShiftRange(d.expected_start_time, d.expected_end_time)}`}
        </p>
      )}

      {d.note_ar && <p className="mt-0.5 text-xs text-orange-ink">{d.note_ar}</p>}
    </li>
  );
}

export function MyMonthPanel({ initialMonth }: { initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth || "");
  const [data, setData] = useState<MySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllDays, setShowAllDays] = useState(false);

  const load = useCallback(async (m?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMySummary(m || undefined);
      setData(res);
      setMonth(res.month);
    } catch (e) {
      setError(getApiErrorMessage(e, "تعذر تحميل بيانات الشهر"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(initialMonth);
  }, [load, initialMonth]);

  if (loading && !data) {
    return <p className="text-sm text-ink-soft">جارٍ تحميل بيانات الشهر…</p>;
  }
  if (error && !data) {
    return (
      <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void load(month)}
          className="mt-3 min-h-[44px] rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }
  if (!data) return null;

  const t = data.totals;
  const lateDays = data.days.filter((d) => d.late_minutes > 0);
  const visibleDays = showAllDays ? data.days : data.days.filter((d) => d.check_in_at || d.absent);

  return (
    <div className="space-y-5">
      {/* ── month picker — 44px targets, the whole audience is on a phone ── */}
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface p-2">
        <button
          type="button"
          onClick={() => void load(shiftMonth(month, -1))}
          className="min-h-11 min-w-11 rounded-xl px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-sink"
        >
          ‹ السابق
        </button>
        <span className="font-display text-sm font-bold text-ink">{monthLabel(month)}</span>
        <button
          type="button"
          onClick={() => void load(shiftMonth(month, 1))}
          className="min-h-11 min-w-11 rounded-xl px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-sink"
        >
          التالي ›
        </button>
      </div>

      {/* ── الملخص ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="أيام دوام" value={String(t.worked_days)} hint={t.absent_days ? `${t.absent_days} يوم غياب` : undefined} tone="good" />
        <Tile label="ساعات العمل" value={hours(t.worked_minutes)} hint="بدون وقت الفتحات" />
        <Tile label="التأخير" value={t.late_days ? `${t.late_days} يوم · ${t.late_minutes} د` : "ما في"} tone={t.late_days ? "danger" : "plain"} />
        <Tile label="القطع المنجزة" value={String(t.pieces)} hint="بهذا الشهر" tone="warm" />
      </div>

      {/* ── الحضور يوم بيوم ── */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">الحضور يوم بيوم</h2>
          <button
            type="button"
            onClick={() => setShowAllDays((v) => !v)}
            className="min-h-11 rounded-xl px-2 text-xs font-medium text-orange-ink"
          >
            {showAllDays ? "أيام الدوام فقط" : "كل أيام الشهر"}
          </button>
        </div>
        {visibleDays.length ? (
          <ul className="divide-y divide-line">
            {visibleDays.map((d) => (
              <DayRow key={d.date} d={d} timeZone={data.timezone} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">ما في بصمات بهذا الشهر.</p>
        )}
      </section>

      {/* ── التأخير: every line says the date, the minutes, and what it would cost ── */}
      {lateDays.length > 0 && (
        <section className="rounded-2xl border border-danger/25 bg-surface p-5 shadow-[var(--shadow-soft)]">
          <h2 className="font-display text-base font-semibold text-ink">التأخير</h2>
          {/* Said plainly, because the number looks like a deduction and is not one. */}
          <p className="mt-1 text-xs text-muted">
            هذي الأرقام <b className="text-ink-soft">معروضة</b> — ما انخصمت من راتبك. الخصومات
            الفعلية كلها بقسم «سجل الراتب».
          </p>
          <ul className="mt-3 divide-y divide-line">
            {lateDays.map((d) => (
              <li key={d.date} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {d.date} · {d.weekday_label_ar}
                  </p>
                  <p className="text-xs text-ink-soft">
                    الدوام {formatTime12(d.expected_start_time)} · دخلت{" "}
                    {clockAt(d.check_in_at, data.timezone)} · تأخير {d.late_minutes} دقيقة
                  </p>
                </div>
                <span className="shrink-0 font-display text-sm font-bold text-danger">
                  {formatIQD(d.late_amount_shown)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── الفتحات ── */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
        <h2 className="font-display text-base font-semibold text-ink">الخروج المؤقت (الفتحات)</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="عدد الفتحات" value={String(data.breaks.break_count)} />
          <Tile label="الدقائق المستعملة" value={`${data.breaks.used_minutes} د`} hint={`من ${data.breaks.allowance_minutes} د بالشهر`} />
          <Tile label="المتبقي مجاناً" value={`${data.breaks.remaining_minutes} د`} tone={data.breaks.remaining_minutes > 0 ? "good" : "danger"} />
          <Tile label="المخصوم" value={formatIQD(data.breaks.deduction_amount)} hint={`${data.breaks.deducted_minutes} دقيقة`} tone={data.breaks.deduction_amount ? "danger" : "plain"} />
        </div>

        {data.breaks.rows.length ? (
          <ul className="mt-3 divide-y divide-line">
            {data.breaks.rows.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {b.work_date} · {b.minutes} دقيقة
                  </p>
                  <p className="text-xs text-ink-soft">
                    {b.reason_ar || "بدون سبب مكتوب"}
                    {" · "}
                    {b.approval === "approved"
                      ? "مصرَّح"
                      : b.approval === "rejected"
                        ? "مرفوض"
                        : "بانتظار الموافقة"}
                    {b.left_without_approval && " · خرج قبل الموافقة"}
                    {b.auto_closed && " · انسكر تلقائياً"}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-display text-sm font-bold ${
                    b.deduction_amount ? "text-danger" : "text-emerald-600"
                  }`}
                >
                  {b.deduction_amount ? `− ${formatIQD(b.deduction_amount)}` : "مجاني"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">ما في فتحات بهذا الشهر.</p>
        )}
      </section>

      {/* ── جدول الدوام — so «ليش انحسبت متأخر» is answerable without asking anyone ── */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
        <h2 className="mb-2 font-display text-base font-semibold text-ink">دوام الأسبوع</h2>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {data.schedule.map((d) => (
            <li key={d.weekday} className="flex items-center justify-between gap-3 rounded-lg bg-surface-sink px-3 py-2">
              <span className="text-sm font-medium text-ink">{d.label_ar}</span>
              <span className="text-sm text-ink-soft">
                {d.is_off ? "مغلق" : formatShiftRange(d.start_time, d.end_time)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
