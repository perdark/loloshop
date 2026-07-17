# Post-deploy fix list — 2026-07-17 review

Code review (3-agent + verify) of the multi-session uncommitted batch.
**No blockers shipped.** Pricing verified consistent with the owner-locked settlement rules.
**ALL 12 review items + the money-gate reveal bug are now FIXED** (2026-07-17, 3 parallel
agents + central review; backend `node --check` 0, frontend `tsc` 0). Two product decisions
were locked with the owner: funnel = **operational**, sash-delete = **move price to a survivor**.

## Fixed

0. ✅ **Money-gate reveal never worked on the admin dashboard** — `frontend/lib/money-gate.ts`
   `verifyMoneyGate`/`getMoneyGateStatus` read `data.ok`/`data.configured` but the axios instance
   does NOT unwrap the `{ data: {...} }` envelope → always false, so `lolo2026` never revealed profit.
   *Fixed:* read `data.data.ok` / `data.data.configured` (like every other wrapper). Backend verified
   correct (`lolo2026` → ok server-side). TV unaffected (separate server-side path).

1. ✅ **Funnel excluded pending/rejected bundles** — `adminController.analytics`
   *Decision: OPERATIONAL.* `by_status` + daily order-count now use `status <> 'cancelled'`; daily
   revenue stays settlement-only via `SUM(price) FILTER (WHERE billableOrderSql)`. Money totals
   (totals/topWholesalers/accounting) untouched.

2. ✅ **Approval restore not atomic** — `persistFullSetOrder` + `orderEditController.saveFullSetOrder`
   + `adminCustomOrderController.createForExistingStudent`
   *Fixed:* the final `wholesaler_approval` is now applied INSIDE persist's transaction via a new
   optional `approval` param (state/approved_at/approved_by/reject_reason). The post-commit
   `restoreApproval` window is gone for the edit + existing-student paths. Rep/student call sites pass
   no `approval` → still write `pending` (byte-identical). Verified all 4 call sites.

3. ✅ Student-search spinner stuck — `CustomOrderForm.tsx` clears `setSearching(false)` on the `<2`-char early return.

4. ✅ **Queue state-restore loses the page number** — `staff/queue/page.tsx`
   *Fixed:* added a derived `rehydrated` flag; the page-clamp effect now gates on `loadedOnce && rehydrated`
   so a restored `page > 1` isn't clamped against a pre-rehydration (stale-filter) list.

5. ✅ **restoreGroupPhone group mismatch** — fixed transitively by #6 (persist + readback now resolve the same group).

6. ✅ **prevGroup could bind a طقم to a legacy retail-cart group** — `fullSetOrder.js`
   *Fixed:* `prevGroup` query scoped `AND o.design_id IS NULL`, matching `readFullSetOrder`.

7. ✅ **Sash piece-delete left a counted bundle with 0 money** — both `deleteOrder` fns (admin + production)
   *Decision: MOVE PRICE TO SURVIVOR.* On delete, if the row has price/cost and a live sibling survives in
   the same checkout_group, its price+cost are added onto one survivor (robe→cap→other); profit recomputes
   (generated col). Audit logs `price_reanchored_to`.

8. ✅ **Quick ✎ edit had no eligibility guard** — `orderEditController.patchOrderDetails`
   *Fixed:* student/group info writes (name/IG/phones/notes) now 403 for ineligible (retail) students BEFORE
   the tx; spec-line text edits remain open for any order.

9. ✅ Quick ✎ edit accepted priced lines with text — WHERE now `AND COALESCE(price_snapshot,0)=0`.

10. ✅ **Concurrent piece-deletes could orphan an empty group** — both `deleteOrder` fns
    *Fixed:* `SELECT id FROM orders WHERE checkout_group_id=$1 FOR UPDATE` locks the bundle before the sibling
    count/re-anchor. (Residual: two admins deleting *different* pieces of the *same* bundle simultaneously can
    deadlock → Postgres aborts one, admin retries. No corruption; far better than the silent orphan before.)

11. ✅ Money-explanation NaN — `CalculationDetails.tsx` adds `Number.isFinite` guards (`safePrice`).

12. ✅ **Deleted-wholesaler approved orders vanished from accounting** — `adminController.accounting`
    *Fixed defensively (0 live rows):* new `orphaned_billable` bucket for `wholesaler_id IS NULL AND
    wholesaler_approval='approved'`, so `by_wholesaler + independent_retail + orphaned_billable == totals`.

## Post-deploy actions (do after this push)

- Drain legacy converting rows: `UPDATE orders SET status='embroidery' WHERE status='converting';`
- Re-run the duplicate-bundle scan + settlement rule-violation scan (queries in audit_log details,
  actions `repair_duplicate_sash` / `repair_pricing_config`).
- Confirm VPS `.env` has: `DESIGN_TEAM_PORTAL_KEY`, `WORKSHOP_PORTAL_KEY`, `STAFF_PORTAL_KEY`,
  `MONEY_GATE_SECRET`, `OPENROUTER_API_KEY`, `DEMO_LOGIN_PHONES` → `pm2 restart`.
- Change the money-gate passphrase (`lolo2026`) via /admin → 🎓 → «تعيين الرمز» (now that reveal works).
- Browser walkthrough of the money-critical paths (approval preserved after an admin edit; sash piece-delete
  keeps bundle revenue; 🎓 reveal works) — static + review verified, no live e2e re-run this session.

## Reviewed & intentional (do NOT "fix")

- `commission = SUM(profit)` — profit column IS the rep's cut per the owner-locked settlement rules.
- `normalizeSettlementAddons` forcing admin=selling on non-shawl addons — matches «admin gets everything
  except the package margin and the شال margin».
- Rep-linked students 403'd from the retail cart (`ERR_REP_ORDER_FLOW`) — closes the NULL-approval hole.
- New settled-money queue/list gates — verified 0 live orders hidden.
