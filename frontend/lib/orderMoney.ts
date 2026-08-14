/**
 * The money vocabulary for client-side order totals.
 *
 * WHY THIS FILE EXISTS (money audit, 2026-08-14 — bug 11's second home)
 *
 * Track A fixed the admin dashboard: «الربح» there no longer means `SUM(orders.profit)`,
 * because on a representative's order `price − cost` is **the rep's margin**, not the
 * shop's. The whole vocabulary lives in `backend/lib/counts.js` (`shopIncomeExpr` ·
 * `repMarginExpr` · `settledMoney`) and is mirrored by `AdminMoney` in `./types`.
 *
 * `/admin/orders` was never part of Track A's scope, so it kept summing `o.profit` into a
 * column labelled «الربح» — the identical defect, on the screen the owner opens to read
 * individual orders. This file is the client-side half of that same definition, so the two
 * screens cannot drift again.
 *
 * THE TWO POPULATIONS — never added together:
 *   rep order    الطالب يدفع للممثل، والممثل يسلّم حصة الإدارة للمحل.
 *                shop income = cost (حصة الإدارة)   ·   rep margin = price − cost  ← THEIRS
 *   retail order الطالب يدفع المحل مباشرة.
 *                shop income = price                ·   rep margin = 0
 *
 * Read `backend/lib/counts.js` before renaming anything here.
 */
import type { AdminOrder } from "./types";

export interface OrderMoneySummary {
  /** What students paid ANYONE — the old, misleading «إجمالي الإيرادات». */
  grossCollected: number;
  /** THE number: حصة الإدارة on rep rows + full price on retail rows. */
  shopIncome: number;
  /** The representatives' own margin. Never part of shopIncome. */
  repMargin: number;
  /** Production cost actually entered against these rows. */
  costEntered: number;
  /** How many rows carry a production cost. 0 → any "profit" shown is revenue. */
  rowsCosted: number;
  rows: number;
}

/**
 * Sum a list of order pieces into the settled-money split.
 *
 * `shopIncome + repMargin === grossCollected` is an identity here, exactly as it is in
 * `settledMoney` — every dinar lands in one bucket or the other and none is counted twice.
 */
export function summariseOrderMoney(orders: AdminOrder[]): OrderMoneySummary {
  return orders.reduce<OrderMoneySummary>(
    (acc, order) => {
      const price = order.price ?? 0;
      const cost = order.cost ?? 0;
      const isRep = order.source === "wholesaler";

      acc.grossCollected += price;
      acc.shopIncome += isRep ? cost : price;
      // `profit` is the stored generated column (price − cost). On a rep row that IS the
      // rep's margin; it is not recomputed here so the table and the totals agree.
      acc.repMargin += isRep ? order.profit ?? price - cost : 0;
      if (!isRep) {
        acc.costEntered += cost;
        if (order.cost != null) acc.rowsCosted += 1;
      }
      acc.rows += 1;
      return acc;
    },
    {
      grossCollected: 0,
      shopIncome: 0,
      repMargin: 0,
      costEntered: 0,
      rowsCosted: 0,
      rows: 0,
    }
  );
}

/**
 * Column labels for the piece table. A rep row and a retail row put different meanings in
 * the same three columns, which is precisely how «ربح الممثل» came to be printed as the
 * shop's «الربح». `/admin/orders` renders one source at a time, so the header can simply
 * say which one it is — the same treatment the bundle receipt already uses.
 */
export function moneyLabels(source: "retail" | "wholesaler") {
  return source === "wholesaler"
    ? { price: "دفع الطالب", cost: "حصة الإدارة", profit: "ربح الممثل" }
    : { price: "السعر", cost: "التكلفة", profit: "الربح" };
}
