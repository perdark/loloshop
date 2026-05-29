import Link from "next/link";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatDateShort } from "@/lib/format";
import type { StaffOrder } from "@/lib/staff-types";

/**
 * Status badge classes using only palette tokens (no raw amber/blue/emerald/red).
 *
 * Scheme:
 *   - Active / in-progress states → orange-ink accent (warm, earned)
 *   - Neutral / waiting states    → ink-soft on surface-sink (quiet)
 *   - Delivered / done            → muted on surface-sink
 *   - Cancelled / problem         → danger token (warm brick)
 */
const STATUS_BADGE: Partial<Record<string, string>> = {
  design_complete: "bg-surface-sink text-orange-ink border border-orange-ink/30",
  staff_review:    "bg-orange-ink/10 text-orange-ink border border-orange-ink/25",
  printing:        "bg-orange-ink/15 text-orange-ink border border-orange-ink/30",
  ready:           "bg-surface-sink text-ink-soft border border-line",
  delivered:       "bg-surface-sink text-muted border border-line",
  designing:       "bg-surface-sink text-ink-soft border border-line",
  cancelled:       "bg-danger/8 text-danger border border-danger/25",
};

interface OrderCardProps {
  order: StaffOrder;
}

export function OrderCard({ order }: OrderCardProps) {
  const badge = STATUS_BADGE[order.status] ?? "bg-surface-sink text-ink-soft border border-line";

  return (
    <Link
      href={`/staff/orders/${order.id}`}
      className="card-lift block h-full rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)] transition-all hover:border-orange-ink/30 hover:shadow-[var(--shadow-float)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-bold text-ink">
            {order.studentName}
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {order.universityName || "—"}
            {order.department ? ` · ${order.department}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted">{order.productName}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge}`}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>
      <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
        {formatDateShort(order.createdAt)}
      </p>
    </Link>
  );
}
