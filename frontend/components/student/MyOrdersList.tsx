"use client";

import { ORDER_STATUS_LABELS, PRODUCT_TYPE_LABELS } from "@/lib/constants";
import type { StudentOrder } from "@/lib/orders";
import type { OrderStatus, ProductType } from "@/lib/types";

/** Status → pill tone. Maps the production pipeline into 4 student-facing states. */
function statusTone(status: OrderStatus): string {
  if (status === "delivered") return "bg-orange-ink/10 text-orange-ink";
  if (status === "ready") return "bg-orange/15 text-orange-ink";
  if (status === "cancelled") return "bg-danger/10 text-danger";
  if (status === "pending_approval") return "bg-surface-sink text-ink-soft";
  return "bg-surface-sink text-ink-soft"; // in progress
}

function statusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export function MyOrdersList({ orders }: { orders: StudentOrder[] }) {
  return (
    <ul className="space-y-3">
      {orders.map((o) => {
        const approved = o.status !== "pending_approval" && o.status !== "cancelled";
        const rejected = o.designApprovalStatus === "rejected";
        const productLabel =
          PRODUCT_TYPE_LABELS[o.productType as ProductType] ?? o.productName;
        return (
          <li
            key={o.id}
            className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{o.productName}</p>
                <p className="mt-0.5 text-xs text-muted">{productLabel}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(o.status)}`}
              >
                {statusLabel(o.status)}
              </span>
            </div>

            {/* Approval state */}
            {o.status !== "cancelled" && (
              <p className="mt-2 flex items-center gap-1.5 text-xs">
                {approved ? (
                  <>
                    <span aria-hidden className="text-orange-ink">✓</span>
                    <span className="font-medium text-ink-soft">تمت الموافقة على طلبك</span>
                  </>
                ) : (
                  <span className="font-medium text-ink-soft">بانتظار موافقة الإدارة</span>
                )}
              </p>
            )}

            {/* Delivered details */}
            {o.status === "delivered" && (
              <p className="mt-1 text-xs text-ink-soft">
                {o.deliveryMethod === "pickup" ? "تم الاستلام من المحل" : "تم التوصيل"}
              </p>
            )}

            {/* Returned for edit — the real "بيه خلل/ملاحظة" signal */}
            {rejected && (
              <div className="mt-2 rounded-xl border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
                <span className="font-bold">أُعيد طلبك للتعديل</span>
                {o.rejectionReason ? <span className="block mt-0.5">{o.rejectionReason}</span> : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
