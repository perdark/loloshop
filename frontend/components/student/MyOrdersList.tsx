"use client";

import { PRODUCT_TYPE_LABELS } from "@/lib/constants";
import type { StudentOrder } from "@/lib/orders";
import type { OrderStatus, ProductType } from "@/lib/types";

// ⚠️ THE STUDENT NEVER SEES A PRODUCTION STAGE, AND «جاهز للاستلام» IS A FACT ABOUT THE WHOLE
// ORDER — NOT ABOUT ONE PIECE (owner 2026-09-14).
//
// What this screen used to do was print `ORDER_STATUS_LABELS[piece.status]` on every row, so a
// student whose قبعة had been packed read «جاهز للاستلام» beside «قيد الكوي» on the وشاح and
// came to the shop for an order that was not finished. Measured on the prod restore the day this
// changed: **180 students** had at least one piece at `ready` with other pieces still in
// production — and for **176** of them the mixed pieces sat inside the SAME `checkout_group_id`,
// which is why grouping by it is the fix and not a heuristic.
//
// Two rules follow, and they are the whole file:
//   1. The set is `checkout_group_id`, falling back to the order's own id for the handful of
//      legacy rows that have none. Two separate checkouts are two orders and read separately —
//      that is correct, not a gap.
//   2. A set says «جاهز للاستلام» only when EVERY live piece in it has reached ready/delivered.
//      Anything else is «قيد التنفيذ» — one phrase, no stage vocabulary. The shop's internal
//      stages (التصميم · التطريز · التجميع · الكوي · التجهيز) are ours, not the student's, and
//      printing them invited «شنو يعني قيد التحويل؟» on WhatsApp all day.
//
// Do NOT reintroduce `ORDER_STATUS_LABELS` here to "be more informative". The information the
// student needs is «أجي لو لا», and that question has exactly three answers.

/** The three student-facing states. Everything in production collapses into `working`. */
type SetState = "working" | "ready" | "delivered" | "cancelled" | "pending";

const SET_LABEL: Record<SetState, string> = {
  pending: "بانتظار الموافقة",
  working: "قيد التنفيذ",
  ready: "جاهز للاستلام",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

const SET_TONE: Record<SetState, string> = {
  pending: "bg-surface-sink text-ink-soft",
  working: "bg-surface-sink text-ink-soft",
  ready: "bg-orange/15 text-orange-ink",
  delivered: "bg-orange-ink/10 text-orange-ink",
  cancelled: "bg-danger/10 text-danger",
};

/** A piece no longer moving through the line — it neither blocks nor makes a set ready. */
function isDone(status: OrderStatus): boolean {
  return status === "ready" || status === "delivered";
}

interface OrderSet {
  key: string;
  pieces: StudentOrder[];
  state: SetState;
}

function groupIntoSets(orders: StudentOrder[]): OrderSet[] {
  const byKey = new Map<string, StudentOrder[]>();
  for (const o of orders) {
    const key = o.checkoutGroupId ?? o.id;
    const list = byKey.get(key);
    if (list) list.push(o);
    else byKey.set(key, [o]);
  }

  return [...byKey.entries()].map(([key, pieces]) => {
    // Cancelled pieces are excluded from the verdict rather than blocking it: a student who
    // cancelled their قبعة must still be told the rest of the order is ready.
    const live = pieces.filter((p) => p.status !== "cancelled");
    let state: SetState;
    if (live.length === 0) state = "cancelled";
    else if (live.every((p) => p.status === "delivered")) state = "delivered";
    else if (live.every((p) => isDone(p.status))) state = "ready";
    else if (live.every((p) => p.status === "pending_approval")) state = "pending";
    else state = "working";
    return { key, pieces, state };
  });
}

export function MyOrdersList({ orders }: { orders: StudentOrder[] }) {
  const sets = groupIntoSets(orders);

  return (
    <ul className="space-y-3">
      {sets.map((set) => {
        // One rejection anywhere in the set is the set's headline — it is the only thing the
        // student can act on, and it outranks «قيد التنفيذ».
        const rejected = set.pieces.find(
          (p) => p.designApprovalStatus === "rejected" && p.status !== "cancelled",
        );
        const delivered = set.pieces.find((p) => p.status === "delivered");

        return (
          <li
            key={set.key}
            className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]"
          >
            {/* Pieces — name only. No per-piece status: the set owns the verdict. */}
            <ul className="space-y-2">
              {set.pieces.map((o) => {
                const productLabel =
                  PRODUCT_TYPE_LABELS[o.productType as ProductType] ?? o.productName;
                const cancelled = o.status === "cancelled";
                return (
                  <li
                    key={o.id}
                    className="flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm font-bold ${cancelled ? "text-muted line-through" : "text-ink"}`}
                      >
                        {o.productName}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{productLabel}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        cancelled ? SET_TONE.cancelled : SET_TONE[set.state]
                      }`}
                    >
                      {cancelled ? SET_LABEL.cancelled : SET_LABEL[set.state]}
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* The one sentence the student came for. Shown only when the WHOLE order is done. */}
            {set.state === "ready" && (
              <p
                role="status"
                className="mt-3 rounded-xl bg-orange/10 px-3 py-2 text-sm font-bold text-orange-ink"
              >
                <span aria-hidden>✓</span> طلبك جاهز للاستلام
              </p>
            )}

            {set.state === "delivered" && (
              <p className="mt-3 text-xs text-ink-soft">
                {delivered?.deliveryMethod === "delivery"
                  ? "تم التوصيل"
                  : "تم الاستلام من المحل"}
              </p>
            )}

            {set.state === "working" && (
              <p className="mt-3 text-xs text-ink-soft">
                طلبك قيد التنفيذ — راح نعلمك أول ما يخلص كامل.
              </p>
            )}

            {set.state === "pending" && (
              <p className="mt-3 text-xs text-ink-soft">بانتظار موافقة الإدارة على طلبك.</p>
            )}

            {/* Returned for edit — the real «بيه خلل/ملاحظة» signal, and the only row-level
                detail that survives the simplification, because the student must act on it. */}
            {rejected && (
              <div className="mt-3 rounded-xl border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
                <span className="font-bold">أُعيد طلبك للتعديل</span>
                {rejected.rejectionReason ? (
                  <span className="mt-0.5 block">{rejected.rejectionReason}</span>
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
