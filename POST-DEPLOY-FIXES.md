# Post-deploy fix list — 2026-07-17 review

Code review (3-agent + verify) of the multi-session uncommitted batch before this push.
**No blockers shipped.** Pricing verified consistent with the owner-locked settlement rules;
live-DB check confirmed the new settled-money gate currently orphans 0 orders.
These are the follow-ups, ranked. Delete items as they're fixed.

## Fix soon (real bugs, low blast radius today)

1. **Dashboard charts silently exclude pending/rejected bundles** — `backend/controllers/adminController.js:64`
   `by_status` + `daily` are now filtered by `billableOrderSql` (settled money). Previously they counted ALL
   orders. ~19 pending rep bundles vanish from the admin pipeline funnel → WIP understated.
   *Fix:* give the funnel/daily charts an operational filter (`status <> 'cancelled'` only), keep
   `billableOrderSql` for money totals only. **Decide: is the funnel operational or settlement?**

2. **Approval restore not atomic** — `backend/controllers/orderEditController.js:213` (same pattern in
   `adminCustomOrderController.createForExistingStudent`)
   `persistFullSetOrder` commits `wholesaler_approval='pending'` in its own tx; `restoreApproval` runs after,
   un-transacted. A crash/Neon drop in between leaves an approved bundle stuck at `pending` → invisible in
   staff queue + settled money until re-edited. *Fix:* wrap capture→persist→restore in one `tx`, or retry
   restore idempotently.

3. ✅ **FIXED 2026-07-17** — Student-search spinner stuck forever — `frontend/components/staff/CustomOrderForm.tsx:70`
   Type 2+ chars then delete below 2 before the debounce fires → `setSearching(false)` never runs.
   *Fix applied:* the `q.length < 2` early-return branch now also calls `setSearching(false)`.

4. **Queue state-restore loses the page number** — `frontend/app/staff/queue/page.tsx:956`
   Restored `page > 1` is clamped back to 1 when the mount-time `router.replace` re-applies the stage filter
   and the list shrinks. *Fix:* gate the clamp effect on URL rehydration having settled (not just `loadedOnce`).

## Fix when touching the area (edge cases / hardening)

5. **restoreGroupPhone bails on checkout_group mismatch** — `backend/controllers/orderEditController.js:68`
   If persist resolves a different group than captured, the admin-set group phone is wiped ('' for name-only
   students) and never restored. Root cause is the known `prevGroup` edge in `fullSetOrder.js` (no design
   filter) — fixing that fixes this.

6. **restoreApproval writes approval onto a whole legacy cart group** — `backend/lib/fullSetOrder.js:389`
   Same `prevGroup` edge: a طقم bound to a legacy retail-cart checkout_group gets the captured approval
   stamped on the cart order too. Only legacy data can trigger it (new cart 403 blocks rep students).
   *Fix:* scope persist/restore to design-less package pieces, or fix `prevGroup` selection.

7. **Sash piece-delete leaves a counted bundle with 0 money** — `backend/controllers/adminController.js:838`
   Documented/accepted that the طقم price rides the sash row — but note repsOverview/accounting still COUNT
   the bundle as 1 approved bundle with 0 revenue → rep bundle count no longer reconciles with revenue.
   *Option:* re-anchor the bundle price onto a surviving piece on sash delete, or exclude priceless bundles
   from the count.

8. **Quick ✎ edit has no eligibility guard** — `backend/controllers/orderEditController.js:249`
   `patchOrderDetails` can rename a retail self-registered student's real login account (users.name) and
   rewrite their group contacts. Manager-only surface, but add the same `eligibleForFullSet`-style guard
   (or restrict student/group writes to rep-linked/name-only students).

9. ✅ **FIXED 2026-07-17** — Quick ✎ edit accepts priced lines that carry typed text — `backend/controllers/orderEditController.js:271`
   WHERE only checked `customer_text IS NOT NULL`; now also `AND COALESCE(price_snapshot, 0) = 0` to honor the
   text-only contract (COALESCE guards NULL-price rows so no legit text edit is rejected).

10. **Concurrent piece deletes can orphan an empty checkout_groups row** — `backend/controllers/productionController.js:1476`
    Lock the group's rows (`SELECT … FOR UPDATE` on the checkout_group) before counting siblings. Blast radius:
    one orphan row, no money impact.

11. ✅ **FIXED 2026-07-17** — Money-explanation panel can render NaN / false equation — `frontend/components/admin/CalculationDetails.tsx:58`
    Added `Number.isFinite` fallbacks (`safePrice`, guarded `storedCost`/`storedProfit`) before printing the equation.

12. **Latent: deleted-wholesaler approved orders vanish from accounting breakdowns** — `backend/controllers/adminController.js:145`
    If a wholesaler is ever deleted (FK sets students.wholesaler_id NULL), their approved orders stay in
    totals but drop out of by_wholesaler AND independent_retail (which now requires `approval IS NULL`) →
    sections stop summing to totals. 0 live rows today (verified on Neon 2026-07-17).

## Post-deploy actions carried over from earlier sessions (do after this push)

- Drain legacy converting rows: `UPDATE orders SET status='embroidery' WHERE status='converting';`
- Re-run the duplicate-bundle scan + settlement rule-violation scan (queries in audit_log details,
  actions `repair_duplicate_sash` / `repair_pricing_config`).
- Confirm VPS `.env` has: `DESIGN_TEAM_PORTAL_KEY`, `WORKSHOP_PORTAL_KEY`, `STAFF_PORTAL_KEY`,
  `MONEY_GATE_SECRET`, `OPENROUTER_API_KEY`, `DEMO_LOGIN_PHONES` → `pm2 restart`.
- Change the money-gate passphrase (`lolo2026`) via /admin → 🎓 → «تعيين الرمز».

## Reviewed & intentional (do NOT "fix")

- `commission = SUM(profit)` — profit column IS the rep's cut per the owner-locked settlement rules.
- `normalizeSettlementAddons` forcing admin=selling on non-shawl addons — matches «admin gets everything
  except the package margin and the شال margin».
- Rep-linked students 403'd from the retail cart (`ERR_REP_ORDER_FLOW`) — closes the NULL-approval hole.
- New settled-money queue/list gates — verified 0 live orders hidden.
