# Wholesaler Two-Stage Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. Read the spec first: `docs/superpowers/specs/2026-06-24-wholesaler-order-approval-design.md`.

**Goal:** Add a rep order-approval gate (per-bundle) so wholesaler orders only reach staff/dashboard after the rep (or an admin override) approves them; rep can reject (sends back); approved orders lock from student edits.

**Architecture:** An **orthogonal `orders.wholesaler_approval` column** (enum `pending|approved|rejected`, NULL=retail), modeled on the existing `tailor_status` parallel track. The production state machine is NOT touched. A shared `lib/orderApproval.js` does the flip+notify; rep + admin controllers wrap it. Visibility gates added to `getQueue`, `wholesalerOrders`, `listOrders`. Creation sets `pending` in the single choke point `persistFullSetOrder`.

**Tech Stack:** Express 5 + pg (Neon); Next 16 + React 19 + Tailwind v4 (RTL).

## Global Constraints

- **NEVER modify the production state machine** (`orderController` TRANSITIONS/STAGE_AUTHZ; `productionController` stage maps). Approval is orthogonal.
- Key for approve/reject = **`checkout_group_id`** (the bundle). Flip all rows sharing it.
- Retail orders untouched → `wholesaler_approval` stays NULL → always visible. Gate predicate everywhere: `(o.wholesaler_approval IS NULL OR o.wholesaler_approval = 'approved')`.
- Error shape `{ error:<Arabic>, code:'ERR_*' }`. Throwables set `err.status/expose/code`.
- Migration applied via `node migrate.js ../db/migrations/044_wholesaler_order_approval.sql` from `backend/` (NOT `npm run migrate:file`).
- Verification (no test framework): `node --check` per backend file + live backend HTTP e2e + `npx tsc --noEmit` 0 + `npx eslint` 0 + live browser. Agents do static gates; the orchestrator does live HTTP e2e + browser.
- RTL Arabic; mobile-first for `/wholesaler` + `/my-order` (phone-only roles); admin laptop-first.
- Do NOT git commit inside agents (orchestrator commits).

## File ownership (parallel-safe — each file edited by exactly ONE task/agent)

| Group | Files | Tasks |
|---|---|---|
| **FOUNDATION (BE)** | `db/migrations/044_*.sql`, `db/schema.sql`, `backend/lib/fullSetOrder.js`, `backend/lib/orderApproval.js` (new) | T1,T2,T3 |
| **BE-wholesaler** | `backend/controllers/wholesalerController.js`, `backend/routes/wholesaler.js` | T4 |
| **BE-admin** | `backend/controllers/adminController.js`, `backend/routes/admin.js` | T5,T7 |
| **BE-gates** | `backend/controllers/productionController.js`, `backend/controllers/staffController.js`, `backend/controllers/orderController.js` | T6 |
| **FE-rep** | `frontend/lib/wholesaler.ts`, `frontend/app/wholesaler/orders/page.tsx` (new), `frontend/app/wholesaler/layout.tsx` | T8 |
| **FE-student** | `frontend/app/(student)/my-order/page.tsx` | T9 |
| **FE-admin** | `frontend/lib/admin.ts`, `frontend/app/admin/orders/page.tsx`, `frontend/app/admin/page.tsx` | T10 |

`lib/types.ts` is NOT edited — approval types live in `wholesaler.ts` / `admin.ts`; the student page reads fields inline. orderController is owned by BE-gates ONLY (it also holds the rep-full-set lock check, T6).

---

## Task 1 (FOUNDATION): Migration 044 + schema mirror

**Files:** Create `db/migrations/044_wholesaler_order_approval.sql`; modify `db/schema.sql`.

