// ───────────────────────────────────────────────────────────────────────────
// payoutMath.js — the arithmetic behind «المبلغ المقترح» on /admin/payouts.
//
// WHY THIS FILE EXISTS (money audit, 2026-08-14)
//
// The payout card used to compute one number and print it under a label that
// described a different one:
//
//   suggested_amount = base_salary + bonuses − deductions        ← staff
//   suggested_amount = production  + bonuses − deductions        ← workshop
//
// That is a LIFETIME ACCRUAL — everything the person has ever earned. It was
// printed as «المبلغ المقترح», which an admin reads as "transfer this now", and
// `manual_payouts` was joined only to display the last transfer, never to reduce
// the figure. So the number is correct exactly once, on the very first payout,
// and overpays by the full accrual on every press after it. `manual_payouts` had
// 0 rows on prod when this was found, which is the only reason it never fired.
//
// THE THREE FIGURES — never interchangeable, which is the whole bug:
//   استُحق   accrued   = everything earned, ever          → the ledger
//   حُوِّل    paid      = everything already transferred    → the ledger
//   المتبقي  net due   = accrued − paid                    → what is actually owed
//
// and one derived number that is NOT any of them:
//   المقترح  suggested = max(0, net due)                   → what the button offers
//
// The clamp is not cosmetic. `recordManualPayout` rejects `amount <= 0`, so a
// negative suggestion is a button the API refuses — offered to an admin as if it
// were an action. Deductions CAN exceed a salary (dev repro: مضر محمد, base
// 250,000 against 1,025,000 of deductions = −775,000). When they do, the shop owes
// nothing and the honest suggestion is zero; the negative `net_due` is still
// returned so the UI can show WHY rather than silently printing 0.
// ───────────────────────────────────────────────────────────────────────────

/** pg hands BIGINT back as a string. `'500000' + '50000'` is '50000050000', which
 *  reads as a plausible salary of fifty billion dinars — so every input is coerced
 *  before any arithmetic touches it. */
const n = (value) => Number(value || 0);

/**
 * Everything this person has earned, ever. Accepts the staff shape (`base`) or the
 * workshop shape (`production`) — they differ only in where the earning came from.
 * MAY BE NEGATIVE when deductions exceed earnings; that is a real state, not an error.
 */
function accruedAmount({ base, production, bonuses, deductions } = {}) {
  return n(base) + n(production) + n(bonuses) - n(deductions);
}

/** What is still owed after every recorded transfer. May be negative (over-paid). */
function netDue(accrued, paid) {
  return n(accrued) - n(paid);
}

/**
 * What the transfer button offers. Never negative, always an amount
 * `recordManualPayout` will accept — the two agree by construction.
 */
function suggestedTransfer(due) {
  const value = n(due);
  return value > 0 ? Math.round(value) : 0;
}

/**
 * One human, one row.
 *
 * A person can hold `role = 'staff'` AND sit on `workshop_workers` — ابو عبدو does
 * (see the note at payoutController.js:96-100). The two lists were concatenated, so
 * he was offered twice with two different amounts and nothing said which was real.
 *
 * The ACTIVE workshop roster wins, because that is the basis his pay is actually
 * computed on (production, not a base salary). It deliberately does NOT drop every
 * staff user who appears anywhere on the roster: `workshopRecipients` filters
 * `w.active = TRUE`, so a retired member would then appear on neither list and become
 * unpayable — strictly worse than the duplicate this fixes.
 *
 * NOTE the two ledgers stay separate: `paid_total` is summed per `recipient_kind`, so a
 * workshop row nets only workshop transfers. That is intentional — a production accrual
 * and a salary accrual are different debts, and subtracting one's payments from the
 * other's total would under-pay. Only reachable for someone who was paid under one kind
 * and then moved to the other; `manual_payouts` had 0 rows when this was written.
 */
function mergeRecipients(staff = [], workshop = []) {
  const claimed = new Set(workshop.map((r) => r.user_id));
  return [...workshop, ...staff.filter((r) => !claimed.has(r.user_id))];
}

module.exports = { accruedAmount, netDue, suggestedTransfer, mergeRecipients };
