"use client";

import { formatDateShort } from "@/lib/format";

interface DailyOrdersChartProps {
  data: { date: string; count: number }[];
}

/* Convert Latin digits to Arabic-Indic so counts read in the page's voice. */
const toArabic = (n: number) =>
  String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/* Proportional vertical bar chart — bar height maps directly to order count.
   Days are laid out left-to-right in chronological order on a single row
   (no flex-wrap) so temporal direction is legible. Brand-warm orange bars,
   cream track, Amiri numerals. */
export function DailyOrdersChart({ data }: DailyOrdersChartProps) {
  if (!data.length) {
    return (
      <p className="py-10 text-center text-sm text-[var(--shop-muted)]">
        لا توجد طلبات بعد
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  /* Chart track height — bars scale within this space. */
  const TRACK_H = 120; /* px */

  return (
    <div>
      {/* Summary line */}
      <div className="mb-4 flex justify-end">
        <span className="text-xs font-medium text-[var(--shop-muted)]">
          إجمالي {toArabic(total)} طلب · {toArabic(data.length)} أيام
        </span>
      </div>

      {/* Scrollable wrapper so many days never overflow on mobile */}
      <div className="overflow-x-auto pb-1">
        <ol
          className="flex items-end gap-2 p-0"
          style={{ minWidth: `${data.length * 44}px` }}
          aria-label="طلبات يومية"
        >
          {data.map((d) => {
            const peak = d.count === max;
            const pct = max > 0 ? d.count / max : 0;
            const barH = Math.max(Math.round(pct * TRACK_H), 4); /* min 4px so 0-count days show a hairline */

            return (
              <li
                key={d.date}
                className="flex min-w-[40px] flex-1 flex-col items-center gap-1"
              >
                {/* Count label above the bar */}
                <span
                  className={`text-[11px] font-bold tabular-nums ${peak ? "text-orange-ink" : "text-[var(--shop-muted)]"}`}
                  style={{ fontFamily: "var(--font-amiri)" }}
                >
                  {toArabic(d.count)}
                </span>

                {/* Bar track */}
                <div
                  className="w-full rounded-sm bg-ink/[0.06]"
                  style={{ height: `${TRACK_H}px` }}
                  aria-hidden
                >
                  {/* Filled portion — grows from bottom via margin-top trick.
                      Only the peak day earns orange; the rest stay quiet ink. */}
                  <div
                    className={`w-full rounded-sm transition-all duration-500 ${peak ? "bg-orange-ink" : "bg-ink/20"}`}
                    style={{
                      height: `${barH}px`,
                      marginTop: `${TRACK_H - barH}px`,
                    }}
                  />
                </div>

                {/* Date label below the bar */}
                <span
                  dir="ltr"
                  className={`mt-1 whitespace-nowrap text-[10px] ${peak ? "font-bold text-orange-ink" : "text-[var(--shop-muted)]"}`}
                >
                  {formatDateShort(d.date)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