- [ ] **Step 1:** write the migration exactly as in spec §5 (enum guard + 4 `ADD COLUMN IF NOT EXISTS` + backfill UPDATE + index).
- [ ] **Step 2:** mirror the enum guard + `ALTER TABLE orders ADD COLUMN IF NOT EXISTS …` (×4) + index into `db/schema.sql` near the `orders` table / after the `tailor_track_status` additions (idempotent). (schema.sql is the live source — use ALTER form for the new cols, matching how 036 tailor cols were mirrored.)
- [ ] **Step 3:** apply — from `backend/`: `node migrate.js ../db/migrations/044_wholesaler_order_approval.sql` → expect `Done ✓`.
- [ ] **Step 4:** verify — from `backend/`:
```bash
node -e "require('dotenv').config(); const {query}=require('./lib/db'); query(\"select column_name from information_schema.columns where table_name='orders' and column_name like 'wholesaler_%'\").then(r=>{console.log(r.rows.map(x=>x.column_name).join(','));process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"
```
Expect: `wholesaler_approval,wholesaler_approved_at,wholesaler_approved_by,wholesaler_reject_reason`. Also confirm backfill: `select wholesaler_approval, count(*) from orders group by 1` shows existing wholesaler orders as `approved`, retail as NULL.

---

## Task 2 (FOUNDATION): set `pending` at creation — `lib/fullSetOrder.js`

**Files:** modify `backend/lib/fullSetOrder.js`.

- [ ] **Step 1:** Read `persistFullSetOrder`. Find the `INSERT INTO orders (...)` (and any UPDATE on the idempotent re-save path) that creates the 3 bundle rows using `itemFlags`.
- [ ] **Step 2:** Add `wholesaler_approval` to the INSERT column list with value `'pending'` for all 3 rows. On the idempotent **UPDATE** path (re-save of an existing order), also `SET wholesaler_approval='pending', wholesaler_reject_reason=NULL` (any edit re-enters approval). Do NOT touch `status`.
- [ ] **Step 3:** `node --check backend/lib/fullSetOrder.js` → exit 0.
- [ ] **Step 4 (orchestrator e2e later):** create a wholesaler full-set order → all 3 rows `wholesaler_approval='pending'`.

---

## Task 3 (FOUNDATION): shared approval helper — `lib/orderApproval.js` (new)

**Files:** create `backend/lib/orderApproval.js`.

**Interfaces (Produces):**
- `setBundleApproval({ checkoutGroupId, decision, actorUserId, reason, repWholesalerId }) → { ok, count, studentUserId, wholesalerUserId, studentName }` — `decision` ∈ `'approved'|'rejected'`. If `repWholesalerId` is given, the UPDATE is scoped so the bundle must belong to that rep (else `count=0`). Sets the columns, writes audit_log, returns ids for notifications. Does NOT send notifications itself (caller decides who to notify) — but DOES return the ids needed.
- `notifyApproval({ decision, studentUserId, reason })` — inserts the student notification + publishes eventBus.

```js
// backend/lib/orderApproval.js
const { query } = require('./db');
const { publish } = require('./eventBus');

// Flip every order in a checkout_group to approved/rejected. Returns ids for notifications.
// repWholesalerId (optional): when set, only flips if the bundle's student belongs to that rep.
async function setBundleApproval({ checkoutGroupId, decision, actorUserId, reason = null, repWholesalerId = null }) {
  if (!['approved', 'rejected'].includes(decision)) {
    const e = new Error('قرار غير صالح'); e.status = 400; e.expose = true; e.code = 'ERR_VALIDATION'; throw e;
  }
  const params = [checkoutGroupId, decision, actorUserId, decision === 'rejected' ? reason : null];
  let ownClause = '';
  if (repWholesalerId) { params.push(repWholesalerId); ownClause = `AND o.student_id IN (SELECT id FROM students WHERE wholesaler_id = $5)`; }
  const upd = await query(
    `UPDATE orders o
        SET wholesaler_approval = $2,
            wholesaler_approved_at = CASE WHEN $2='approved' THEN NOW() ELSE wholesaler_approved_at END,
            wholesaler_approved_by = $3,
            wholesaler_reject_reason = $4,
            updated_at = NOW()
      WHERE o.checkout_group_id = $1
        AND o.wholesaler_approval IS NOT NULL
        ${ownClause}
      RETURNING o.id, o.student_id`, params);
  if (!upd.rows.length) {
    const e = new Error('الطلب غير موجود'); e.status = 404; e.expose = true; e.code = 'ERR_NOT_FOUND'; throw e;
  }
  const studentId = upd.rows[0].student_id;
  const info = await query(
    `SELECT s.user_id AS student_user_id, u.name AS student_name, w.user_id AS wholesaler_user_id
       FROM students s JOIN users u ON u.id = s.user_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
      WHERE s.id = $1`, [studentId]);
  const row = info.rows[0] || {};
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id)
     VALUES ($1, $2, 'order', $3)`,
    [actorUserId, decision === 'approved' ? 'approve_order' : 'reject_order', upd.rows[0].id]);
  publish({ type: decision === 'approved' ? 'order_approved' : 'order_rejected', checkoutGroupId });
  return { ok: true, count: upd.rows.length, studentUserId: row.student_user_id, wholesalerUserId: row.wholesaler_user_id, studentName: row.student_name };
}

