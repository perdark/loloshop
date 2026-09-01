"use client";

/**
 * «حصيلة شهرك وراتبك» — the one card a worker opens this page for.
 *
 * ⚠️ EVERY NUMBER HERE IS READ, NEVER COMPUTED. The statement is a snapshot the shop froze
 * when it decided what to pay (migration 099). Recomputing anything on the client — even
 * something as innocent as `gross - lateDeduction` — reintroduces exactly the drift the table
 * exists to prevent, because the row also carries hand-entered lines this component does not
 * know about. Render `net` as it came.
 *
 * ⚠️ THE «سيتم تسليمه» SENTENCE IS `note_ar` FROM THE ROW, NOT A CONSTANT. It is a promise
 * about cash made to a specific person for a specific month; hard-coding it would keep making
 * that promise on every future month, including after the money was handed over.
 *
 * Phone-first, and no table anywhere — same rule MyMonthPanel is built on. Staff read this on
 * a phone; a table at 390px either scrolls sideways or shrinks past reading size.
 */

import { useEffect, useState } from "react";
import { getMyStatement, type MyStatement, type StatementDay } from "@/lib/staff";
import { getApiErrorMessage } from "@/lib/api";
import { formatIQD } from "@/lib/format";

const MONTHS_AR = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}

/** «٣٨٠ دقيقة» reads badly past an hour. 380 → «6 س 20 د». */
function minutesLabel(total: number): string {
  if (!total) return "صفر";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} دقيقة`;
  return m ? `${h} س ${m} د` : `${h} ساعة`;
}

function Line({
  label,
  sub,
  amount,
  tone = "plain",
}: {
  label: string;
  sub?: string;
  amount: number;
  tone?: "plain" | "minus" | "total";
}) {
  return (
    <div
      className={
        tone === "total"
          ? "flex items-baseline justify-between gap-3 border-t-2 border-line pt-3"
          : "flex items-baseline justify-between gap-3 border-b border-dashed border-line py-2.5"
      }
    >
      <div className="min-w-0">
        <p
          className={
            tone === "total"
              ? "font-display text-base font-bold text-ink"
              : "text-sm text-ink-soft"
          }
        >
          {label}
        </p>
        {sub && <p className="mt-0.5 text-xs text-ink-soft/70">{sub}</p>}
      </div>
      <p
        className={
          tone === "total"
            ? "shrink-0 font-display text-xl font-bold text-ink"
            : tone === "minus"
              ? "shrink-0 text-sm font-bold text-danger"
              : "shrink-0 text-sm font-bold text-ink"
        }
      >
        {tone === "minus" && amount > 0 ? `− ${formatIQD(amount)}` : formatIQD(amount)}
      </p>
    </div>
  );
}

function DayRow({ day, minuteRate }: { day: StatementDay; minuteRate: number }) {
  const label = `${day.d} ${day.w}${day.fr ? " · الجمعة" : ""}`;
  let state: { text: string; cls: string };
  if (day.kind === "gap" && day.paidLeave) {
    state = { text: "إجازة مدفوعة", cls: "text-ink-soft" };
  } else if (day.kind === "gap") {
    state = { text: "غياب — غير مدفوع", cls: "text-danger" };
  } else if (day.kind === "stray") {
    state = { text: "بصمة خطأ جهاز", cls: "text-ink-soft" };
  } else if (day.wiped) {
    state = { text: `تأخير ${minutesLabel(day.wiped)} — ما انخصم`, cls: "text-amber-700" };
  } else if (day.late) {
    state = { text: `تأخير ${day.late} دقيقة × ${formatIQD(minuteRate)}`, cls: "text-danger" };
  } else {
    state = { text: day.kind === "half" ? "نص شفت" : "شفت كامل", cls: "text-emerald-700" };
  }

  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-line/60 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className={`mt-0.5 text-xs ${state.cls}`}>{state.text}</p>
      </div>
      <div className="shrink-0 text-end">
        <p className="text-sm font-bold text-ink">{formatIQD(day.pay)}</p>
        {day.cut > 0 && (
          <p className="text-xs font-bold text-danger">− {formatIQD(day.cut)}</p>
        )}
      </div>
    </li>
  );
}

export function MonthlyStatementCard() {
  const [statement, setStatement] = useState<MyStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyStatement()
      .then((s) => { if (alive) setStatement(s); })
      .catch((err) => { if (alive) setError(getApiErrorMessage(err, "تعذّر تحميل كشف راتبك")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // No published statement is the normal state for most of the month — render nothing at all
  // rather than an empty card that reads like something is broken.
  if (loading || error || !statement) return null;

  const s = statement;
  const flagged = s.days.filter(
    (d) => d.kind === "gap" || d.kind === "stray" || d.late > 0 || d.wiped > 0
  );
  const shown = flagged.length ? flagged : s.days;

  return (
    <section className="overflow-hidden rounded-2xl border border-orange-ink/25 bg-warm-veil shadow-[var(--shadow-soft)]">
      <div className="border-b border-orange-ink/15 px-5 pt-5 pb-4">
        <p className="text-xs font-bold tracking-wide text-orange-ink">
          حصيلة شهرك وراتبك · {monthLabel(s.month)}
        </p>
        <p className="mt-2 font-display text-4xl font-bold leading-tight text-ink">
          {formatIQD(s.net)}
        </p>
        {s.noteAr && <p className="mt-2 text-sm font-medium text-ink-soft">{s.noteAr}</p>}
      </div>

      <div className="bg-surface px-5 py-4">
        {s.fullShifts > 0 && (
          <Line
            label={`${s.fullShifts} شفت كامل`}
            sub={`× ${formatIQD(s.dayRate)}`}
            amount={s.fullShifts * s.dayRate}
          />
        )}
        {s.halfShifts > 0 && (
          <Line
            label={`${s.halfShifts} نص شفت`}
            sub={`× ${formatIQD(s.halfRate)}`}
            amount={s.halfShifts * s.halfRate}
          />
        )}
        {s.leaveDays > 0 && (
          <Line
            label={`${s.leaveDays} يوم إجازة مدفوعة`}
            sub={`× ${formatIQD(s.dayRate)}`}
            amount={s.leaveDays * s.dayRate}
          />
        )}
        {s.unpaidDays > 0 && (
          <Line label={`${s.unpaidDays} يوم غياب`} sub="غير مدفوع" amount={0} />
        )}

        <Line label="المجموع قبل الخصم" amount={s.gross} />

        <Line
          label="خصم التأخير"
          sub={
            s.lateMinutes > 0
              ? `${minutesLabel(s.lateMinutes)} على ${s.lateDays} يوم · الدقيقة ${formatIQD(s.minuteRate)} · بعد سماح ${s.graceMinutes} دقيقة`
              : `صفر تأخير — سماح ${s.graceMinutes} دقيقة كل يوم`
          }
          amount={s.lateDeduction}
          tone="minus"
        />

        {s.otherDeduction > 0 && (
          <Line
            label={s.otherReasonAr || "خصم آخر"}
            amount={s.otherDeduction}
            tone="minus"
          />
        )}

        <div className="mt-3">
          <Line label="الصافي المستحق" amount={s.net} tone="total" />
        </div>

        {s.waivedMinutes > 0 && (
          <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-800">
            {minutesLabel(s.waivedMinutes)} تأخير إضافي <b>ما انخصمت عليك</b> — أي يوم تأخيره
            أكثر من ساعة يعتبر دوام غلط أو خطأ جهاز، مو تأخير.
          </p>
        )}

        <button
          type="button"
          onClick={() => setOpenDays((v) => !v)}
          aria-expanded={openDays}
          className="mt-4 min-h-[44px] w-full rounded-xl border border-line bg-surface-sink px-4 text-sm font-bold text-orange-ink"
        >
          {openDays ? "إخفاء تفاصيل الأيام" : `شوف أيامك يوم بيوم (${shown.length})`}
        </button>

        {openDays && (
          <ul className="mt-3">
            {shown.map((d) => (
              <DayRow key={d.d} day={d} minuteRate={s.minuteRate} />
            ))}
            {flagged.length > 0 && (
              <li className="pt-3 text-xs text-ink-soft">
                الأيام اللي ما تظهر هنا شفتات كاملة بلا تأخير.
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
