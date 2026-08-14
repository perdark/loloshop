"use client";

import Link from "next/link";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { toArabicDigits } from "@/lib/format";
import type { MonitorData } from "@/lib/staff-types";

/**
 * «يعمل الآن» on the admin dashboard (bug 1).
 *
 * The data and the manager console's panel have existed since the monitor tab shipped; what
 * was missing is that the owner had to leave /admin and open /staff to see who is at work.
 * This is the same rows, one query (GET /production/presence), rendered in the dashboard's
 * own visual language.
 *
 * PRESENTATIONAL ON PURPOSE. The parent already owns a 30s poll and an SSE subscription for
 * the whole dashboard; a second copy of either in here would open a second event stream and
 * double the traffic to say the same thing.
 */

/**
 * «منذ ٤ دقائق». Arabic counts a noun by its number, not by an -s: one, two, a few (3–10)
 * and many (11+) each take a different form, so a naive `${n} دقيقة` reads broken to every
 * user of this dashboard.
 *
 * Minutes only, deliberately: the backend's window is 30 minutes, so an hour cannot occur.
 */
function sinceArabic(iso: string): string {
  const started = new Date(iso).getTime();
  if (!Number.isFinite(started)) return "";
  const mins = Math.floor((Date.now() - started) / 60000);
  if (mins <= 0) return "بدأ الآن";
  if (mins === 1) return "منذ دقيقة";
  if (mins === 2) return "منذ دقيقتين";
  if (mins <= 10) return `منذ ${toArabicDigits(mins)} دقائق`;
  return `منذ ${toArabicDigits(mins)} دقيقة`;
}

export function PresencePanel({ rows }: { rows: MonitorData["working"] | null }) {
  // Nothing rendered until the first fetch resolves — an empty panel that later fills in
  // reads as "nobody is working", which is a different claim from "not loaded yet".
  if (rows === null) return null;

  return (
    <section className="mt-6" dir="rtl">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-ink-soft">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                rows.length > 0 ? "animate-pulse bg-green-500" : "bg-ink/20"
              }`}
            />
            يعمل الآن
          </p>
          {rows.length > 0 && (
            <span className="text-xs font-semibold tabular-nums text-ink-soft">
              {toArabicDigits(rows.length)}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            لا أحد يعمل على طلب الآن.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rows.map((w) => (
              <li key={w.id}>
                {/* Same destination the منتور tab uses. `from=/admin` so the order page's
                    back button returns HERE and not to the staff console. */}
                <Link
                  href={`/staff/orders/${w.id}?from=${encodeURIComponent("/admin")}`}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-sink/40 px-4 py-3 text-sm transition-colors hover:border-orange-ink/30 hover:bg-surface-sink"
                >
                  <span className="min-w-0 text-ink">
                    <span className="font-semibold">{w.working_staff_name}</span>
                    {" — "}
                    {w.product_name}
                    <span className="text-ink-soft"> · {w.student_name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2.5 py-0.5 text-xs font-semibold text-orange-ink">
                      {ORDER_STATUS_LABELS[w.status] ?? w.status}
                    </span>
                    <span className="text-xs text-ink-soft">{sinceArabic(w.working_since)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