async function notifyUser(userId, type, title, body, link = '/') {
  if (!userId) return;
  await query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link) VALUES ($1,$2,$3,$4,$5)`,
    [userId, type, title, body, link]);
}

module.exports = { setBundleApproval, notifyUser };
```

- [ ] **Step 1:** write the file above. **Verify** the `audit_log` column names (`actor_id, action, entity, entity_id`) + `notifications` columns against `db/schema.sql` before finalizing — adjust if they differ.
- [ ] **Step 2:** `node --check backend/lib/orderApproval.js` → exit 0.

---

## Task 4 (BE-wholesaler): rep order endpoints

**Files:** modify `backend/controllers/wholesalerController.js`, `backend/routes/wholesaler.js`.

**Interfaces (Consumes):** `setBundleApproval`, `notifyUser` from `../lib/orderApproval`; existing `getWholesalerId(req.user.id)`.

- [ ] **Step 1:** in `wholesalerController.js`, add (require `../lib/orderApproval` at top):

```js
// GET /api/wholesaler/orders?approval=pending|approved|rejected|all
async function listOrdersForApproval(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const f = String(req.query.approval || 'pending');
  const params = [wId];
  let clause = "AND o.wholesaler_approval IS NOT NULL";
  if (['pending','approved','rejected'].includes(f)) { params.push(f); clause += ` AND o.wholesaler_approval = $2`; }
  const { rows } = await query(
    `SELECT o.checkout_group_id, MIN(o.created_at) AS submitted_at,
            MAX(o.wholesaler_approval::text) AS approval, MAX(o.wholesaler_reject_reason) AS reject_reason,
            s.id AS student_id, u.name AS student_name,
            SUM(o.price) AS total_price,
            STRING_AGG(p.name_ar, '، ' ORDER BY p.type) AS product_summary
       FROM orders o
       JOIN students s ON s.id = o.student_id
       JOIN users u ON u.id = s.user_id
       JOIN products p ON p.id = o.product_id
      WHERE s.wholesaler_id = $1 AND o.checkout_group_id IS NOT NULL ${clause}
      GROUP BY o.checkout_group_id, s.id, u.name
      ORDER BY submitted_at DESC`, params);
  res.json({ data: rows.map(r => ({ ...r, total_price: Number(r.total_price || 0) })) });
}

// POST /api/wholesaler/orders/:checkoutGroupId/approve
async function approveOrder(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const r = await setBundleApproval({ checkoutGroupId: req.params.checkoutGroupId, decision: 'approved', actorUserId: req.user.id, repWholesalerId: wId });
  await notifyUser(r.studentUserId, 'order_approved', 'تمت الموافقة على طلبك', 'طلبك الآن قيد الإنتاج', '/my-order');
  res.json({ data: { ok: true } });
}

// POST /api/wholesaler/orders/:checkoutGroupId/reject  { reason }
async function rejectOrder(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'سبب الإرجاع مطلوب', code: 'ERR_VALIDATION' });
  const r = await setBundleApproval({ checkoutGroupId: req.params.checkoutGroupId, decision: 'rejected', actorUserId: req.user.id, reason, repWholesalerId: wId });
  await notifyUser(r.studentUserId, 'order_rejected', 'أعاد الممثل طلبك', `السبب: ${reason} — يرجى التعديل وإعادة الإرسال`, '/my-order');
  res.json({ data: { ok: true } });
}

// POST /api/wholesaler/orders/bulk  { checkoutGroupIds:[], action:'approve'|'reject', reason? }
async function bulkOrders(req, res) {
  const wId = await getWholesalerId(req.user.id);
  if (!wId) return res.status(404).json({ error: 'حساب الممثل غير موجود', code: 'ERR_NOT_FOUND' });
  const ids = Array.isArray(req.body && req.body.checkoutGroupIds) ? req.body.checkoutGroupIds : [];
  const action = req.body && req.body.action;
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!ids.length || !['approve','reject'].includes(action)) return res.status(400).json({ error: 'طلب غير صالح', code: 'ERR_VALIDATION' });
  if (action === 'reject' && !reason) return res.status(400).json({ error: 'سبب الإرجاع مطلوب', code: 'ERR_VALIDATION' });
  let done = 0; const skipped = [];
  for (const cg of ids) {
    try {
      const r = await setBundleApproval({ checkoutGroupId: cg, decision: action === 'approve' ? 'approved' : 'rejected', actorUserId: req.user.id, reason, repWholesalerId: wId });
      await notifyUser(r.studentUserId, action === 'approve' ? 'order_approved' : 'order_rejected',
        action === 'approve' ? 'تمت الموافقة على طلبك' : 'أعاد الممثل طلبك',
        action === 'approve' ? 'طلبك الآن قيد الإنتاج' : `السبب: ${reason}`, '/my-order');
      done++;
    } catch { skipped.push(cg); }
  }
  res.json({ data: { done, skipped } });
}
```
Add all four to `module.exports`.

