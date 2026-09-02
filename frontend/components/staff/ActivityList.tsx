"use client";

/**
 * One shared activity list for `/staff/team` (admin reading a worker's log) and `/staff/me`
 * (a worker reading their own) — both now call `backend/lib/staffActivity.js`'s one builder,
 * so this is the one place the Arabic verbs, zone names and day grouping live. Previously each
 * page kept its own half-translated copy; `/staff/team` printed the raw DB keys
 * (`act.action`, `"embroidery ← pressing"`) and neither page grouped by day.
 *
 * Rows never carry money, price, cost, profit, phone or email — this list is read by the
 * worker themselves as much as by an admin. If a caller ever hands it a field like that, it is
 * a bug in the caller, not something to render here.
 */

import Link from "next/link";
import { ACTIVITY_ACTION_LABELS, ORDER_STATUS_LABELS, ZONE_LABELS } from "@/lib/constants";
import type { StaffActivity } from "@/lib/types";

const DAY = new Intl.DateTimeFormat("ar-IQ", {
  timeZone: "Asia/Baghdad",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const TIME = new Intl.DateTimeFormat("ar-IQ", {
  timeZone: "Asia/Baghdad",
  hour: "numeric",
  minute: "2-digit",
});
/** 'YYYY-MM-DD' at the shop's own timezone — the grouping key, not a display string. */
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });

/** Arabic stage name for a raw `order_status` value, degrading to the key itself if unknown —
 *  `from_stage`/`to_stage` are free-text columns in Postgres, `ORDER_STATUS_LABELS` is not. */
function stageLabel(s: string): string {
  return (ORDER_STATUS_LABELS as Record<string, string>)[s] ?? s;
}

export function ActivityList({
  rows,
  linkOrders = true,
}: {
  rows: StaffActivity[];
  linkOrders?: boolean;
}) {
  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-ink-soft">ما في نشاط بهذا الشهر.</p>;
  }

  const groups = new Map<string, StaffActivity[]>();
  for (const r of rows) {
    const k = dayKey(r.createdAt);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([k, list]) => (
        <section key={k}>
          <h3 className="mb-1 text-xs font-semibold text-muted">
            {DAY.format(new Date(list[0].createdAt))} · {list.length}
          </h3>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {list.map((a) => {
              const verb = ACTIVITY_ACTION_LABELS[a.action] ?? a.action;
              const detail = a.zone
                ? (ZONE_LABELS[a.zone] ?? a.zone)
                : a.fromStage && a.toStage
                  ? `${stageLabel(a.fromStage)} ← ${stageLabel(a.toStage)}`
                  : null;
              const body = (
                <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-medium ${
                        a.action.startsWith("revert") ? "text-danger" : "text-ink"
                      }`}
                    >
                      {verb}
                      {a.productName ? ` — ${a.productName}` : ""}
                      {a.studentName ? ` · ${a.studentName}` : ""}
                    </p>
                    {detail && <p className="truncate text-xs text-ink-soft">{detail}</p>}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {TIME.format(new Date(a.createdAt))}
                  </span>
                </div>
              );
              return (
                <li key={a.id}>
                  {linkOrders && a.orderId ? (
                    <Link href={`/staff/orders/${a.orderId}`}>{body}</Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
