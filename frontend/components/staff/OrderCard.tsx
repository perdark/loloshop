import Link from "next/link";
import { ORDER_SOURCE_LABELS, ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatDateShort } from "@/lib/format";
import type { ProductionQueueItem, StaffOrder } from "@/lib/staff-types";

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
  embroidery:      "bg-orange-ink/15 text-orange-ink border border-orange-ink/30",
  pressing:        "bg-orange-ink/10 text-orange-ink border border-orange-ink/25",
  preparing:       "bg-surface-sink text-ink-soft border border-line",
  ready:           "bg-surface-sink text-ink-soft border border-line",
  delivered:       "bg-surface-sink text-muted border border-line",
  designing:       "bg-surface-sink text-ink-soft border border-line",
  cancelled:       "bg-danger/8 text-danger border border-danger/25",
};

/** Approval badge — shown on design_complete queue items */
const APPROVAL_BADGE: Record<string, string> = {
  pending:  "bg-orange-ink/10 text-orange-ink border border-orange-ink/20",
  approved: "bg-surface-sink text-ink-soft border border-line",
  rejected: "bg-danger/8 text-danger border border-danger/20",
};
const APPROVAL_LABEL: Record<string, string> = {
  pending:  "بانتظار المراجعة",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
};

/** Accept both the legacy StaffOrder shape and the new ProductionQueueItem */
type OrderCardData =
  | StaffOrder
  | (ProductionQueueItem & { studentId?: never });

interface OrderCardProps {
  order: OrderCardData;
  /** Base href for the detail page. Defaults to /staff/orders */
  basePath?: string;
}

export function OrderCard({ order, basePath = "/staff/orders" }: OrderCardProps) {
  const badge = STATUS_BADGE[order.status] ?? "bg-surface-sink text-ink-soft border border-line";

  // Normalise field names — ProductionQueueItem uses snake_case
  const isLegacy = "studentName" in order;
  const studentName = isLegacy
    ? (order as StaffOrder).studentName
    : (order as ProductionQueueItem).student_name;
  const universityName = isLegacy
    ? (order as StaffOrder).universityName
    : (order as ProductionQueueItem).university_name;
  const department = order.department;
  const productName = isLegacy
    ? (order as StaffOrder).productName
    : (order as ProductionQueueItem).product_name;
  const createdAt = isLegacy
    ? (order as StaffOrder).createdAt
    : (order as ProductionQueueItem).created_at;

  const approvalStatus = "approval_status" in order ? order.approval_status : null;

  // Live presence — WHO currently has this order's detail tab open. The backend
  // only returns working_staff_name while the worker's heartbeat is fresh (its
  // TTL), so a non-null value already means "open right now". Stops 5 designers
  // from grabbing the same order.
  const workingName =
    "working_staff_name" in order ? order.working_staff_name : null;
  const isBeingWorked = !!workingName;

  // Source chip — only on ProductionQueueItem (has `source` field)
  const source = "source" in order ? (order as ProductionQueueItem).source : null;
  const wholesalerName =
    "wholesaler_name" in order ? (order as ProductionQueueItem).wholesaler_name : null;

  return (
    <Link
      href={`${basePath}/${order.id}`}
      className="card-lift block h-full rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)] transition-all hover:border-orange-ink/30 hover:shadow-[var(--shadow-float)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-bold text-ink">
            {studentName}
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {universityName || "—"}
            {department ? ` · ${department}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted">{productName}</p>
          {isBeingWorked && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-orange-ink/30 bg-orange-ink/8 px-2 py-0.5 text-xs font-semibold text-orange-ink">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-ink/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-ink" />
              </span>
              يعمل عليه: {workingName}
            </span>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge}`}
        >
          {ORDER_STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      {/* Approval badge for designer queue */}
      {approvalStatus && (
        <div className="mt-2">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${APPROVAL_BADGE[approvalStatus] ?? APPROVAL_BADGE.pending}`}
          >
            {APPROVAL_LABEL[approvalStatus] ?? approvalStatus}
          </span>
        </div>
      )}

      {/* Source chip */}
      {source && (
        <div className="mt-2">
          {source === "wholesaler" ? (
            <span className="inline-flex rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2 py-0.5 text-xs font-medium text-orange-ink">
              {wholesalerName ? `ممثل: ${wholesalerName}` : ORDER_SOURCE_LABELS.wholesaler}
            </span>
          ) : (
            <span className="inline-flex rounded-full border border-line bg-surface-sink px-2 py-0.5 text-xs font-medium text-ink-soft">
              {ORDER_SOURCE_LABELS.retail}
            </span>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
        {formatDateShort(createdAt)}
      </p>
    </Link>
  );
}