- [ ] **Step 2:** in `routes/wholesaler.js` add (after auth middleware that's already applied to the router):
```js
router.get('/orders', c.listOrdersForApproval);
router.post('/orders/bulk', c.bulkOrders);
router.post('/orders/:checkoutGroupId/approve', c.approveOrder);
router.post('/orders/:checkoutGroupId/reject', c.rejectOrder);
```
(Use the controller's existing import alias. Ensure `/orders/bulk` is declared BEFORE `/orders/:checkoutGroupId/...` so "bulk" isn't captured as a param.)
- [ ] **Step 3:** `node --check` both files → exit 0.

---

## Task 5 (BE-admin): admin override endpoints

**Files:** modify `backend/controllers/adminController.js`, `backend/routes/admin.js`.

- [ ] **Step 1:** in `adminController.js` (require `../lib/orderApproval`):
```js
// POST /api/admin/orders/:checkoutGroupId/approve  (override — no ownership)
async function approveOrderAdmin(req, res) {
  const r = await setBundleApproval({ checkoutGroupId: req.params.checkoutGroupId, decision: 'approved', actorUserId: req.user.id });
  await notifyUser(r.studentUserId, 'order_approved', 'تمت الموافقة على طلبك', 'طلبك الآن قيد الإنتاج', '/my-order');
  await notifyUser(r.wholesalerUserId, 'order_approved', 'تمت الموافقة على طلب', `وافق المدير على طلب ${r.studentName || ''}`.trim(), '/wholesaler/orders');
  res.json({ data: { ok: true } });
}
// POST /api/admin/orders/:checkoutGroupId/reject  { reason }
async function rejectOrderAdmin(req, res) {
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'سبب الإرجاع مطلوب', code: 'ERR_VALIDATION' });
  const r = await setBundleApproval({ checkoutGroupId: req.params.checkoutGroupId, decision: 'rejected', actorUserId: req.user.id, reason });
  await notifyUser(r.studentUserId, 'order_rejected', 'أعاد المدير طلبك', `السبب: ${reason} — يرجى التعديل`, '/my-order');
  await notifyUser(r.wholesalerUserId, 'order_rejected', 'أعاد المدير طلبًا', `طلب ${r.studentName || ''} — السبب: ${reason}`.trim(), '/wholesaler/orders');
  res.json({ data: { ok: true } });
}
```
Add both + the require to exports.
- [ ] **Step 2:** in `routes/admin.js` (router already `requireRole('admin')`):
```js
router.post('/orders/:checkoutGroupId/approve', c.approveOrderAdmin);
router.post('/orders/:checkoutGroupId/reject', c.rejectOrderAdmin);
```
(Place where they won't shadow the existing `PATCH /orders/:id/cost` — different verb/suffix, safe.)
- [ ] **Step 3:** `node --check` both files → exit 0.

---

## Task 6 (BE-gates): visibility gates + student lock

**Files:** modify `backend/controllers/productionController.js`, `backend/controllers/staffController.js`, `backend/controllers/orderController.js`.

- [ ] **Step 1 — getQueue:** in `productionController.getQueue`, add to the SQL WHERE: `AND (o.wholesaler_approval IS NULL OR o.wholesaler_approval = 'approved')`. (Confirm the orders alias is `o`.)
- [ ] **Step 2 — wholesalerOrders:** in `staffController.wholesalerOrders`, add the same predicate to its WHERE (alias `o`).
- [ ] **Step 3 — listOrders:** in `orderController.listOrders`: (a) add `o.wholesaler_approval` to BOTH the flat and bundle SELECT column lists; (b) accept `req.query.approval` — when `∈ {pending,approved,rejected}` add `AND o.wholesaler_approval = $n`; default = no filter (admin sees all). Do NOT auto-hide pending for admin (admin oversight). Expose the field in the JSON each row/bundle returns.
- [ ] **Step 4 — student lock:** find the student self-fill handler (the `rep-full-set` POST in `orderController`). BEFORE calling `persistFullSetOrder`, look up the student's current bundle approval; if any existing order for this student is `wholesaler_approval='approved'`, return `403 {error:'الطلب تمت الموافقة عليه ولا يمكن تعديله', code:'ERR_LOCKED'}`. (Rep self-fill path in wholesalerController is NOT locked.)
```js
// inside the student rep-full-set handler, after resolving the student id:
const lock = await query(
  `SELECT 1 FROM orders WHERE student_id = $1 AND wholesaler_approval = 'approved' LIMIT 1`, [studentId]);
if (lock.rows.length) return res.status(403).json({ error: 'الطلب تمت الموافقة عليه ولا يمكن تعديله', code: 'ERR_LOCKED' });
```
- [ ] **Step 5:** `node --check` all three files → exit 0.

---

## Task 7 (BE-admin): dashboard pending count

**Files:** modify `backend/controllers/adminController.js` (+ `routes/admin.js` if a new endpoint).

- [ ] **Step 1:** add a count to the existing analytics/accounting response, OR a tiny `GET /api/admin/orders-pending-count` returning `{ data:{ pending_bundles } }`:
```js
async function pendingApprovalCount(req, res) {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT checkout_group_id)::int AS n FROM orders WHERE wholesaler_approval = 'pending'`);
  res.json({ data: { pending_bundles: rows[0].n } });
}
```
Wire `router.get('/orders-pending-count', c.pendingApprovalCount)` in `routes/admin.js`. `node --check`.

---

## Task 8 (FE-rep): rep approval UI

**Files:** modify `frontend/lib/wholesaler.ts`; create `frontend/app/wholesaler/orders/page.tsx`; modify `frontend/app/wholesaler/layout.tsx` (add «الطلبات» nav).

- [ ] **Step 1:** in `lib/wholesaler.ts` add types + wrappers:
```ts
export interface RepOrderRow { checkout_group_id: string; student_id: string; student_name: string; product_summary: string; total_price: number; submitted_at: string; approval: 'pending'|'approved'|'rejected'; reject_reason: string | null; }
export async function getRepOrders(approval: 'pending'|'approved'|'rejected'|'all' = 'pending') { const { data } = await api.get<{data:RepOrderRow[]}>(`/wholesaler/orders?approval=${approval}`); return data.data; }
export async function approveRepOrder(cg: string) { await api.post(`/wholesaler/orders/${cg}/approve`); }
export async function rejectRepOrder(cg: string, reason: string) { await api.post(`/wholesaler/orders/${cg}/reject`, { reason }); }
export async function bulkRepOrders(checkoutGroupIds: string[], action: 'approve'|'reject', reason?: string) { const { data } = await api.post<{data:{done:number;skipped:string[]}}>(`/wholesaler/orders/bulk`, { checkoutGroupIds, action, reason }); return data.data; }
```
- [ ] **Step 2:** create `app/wholesaler/orders/page.tsx` — `"use client"`, mobile-first RTL: tabs pending/approved/rejected; per-student cards (name · product_summary · price · submitted time · reject_reason); **Approve** + **Reject (reason modal)** buttons; checkboxes + sticky **bulk approve** bar; toast + `getApiErrorMessage`. Read existing `app/wholesaler/students/page.tsx` for the exact card/toast/modal conventions.
- [ ] **Step 3:** add «الطلبات» to the wholesaler nav in `app/wholesaler/layout.tsx` (href `/wholesaler/orders`) — match the existing nav item shape (الرئيسية + الطلاب).
- [ ] **Step 4:** `npx tsc --noEmit` 0 + `npx eslint` on the 3 files.

---

## Task 9 (FE-student): `/my-order` state banner + lock

**Files:** modify `frontend/app/(student)/my-order/page.tsx`.

- [ ] **Step 1:** read the order context the page already fetches; surface `wholesaler_approval` (the backend now returns it on the order/context — read it from the existing response; if absent, fetch from the order). Render a banner: `pending` → «بانتظار موافقة الممثل»; `approved` → «تمت الموافقة — طلبك قيد الإنتاج» AND render the form **read-only / disable save**; `rejected` → «أعاد الممثل طلبك: <reason>» with the form editable.
- [ ] **Step 2:** handle the save `403 ERR_LOCKED` gracefully (toast «الطلب تمت الموافقة عليه ولا يمكن تعديله»). After a successful save show «تم الإرسال — بانتظار موافقة الممثل».
- [ ] **Step 3:** `npx tsc --noEmit` 0 + `npx eslint`.

---

## Task 10 (FE-admin): orders filter/badge/override + dashboard count

**Files:** modify `frontend/lib/admin.ts`, `frontend/app/admin/orders/page.tsx`, `frontend/app/admin/page.tsx`.

- [ ] **Step 1:** in `lib/admin.ts` add: an `approval` filter param to the existing admin-orders fetch (pass `?approval=`), `approveOrderAdmin(cg)`/`rejectOrderAdmin(cg,reason)` (POST `/admin/orders/:cg/approve|reject`), and `getPendingApprovalCount()` (GET `/admin/orders-pending-count`). Add `wholesalerApproval` to the admin order/bundle type mapping.
- [ ] **Step 2:** in `app/admin/orders/page.tsx`: a «بانتظار موافقة الممثل» filter chip + per-row/bundle approval **badge** + **Approve/Reject override** buttons (reason modal) on pending bundles. Match existing filter/badge conventions on that page.
- [ ] **Step 3:** in `app/admin/page.tsx`: a pending-approval **count card** using `getPendingApprovalCount()`.
- [ ] **Step 4:** `npx tsc --noEmit` 0 + `npx eslint` on the 3 files.

---

## Task 11 (orchestrator): live verify + acceptance

- [ ] Backend HTTP e2e (dev server + minted JWTs): (1) create wholesaler order → 3 rows `pending`, absent from `getQueue`/`wholesalerOrders`; (2) rep `GET /wholesaler/orders?approval=pending` lists it; approve → rows `approved`, now in `getQueue`, student notified; (3) reject → student notified, student re-save → `pending`; (4) student save of an approved order → 403 `ERR_LOCKED`; (5) admin override approve works without ownership; (6) retail order stays NULL + visible; (7) bulk approve. (Acceptance §13.)
- [ ] Live browser: rep `/wholesaler/orders` approve/reject; student `/my-order` banners + lock; admin orders filter/badge/override + dashboard count. RTL + mobile (390px) clean, console clean.
- [ ] Gates: `node --check` all edited backend files; `npx tsc --noEmit` 0; `npx eslint` 0.
- [ ] Update `HANDOFF.md`. Commit.

## Self-Review (against spec)

- §5 migration + backfill → T1. §6 creation pending → T2. §4 orthogonal helper → T3. §7 rep API → T4; admin override → T5. §8 gates (getQueue/wholesalerOrders/listOrders) → T6 + dashboard count T7. §9 FE rep/student/admin → T8/T9/T10. §10 lock+resubmit → T2(update→pending) + T6 Step4 (student 403). §11 notifications → T3/T4/T5. §12 errors → in each handler. §13 acceptance → T11.
- Type/name consistency: `setBundleApproval`/`notifyUser` defined T3, consumed T4/T5; `checkout_group_id` key throughout; gate predicate `(wholesaler_approval IS NULL OR ='approved')` identical in T6 ×3. No placeholders.
- Parallel safety: file-ownership table — no file edited by two tasks (orderController only by T6).
