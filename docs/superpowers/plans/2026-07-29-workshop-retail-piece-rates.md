# Workshop Retail Piece Rates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay the Syrian workshop crew a different piece rate for تجزئة (retail-student) work than for ممثلين (wholesaler) work.

**Architecture:** `audience` (`'wholesale'|'retail'`) becomes the third column of the piece-rate key and is stamped onto every production entry. All recording flows through the single existing `insertProduction` choke point, so the worker's self-service form and the admin's record-on-behalf form cannot drift. Rates stay frozen per entry — editing a price never rewrites past wages.

**Tech Stack:** Express 5 + PostgreSQL 17 (laptop-local :5433 in dev) · Next.js 16 App Router + React 19 + Tailwind v4 · `node --test` for backend tests.

**Spec:** `docs/superpowers/specs/2026-07-29-workshop-retail-piece-rates-design.md`

## Global Constraints

- Stored audience values are English: `wholesale` / `retail`. Arabic labels (`ممثلين` / `تجزئة`) live only in `AUDIENCE_LABEL_AR` in `workshopController.js` and in frontend copy.
- All Arabic UI text is hard-coded Arabic — never English placeholders.
- Worker screens are **phone-only**. Tap targets ≥ 44px (`min-h-11` / `min-h-12` as used in the existing file).
- The audience field has **no default**. An unstated audience is a validation error, never a guess.
- Migrations are additive and idempotent (`IF NOT EXISTS` / `IF EXISTS` everywhere).
- Rates are frozen per entry: `rate` and `amount` are copied onto `workshop_production_entries` at insert time and never recomputed.
- Backend error shape is `{ error: '<Arabic>', code: 'ERR_*' }`.
- Dev DB is laptop-local PostgreSQL on **:5433**. Never point tests at prod.
- Do not connect workshop production to `orders` — out of scope.

---

### Task 1: Migration — `audience` on rates and entries

**Files:**
- Create: `db/migrations/072_workshop_rate_audience.sql`
- Modify: `db/schema.sql:996-1013` (the `workshop_piece_rates` table + seed block), `db/schema.sql:1015-1025` (`workshop_production_entries`)
- Test: `backend/test/workshopAudience.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: columns `workshop_piece_rates.audience` and `workshop_production_entries.audience`, both `TEXT NOT NULL DEFAULT 'wholesale' CHECK (audience IN ('wholesale','retail'))`; unique index `uq_workshop_rate(operation, product, audience)`.

- [ ] **Step 1: Write the migration file**

Create `db/migrations/072_workshop_rate_audience.sql`:

```sql
-- 072: workshop piece rates differ by who the finished piece is for.
--
-- A rate was keyed (operation, product) and applied to every garment regardless of
-- customer. The shop pays a different per-piece wage for retail-student work than for
-- ممثل work, so `audience` joins the key and is stamped onto each production entry.
--
-- DEFAULT 'wholesale' is the backfill: every existing rate and entry was ممثل work.

ALTER TABLE workshop_piece_rates
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));

-- Name verified live 2026-07-29 against the dev DB: the inline UNIQUE (operation, product)
-- from CREATE TABLE is named workshop_piece_rates_operation_product_key.
ALTER TABLE workshop_piece_rates
  DROP CONSTRAINT IF EXISTS workshop_piece_rates_operation_product_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_rate
  ON workshop_piece_rates(operation, product, audience);

-- Day-one safety: give every job a retail price equal to its current wholesale price so
-- no job is worth 0 the moment this ships. The admin then edits only what differs.
INSERT INTO workshop_piece_rates (operation, product, audience, amount)
SELECT operation, product, 'retail', amount
  FROM workshop_piece_rates WHERE audience = 'wholesale'
ON CONFLICT DO NOTHING;

ALTER TABLE workshop_production_entries
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));
```

- [ ] **Step 2: Mirror into `db/schema.sql`**

In `db/schema.sql`, add the `audience` column to the `workshop_piece_rates` CREATE TABLE, replace the inline `UNIQUE (operation, product)` with the standalone unique index, and rewrite the seed block so a fresh database gets **both** audiences. Replace lines 996-1013 with:

```sql
CREATE TABLE IF NOT EXISTS workshop_piece_rates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation  TEXT NOT NULL,
  product    TEXT NOT NULL,
  audience   TEXT NOT NULL DEFAULT 'wholesale' CHECK (audience IN ('wholesale','retail')),
  amount     BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
-- Migration 072: a rate is identified by job AND customer type.
ALTER TABLE workshop_piece_rates ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));
ALTER TABLE workshop_piece_rates DROP CONSTRAINT IF EXISTS workshop_piece_rates_operation_product_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_rate ON workshop_piece_rates(operation, product, audience);

-- Fresh/demo databases get useful example rates for BOTH audiences; existing
-- admin-edited values win. Retail seeds match wholesale until an admin sets the
-- real retail wages.
INSERT INTO workshop_piece_rates (operation, product, audience, amount)
VALUES
  ('cut','robe','wholesale',500), ('overlock','robe','wholesale',750), ('robe_sew','robe','wholesale',1500),
  ('cut','cap','wholesale',250), ('cap_sew','cap','wholesale',750),
  ('cut','shawl','wholesale',250), ('shawl_close','shawl','wholesale',500), ('american_shawl','shawl','wholesale',1000),
  ('cut','sash','wholesale',250), ('shawl_close','sash','wholesale',500),
  ('cut','robe','retail',500), ('overlock','robe','retail',750), ('robe_sew','robe','retail',1500),
  ('cut','cap','retail',250), ('cap_sew','cap','retail',750),
  ('cut','shawl','retail',250), ('shawl_close','shawl','retail',500), ('american_shawl','shawl','retail',1000),
  ('cut','sash','retail',250), ('shawl_close','sash','retail',500)
ON CONFLICT (operation, product, audience) DO NOTHING;
```

Then add to the `workshop_production_entries` block (after the CREATE TABLE):

```sql
ALTER TABLE workshop_production_entries ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (audience IN ('wholesale','retail'));
```

- [ ] **Step 3: Write the failing migration test**

Create `backend/test/workshopAudience.test.js`:

```js
'use strict';
// Workshop rates split by audience (ممثلين / تجزئة).
// Spec: docs/superpowers/specs/2026-07-29-workshop-retail-piece-rates-design.md
// Runs against the LAPTOP-LOCAL dev PG (:5433). Self-cleaning. Never point at prod.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const { query } = require('../lib/db');

test('migration 072: every rate row carries a valid audience', async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int bad FROM workshop_piece_rates
      WHERE audience NOT IN ('wholesale','retail')`
  );
  assert.strictEqual(rows[0].bad, 0);
});

test('migration 072: every wholesale rate has a retail twin', async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int missing
       FROM workshop_piece_rates w
      WHERE w.audience = 'wholesale'
        AND NOT EXISTS (
          SELECT 1 FROM workshop_piece_rates r
           WHERE r.operation = w.operation AND r.product = w.product
             AND r.audience = 'retail')`
  );
  assert.strictEqual(rows[0].missing, 0, 'a job with no retail price would record 0 IQD wages');
});

test('migration 072: (operation, product, audience) is unique', async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int dupes FROM (
       SELECT operation, product, audience FROM workshop_piece_rates
        GROUP BY operation, product, audience HAVING COUNT(*) > 1) d`
  );
  assert.strictEqual(rows[0].dupes, 0);
});

test('migration 072: pre-existing production entries defaulted to wholesale', async () => {
  const { rows } = await query(
    `SELECT COUNT(*)::int bad FROM workshop_production_entries
      WHERE audience NOT IN ('wholesale','retail')`
  );
  assert.strictEqual(rows[0].bad, 0);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd backend && node --test test/workshopAudience.test.js`
Expected: FAIL — `column "audience" does not exist`.

- [ ] **Step 5: Apply the migration**

Run: `cd backend && npm run migrate:file ../db/migrations/072_workshop_rate_audience.sql`

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && node --test test/workshopAudience.test.js`
Expected: PASS, 4/4.

- [ ] **Step 7: Verify the whole suite still passes**

Run: `cd backend && node --test test/`
Expected: PASS — 118/118 (114 existing + 4 new).

- [ ] **Step 8: Commit**

```bash
git add db/migrations/072_workshop_rate_audience.sql db/schema.sql backend/test/workshopAudience.test.js
git commit -m "feat(workshop): migration 072 — piece rates keyed by audience"
```

---

### Task 2: Backend — rate resolution and validation

**Files:**
- Modify: `backend/controllers/workshopController.js:10-22` (constants), `:78-86` (`validatePiece`), `:88-106` (`insertProduction`), `:230-237` (`ratesMatrix`), `:241-252` (`upsertRate`), `:319-324` (exports)
- Test: `backend/test/workshopAudience.test.js` (extend)

**Interfaces:**
- Consumes: the `audience` columns from Task 1.
- Produces:
  - `AUDIENCES = ['wholesale','retail']` and `AUDIENCE_LABEL_AR = { wholesale: 'ممثلين', retail: 'تجزئة' }`, both exported.
  - `validatePiece(body)` → `string | null`; now also rejects a missing/unknown `body.audience`.
  - `insertProduction({ workerId, body, actorUserId })` → `{ data }` or `{ error }`; `body.audience` is required and is stamped on the row.
  - `ratesMatrix()` → 20 rows of `{ operation, product, audience, operation_label_ar, product_label_ar, audience_label_ar, amount }`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/workshopAudience.test.js`:

```js
const wc = require('../controllers/workshopController');

test('validatePiece rejects a missing audience — no silent default', () => {
  const err = wc.validatePiece({ product: 'robe', operation: 'cut', qty: 5 });
  assert.strictEqual(err, 'حدد لمين هالشغل: ممثلين أو تجزئة');
});

test('validatePiece rejects an unknown audience', () => {
  const err = wc.validatePiece({ product: 'robe', operation: 'cut', qty: 5, audience: 'walk_in' });
  assert.strictEqual(err, 'حدد لمين هالشغل: ممثلين أو تجزئة');
});

test('validatePiece accepts a valid retail piece', () => {
  assert.strictEqual(
    wc.validatePiece({ product: 'robe', operation: 'cut', qty: 5, audience: 'retail' }),
    null
  );
});

test('ratesMatrix returns both audiences for every job', async () => {
  const rows = await wc.ratesMatrix();
  const wholesale = rows.filter((r) => r.audience === 'wholesale');
  const retail = rows.filter((r) => r.audience === 'retail');
  assert.strictEqual(wholesale.length, retail.length);
  assert.ok(wholesale.length >= 10, `expected >=10 jobs, got ${wholesale.length}`);
  assert.ok(rows.every((r) => r.audience_label_ar === (r.audience === 'retail' ? 'تجزئة' : 'ممثلين')));
});

test('a retail entry is priced from the RETAIL rate, not the wholesale one', async () => {
  // Self-cleaning: a throwaway user + worker, removed in finally.
  const u = await query(
    `INSERT INTO users (name, password_hash, role) VALUES ('عامل اختبار الأسعار','x','worker') RETURNING id`
  );
  const userId = u.rows[0].id;
  let workerId = null;
  // Snapshot the real rates for this job so the finally block can put back exactly
  // what was there — restoring to a hard-coded number would silently rewrite the
  // shop's configured wages.
  const rateSnapshot = await query(
    `SELECT audience, amount FROM workshop_piece_rates WHERE operation='cut' AND product='robe'`
  );
  try {
    const w = await query(
      `INSERT INTO workshop_workers (user_id) VALUES ($1) RETURNING id`, [userId]
    );
    workerId = w.rows[0].id;

    // Make the two prices differ so the assertion can only pass by reading the right row.
    await query(
      `INSERT INTO workshop_piece_rates (operation, product, audience, amount)
       VALUES ('cut','robe','wholesale',500), ('cut','robe','retail',900)
       ON CONFLICT (operation, product, audience)
       DO UPDATE SET amount = EXCLUDED.amount`
    );

    const retail = await wc.insertProduction({
      workerId, actorUserId: userId,
      body: { product: 'robe', operation: 'cut', qty: 10, audience: 'retail' },
    });
    assert.ok(!retail.error, `unexpected error: ${retail.error}`);
    assert.strictEqual(Number(retail.data.rate), 900);
    assert.strictEqual(Number(retail.data.amount), 9000);

    const wholesale = await wc.insertProduction({
      workerId, actorUserId: userId,
      body: { product: 'robe', operation: 'cut', qty: 10, audience: 'wholesale' },
    });
    assert.strictEqual(Number(wholesale.data.rate), 500);
    assert.strictEqual(Number(wholesale.data.amount), 5000);

    // The rate is frozen: changing the price must not rewrite the stored wage.
    await query(
      `UPDATE workshop_piece_rates SET amount = 1 WHERE operation='cut' AND product='robe' AND audience='retail'`
    );
    const stored = await query(
      `SELECT rate, amount FROM workshop_production_entries WHERE id = $1`, [retail.data.id]
    );
    assert.strictEqual(Number(stored.rows[0].rate), 900, 'past wages must never be recomputed');
    assert.strictEqual(Number(stored.rows[0].amount), 9000);
  } finally {
    if (workerId) await query(`DELETE FROM workshop_production_entries WHERE worker_id = $1`, [workerId]);
    await query(`DELETE FROM workshop_workers WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
    await query(`DELETE FROM workshop_piece_rates WHERE operation='cut' AND product='robe'`);
    for (const row of rateSnapshot.rows) {
      await query(
        `INSERT INTO workshop_piece_rates (operation, product, audience, amount)
         VALUES ('cut','robe',$1,$2)`, [row.audience, row.amount]
      );
    }
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test test/workshopAudience.test.js`
Expected: FAIL — `wc.validatePiece is not a function` (not yet exported) and the pricing test reads the wholesale rate.

- [ ] **Step 3: Add the constants**

In `backend/controllers/workshopController.js`, after the `PRODUCT_LABEL_AR` line (~line 22):

```js
const AUDIENCES = ['wholesale', 'retail'];
const AUDIENCE_LABEL_AR = { wholesale: 'ممثلين', retail: 'تجزئة' };
```

- [ ] **Step 4: Require the audience in `validatePiece`**

Replace `validatePiece` (lines 78-86) with:

```js
function validatePiece(body) {
  const { product, operation, qty, work_date, audience } = body || {};
  if (!PRODUCTS.includes(product) || !OPERATIONS.includes(operation) || !PRODUCT_OPS[product]?.includes(operation)) {
    return 'نوع القطعة أو الشغل غير صحيح';
  }
  // No default on purpose: the audience decides the wage, so an unstated one is an
  // error rather than a guess.
  if (!AUDIENCES.includes(audience)) return 'حدد لمين هالشغل: ممثلين أو تجزئة';
  if (!validInt(qty, 1)) return 'الكمية غير صحيحة';
  if (!validDate(work_date)) return 'التاريخ غير صحيح';
  return null;
}
```

- [ ] **Step 5: Resolve the rate by audience and stamp the entry**

Replace `insertProduction` (lines 88-106) with:

```js
async function insertProduction({ workerId, body, actorUserId }) {
  const error = validatePiece(body);
  if (error) return { error };
  const rate = await query(
    `SELECT amount FROM workshop_piece_rates WHERE operation = $1 AND product = $2 AND audience = $3`,
    [body.operation, body.product, body.audience]
  );
  const unitRate = n(rate.rows[0]?.amount);
  const amount = unitRate * body.qty;
  const { rows } = await query(
    `INSERT INTO workshop_production_entries
       (worker_id, product, operation, audience, qty, rate, amount, work_date, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date,CURRENT_DATE),$9,$10)
     RETURNING id, qty, rate, amount, audience, work_date, created_at`,
    [workerId, body.product, body.operation, body.audience, body.qty, unitRate, amount,
      body.work_date || null, String(body.note || '').trim() || null, actorUserId]
  );
  return { data: rows[0] };
}
```

- [ ] **Step 6: Return both audiences from `ratesMatrix`**

Replace `ratesMatrix` (lines 230-237) with:

```js
async function ratesMatrix() {
  const { rows } = await query(`SELECT operation,product,audience,amount FROM workshop_piece_rates`);
  const saved = Object.fromEntries(rows.map((r) => [`${r.operation}:${r.product}:${r.audience}`, n(r.amount)]));
  return PRODUCTS.flatMap((product) => PRODUCT_OPS[product].flatMap((operation) =>
    AUDIENCES.map((audience) => ({
      operation, product, audience,
      operation_label_ar: OP_LABEL_AR[operation],
      product_label_ar: PRODUCT_LABEL_AR[product],
      audience_label_ar: AUDIENCE_LABEL_AR[audience],
      amount: saved[`${operation}:${product}:${audience}`] || 0,
    }))));
}
```

- [ ] **Step 7: Accept the audience in `upsertRate`**

Replace `upsertRate` (lines 241-252) with:

```js
async function upsertRate(req, res) {
  const { operation, product, audience, amount } = req.body || {};
  if (!PRODUCTS.includes(product) || !PRODUCT_OPS[product]?.includes(operation)
      || !AUDIENCES.includes(audience) || !validInt(amount)) {
    return res.status(400).json({ error: 'العملية أو السعر غير صحيح', code: 'ERR_VALIDATION' });
  }
  await query(
    `INSERT INTO workshop_piece_rates(operation,product,audience,amount,updated_by) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(operation,product,audience) DO UPDATE SET amount=EXCLUDED.amount,updated_at=NOW(),updated_by=EXCLUDED.updated_by`,
    [operation, product, audience, amount, req.user.id]
  );
  res.json({ ok: true });
}
```

- [ ] **Step 8: Export the new symbols**

In the `module.exports` block (lines 319-324), add `validatePiece`, `insertProduction`, `ratesMatrix`, `AUDIENCES`, `AUDIENCE_LABEL_AR` so the tests can reach them:

```js
module.exports = {
  attachWorker, requireLead, requireWorkerSelf, portalMembers, portalLogin,
  mySummary, myProduction, listWorkers, createWorker, updateWorker, linkCandidates,
  listRates, upsertRate, createProduction, createAdjustment, workerLedger, dashboard,
  validatePiece, insertProduction, ratesMatrix,
  OPERATIONS, PRODUCTS, PRODUCT_OPS, AUDIENCES, AUDIENCE_LABEL_AR,
};
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd backend && node --test test/workshopAudience.test.js`
Expected: PASS, 9/9.

- [ ] **Step 10: Verify syntax and the whole suite**

Run: `cd backend && node --check controllers/workshopController.js && node --test test/`
Expected: syntax clean; PASS 123/123.

- [ ] **Step 11: Commit**

```bash
git add backend/controllers/workshopController.js backend/test/workshopAudience.test.js
git commit -m "feat(workshop): price production by audience, require it on every entry"
```

---

### Task 3: Backend — split totals on the ledger and dashboard

**Files:**
- Modify: `backend/controllers/workshopController.js:108-137` (`ledgerFor`), `:281-310` (`dashboard`)
- Test: `backend/test/workshopAudience.test.js` (extend)

**Interfaces:**
- Consumes: `insertProduction` and the `audience` column from Task 2.
- Produces:
  - `ledgerFor(workerId, limit)` result gains `production_wholesale` and `production_retail` (numbers); each `kind === 'production'` entry gains `audience` and `audience_label_ar`. `payable` is unchanged.
  - `dashboard` response `totals` gains `production_wholesale`, `production_retail`, `pieces_wholesale`, `pieces_retail`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/workshopAudience.test.js`:

```js
test('ledger split totals sum to the combined production total', async () => {
  const u = await query(
    `INSERT INTO users (name, password_hash, role) VALUES ('عامل اختبار المجاميع','x','worker') RETURNING id`
  );
  const userId = u.rows[0].id;
  let workerId = null;
  // Same snapshot-and-restore discipline as the pricing test above.
  const rateSnapshot = await query(
    `SELECT audience, amount FROM workshop_piece_rates WHERE operation='cut' AND product='cap'`
  );
  try {
    const w = await query(`INSERT INTO workshop_workers (user_id) VALUES ($1) RETURNING id`, [userId]);
    workerId = w.rows[0].id;
    await query(
      `INSERT INTO workshop_piece_rates (operation, product, audience, amount)
       VALUES ('cut','cap','wholesale',200), ('cut','cap','retail',350)
       ON CONFLICT (operation, product, audience) DO UPDATE SET amount = EXCLUDED.amount`
    );
    await wc.insertProduction({ workerId, actorUserId: userId,
      body: { product: 'cap', operation: 'cut', qty: 4, audience: 'wholesale' } });
    await wc.insertProduction({ workerId, actorUserId: userId,
      body: { product: 'cap', operation: 'cut', qty: 2, audience: 'retail' } });

    const ledger = await wc.ledgerFor(workerId);
    assert.strictEqual(ledger.production_wholesale, 800);
    assert.strictEqual(ledger.production_retail, 700);
    assert.strictEqual(
      ledger.production_wholesale + ledger.production_retail,
      ledger.production,
      'the two audiences must partition the production total'
    );
    const production = ledger.entries.filter((e) => e.kind === 'production');
    assert.ok(production.every((e) => ['ممثلين', 'تجزئة'].includes(e.audience_label_ar)));
  } finally {
    if (workerId) await query(`DELETE FROM workshop_production_entries WHERE worker_id = $1`, [workerId]);
    await query(`DELETE FROM workshop_workers WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
    await query(`DELETE FROM workshop_piece_rates WHERE operation='cut' AND product='cap'`);
    for (const row of rateSnapshot.rows) {
      await query(
        `INSERT INTO workshop_piece_rates (operation, product, audience, amount)
         VALUES ('cut','cap',$1,$2)`, [row.audience, row.amount]
      );
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test test/workshopAudience.test.js`
Expected: FAIL — `wc.ledgerFor is not a function`, then `undefined !== 800`.

- [ ] **Step 3: Split the ledger totals and label the entries**

Replace `ledgerFor` (lines 108-137) with:

```js
async function ledgerFor(workerId, limit = 100) {
  const totals = await query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE worker_id=$1),0) AS production,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE worker_id=$1 AND audience='wholesale'),0) AS production_wholesale,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE worker_id=$1 AND audience='retail'),0) AS production_retail,
       COALESCE((SELECT SUM(amount) FROM workshop_adjustments WHERE worker_id=$1 AND kind='bonus'),0) AS bonuses,
       COALESCE((SELECT SUM(amount) FROM workshop_adjustments WHERE worker_id=$1 AND kind='deduction'),0) AS deductions,
       COALESCE((SELECT SUM(qty) FROM workshop_production_entries WHERE worker_id=$1),0)::int AS pieces`,
    [workerId]
  );
  const entries = await query(
    `SELECT id, 'production' AS kind, product, operation, audience, qty, rate, amount,
            work_date AS entry_date, note AS reason, created_at
       FROM workshop_production_entries WHERE worker_id=$1
     UNION ALL
     SELECT id, kind, NULL, NULL, NULL, 0, 0, amount, entry_date, reason, created_at
       FROM workshop_adjustments WHERE worker_id=$1
     ORDER BY created_at DESC LIMIT $2`, [workerId, limit]
  );
  const t = totals.rows[0];
  const production = n(t.production), bonuses = n(t.bonuses), deductions = n(t.deductions);
  return {
    production,
    production_wholesale: n(t.production_wholesale),
    production_retail: n(t.production_retail),
    bonuses, deductions, payable: production + bonuses - deductions,
    pieces: n(t.pieces),
    entries: entries.rows.map((r) => ({
      ...r, qty: n(r.qty), rate: n(r.rate), amount: n(r.amount),
      product_label_ar: r.product ? PRODUCT_LABEL_AR[r.product] : null,
      operation_label_ar: r.operation ? OP_LABEL_AR[r.operation] : null,
      audience_label_ar: r.audience ? AUDIENCE_LABEL_AR[r.audience] : null,
    })),
  };
}
```

- [ ] **Step 4: Split the dashboard totals**

In `dashboard` (line 285), replace the `totals` query with:

```js
  const totals = await query(
    `SELECT
       COALESCE((SELECT SUM(qty) FROM workshop_production_entries),0)::int pieces,
       COALESCE((SELECT SUM(qty) FROM workshop_production_entries WHERE audience='wholesale'),0)::int pieces_wholesale,
       COALESCE((SELECT SUM(qty) FROM workshop_production_entries WHERE audience='retail'),0)::int pieces_retail,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries),0) production,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE audience='wholesale'),0) production_wholesale,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE audience='retail'),0) production_retail,
       COALESCE((SELECT SUM(amount) FROM workshop_adjustments WHERE kind='bonus'),0) bonuses,
       COALESCE((SELECT SUM(amount) FROM workshop_adjustments WHERE kind='deduction'),0) deductions`
  );
```

and extend the emitted `totals` object (line 302) to:

```js
  res.json({ totals: {
    active_workers: n(workers.rows[0].active_workers), pieces: n(t.pieces),
    pieces_wholesale: n(t.pieces_wholesale), pieces_retail: n(t.pieces_retail),
    production: n(t.production),
    production_wholesale: n(t.production_wholesale), production_retail: n(t.production_retail),
    bonuses: n(t.bonuses), deductions: n(t.deductions), payable: n(t.production) + n(t.bonuses) - n(t.deductions),
  }, workers: (await workerRows()).data,
```

Then carry the audience into the `recent` feed. Replace its query (line 293) with:

```js
  const recent = await query(
    `SELECT p.id,'production' kind,u.name worker_name,p.product,p.operation,p.audience,p.qty,p.rate,p.amount,
            p.work_date entry_date,p.note reason,p.created_at
       FROM workshop_production_entries p JOIN workshop_workers w ON w.id=p.worker_id JOIN users u ON u.id=w.user_id
     UNION ALL
     SELECT a.id,a.kind,u.name,NULL,NULL,NULL,0,0,a.amount,a.entry_date,a.reason,a.created_at
       FROM workshop_adjustments a JOIN workshop_workers w ON w.id=a.worker_id JOIN users u ON u.id=w.user_id
     ORDER BY created_at DESC LIMIT 100`
  );
```

and add the label to its mapper (line 306):

```js
  recent: recent.rows.map((r) => ({ ...r, qty: n(r.qty), rate: n(r.rate), amount: n(r.amount),
    product_label_ar: r.product ? PRODUCT_LABEL_AR[r.product] : null,
    operation_label_ar: r.operation ? OP_LABEL_AR[r.operation] : null,
    audience_label_ar: r.audience ? AUDIENCE_LABEL_AR[r.audience] : null,
  })) });
```

- [ ] **Step 5: Export `ledgerFor`**

Add `ledgerFor` to `module.exports`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && node --test test/workshopAudience.test.js`
Expected: PASS, 10/10.

- [ ] **Step 7: Verify syntax and the whole suite**

Run: `cd backend && node --check controllers/workshopController.js && node --test test/`
Expected: syntax clean; PASS 124/124.

- [ ] **Step 8: Commit**

```bash
git add backend/controllers/workshopController.js backend/test/workshopAudience.test.js
git commit -m "feat(workshop): split production totals by audience on ledger + dashboard"
```

---

### Task 4: Frontend — worker screen (toggle, split totals, labels)

**Files:**
- Modify: `frontend/lib/workshop.ts:7-13` (`RateRow`), `:45-53` (`WorkerSummary`), the `WorkshopLedgerEntry` interface, and `recordMyProduction`
- Modify: `frontend/app/workshop/page.tsx` (`ProductionForm`, `Account`)

**Interfaces:**
- Consumes: `ratesMatrix` rows (20, each with `audience`/`audience_label_ar`) and the ledger split totals from Tasks 2-3.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Extend the types**

In `frontend/lib/workshop.ts`:

```ts
export type WorkshopAudience = "wholesale" | "retail";

export interface RateRow {
  operation: WorkshopOperation;
  product: WorkshopProduct;
  audience: WorkshopAudience;
  operation_label_ar: string;
  product_label_ar: string;
  audience_label_ar: string;
  amount: number;
}
```

Add these two fields to `WorkshopLedgerEntry` (adjustment rows carry `null`):

```ts
  audience: WorkshopAudience | null;
  audience_label_ar: string | null;
```

Add these two to `WorkerSummary`, beside the existing `production`:

```ts
  production_wholesale: number;
  production_retail: number;
```

And add `audience: WorkshopAudience;` to the body parameter of `recordMyProduction` and of the admin `createProduction` wrapper.

- [ ] **Step 2: Add the audience toggle to the worker form**

In `frontend/app/workshop/page.tsx`, inside `ProductionForm`, add state with **no default**:

```tsx
const [audience, setAudience] = useState<WorkshopAudience | null>(null);
```

Filter the rate lookup by it, so the live price follows the toggle:

```tsx
const rate = audience
  ? rates.find((r) => r.product === product && r.operation === operation && r.audience === audience)?.amount || 0
  : 0;
```

Render the toggle as the **first** field in the form, above القطعة:

```tsx
<Field label="لمين هالشغل؟">
  <div className="grid grid-cols-2 gap-3">
    {([["wholesale", "ممثلين"], ["retail", "تجزئة"]] as [WorkshopAudience, string][]).map(([value, label]) => (
      <button
        key={value}
        type="button"
        onClick={() => setAudience(value)}
        aria-pressed={audience === value}
        className={`min-h-12 rounded-xl border px-4 font-semibold transition-colors ${
          audience === value
            ? "border-orange-ink bg-orange-ink text-white"
            : "border-line bg-white text-ink"
        }`}
      >
        {label}
      </button>
    ))}
  </div>
</Field>
```

- [ ] **Step 3: Block submission until the audience is chosen**

In `submit`, before the qty check:

```tsx
if (!audience) { toast.error("حدد لمين هالشغل: ممثلين أو تجزئة"); return; }
```

Pass it through: `recordMyProduction({ product, operation, audience, qty: count, work_date: date, note })`.

Disable the submit button while it is unset: change `disabled={busy}` to `disabled={busy || !audience}`.

Note the price line already reads `formatIQD(rate)`, which shows 0 until the toggle is tapped — that is intended feedback, not a bug.

- [ ] **Step 4: Deduplicate the product and operation pickers**

`rates` now holds 20 rows, so the existing `products` and `available` derivations would list each product and operation twice. Scope them to one audience — the lists are identical for both, so pick `wholesale` as the canonical source:

```tsx
const jobs = useMemo(() => rates.filter((r) => r.audience === "wholesale"), [rates]);
const available = useMemo(() => jobs.filter((r) => r.product === product), [jobs, product]);
const products = Array.from(new Map(jobs.map((r) => [r.product, r.product_label_ar])).entries());
```

Update `changeProduct` to search `jobs` rather than `rates`.

- [ ] **Step 5: Split the totals in حسابك**

In `Account`, replace the first metric with the two split ones (keeping حوافز/خصومات/المستحق):

```tsx
<div className="grid grid-cols-2 gap-3">
  <Metric label="أجور ممثلين" value={formatIQD(summary.production_wholesale)} />
  <Metric label="أجور تجزئة" value={formatIQD(summary.production_retail)} />
  <Metric label="حوافز" value={formatIQD(summary.bonuses)} />
  <Metric label="خصومات" value={formatIQD(summary.deductions)} />
  <Metric label="المستحق" value={formatIQD(summary.payable)} accent />
</div>
```

- [ ] **Step 6: Label each production line with its audience**

In the آخر الحركات list, change the production label to include the audience:

```tsx
{e.kind === "production"
  ? `${e.operation_label_ar} · ${e.product_label_ar} × ${e.qty} · ${e.audience_label_ar}`
  : e.kind === "bonus" ? "حافز" : "خصم"}
```

- [ ] **Step 7: Verify types and lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint app/workshop lib/workshop.ts`
Expected: 0 errors from both.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/workshop.ts frontend/app/workshop/page.tsx
git commit -m "feat(workshop): worker records who the work is for, sees split wages"
```

---

### Task 5: Frontend — admin screen (two-price rates, record toggle, overview filter)

**Files:**
- Modify: `frontend/app/admin/workshop/page.tsx` (`Rates`, `RecordForm`, `Overview`)
- Modify: `frontend/lib/workshop.ts` (`upsertRate` signature, `WorkshopDashboard` totals)

**Interfaces:**
- Consumes: everything from Tasks 2-4.
- Produces: nothing.

- [ ] **Step 1: Add `audience` to the `upsertRate` wrapper**

In `frontend/lib/workshop.ts`, change the signature to `upsertRate(operation, product, audience, amount)` and send `audience` in the body. Add the split fields to `WorkshopDashboard["totals"]` — note it is currently declared as `Omit<WorkerSummary, "entries" | "rates"> & { active_workers: number }`, so `production_wholesale`/`production_retail` arrive automatically from the `WorkerSummary` change in Task 4; add `pieces_wholesale: number` and `pieces_retail: number` explicitly.

- [ ] **Step 2: Give each job row two price inputs**

Rewrite `Rates` to group the 20 rows by `(product, operation)` and render one card per job with a ممثلين input and a تجزئة input:

```tsx
function Rates({ rows, onDone }: { rows: RateRow[]; onDone: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [`${r.product}:${r.operation}:${r.audience}`, String(r.amount)])));
  const [busy, setBusy] = useState<string | null>(null);

  const jobs = Array.from(
    new Map(rows.map((r) => [`${r.product}:${r.operation}`, r])).values()
  );

  async function save(job: RateRow) {
    const jobKey = `${job.product}:${job.operation}`;
    const pending = (["wholesale", "retail"] as const).map((audience) => ({
      audience, amount: Math.floor(Number(drafts[`${jobKey}:${audience}`])),
    }));
    if (pending.some((p) => !Number.isFinite(p.amount) || p.amount < 0)) {
      toast.error("السعر غير صحيح"); return;
    }
    setBusy(jobKey);
    try {
      for (const p of pending) await upsertRate(job.operation, job.product, p.audience, p.amount);
      toast.success("تم حفظ السعرين");
      await onDone();
    } catch (e) { toast.error(getApiErrorMessage(e, "تعذّر الحفظ")); }
    finally { setBusy(null); }
  }

  return <div className="grid gap-3 sm:grid-cols-2">{jobs.map((job) => {
    const jobKey = `${job.product}:${job.operation}`;
    return <div key={jobKey} className="rounded-2xl border border-line bg-surface p-4">
      <p className="mb-3 text-sm font-bold text-ink">{job.operation_label_ar} · {job.product_label_ar}</p>
      <div className="grid grid-cols-2 gap-3">
        {(["wholesale", "retail"] as const).map((audience) => (
          <Input key={audience} label={audience === "retail" ? "تجزئة" : "ممثلين"} type="number" min={0}
            value={drafts[`${jobKey}:${audience}`] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [`${jobKey}:${audience}`]: e.target.value }))} />
        ))}
      </div>
      <Button className="mt-3" size="sm" onClick={() => save(job)} loading={busy === jobKey}>حفظ</Button>
    </div>;
  })}</div>;
}
```

- [ ] **Step 3: Add the same toggle to the admin record-on-behalf form**

`RecordForm` posts through the same `insertProduction`, so without this it will 400 with «حدد لمين هالشغل». Add `const [audience, setAudience] = useState<WorkshopAudience | null>(null);`, render a `Select` with an empty first option so nothing is preselected:

```tsx
<Select label="لمين هالشغل" value={audience ?? ""}
  onChange={(e) => setAudience((e.target.value || null) as WorkshopAudience | null)}
  options={[{ value: "", label: "— اختر —" }, { value: "wholesale", label: "ممثلين" }, { value: "retail", label: "تجزئة" }]} />
```

Guard `submit` with `if (!audience) { toast.error("حدد لمين هالشغل"); return; }` and include `audience` in the posted body.

`rates` now holds 20 rows here too, so the derivations at lines 65-69 would list every product and operation twice. Scope them to one audience (the job lists are identical for both):

```tsx
const jobs = useMemo(() => rates.filter((r) => r.audience === "wholesale"), [rates]);
const available = useMemo(() => jobs.filter((r) => r.product === product), [jobs, product]);
const productOptions = Array.from(new Map(jobs.map((r) => [r.product, r.product_label_ar])).entries())
  .map(([value, label]) => ({ value, label }));
const rate = audience
  ? rates.find((r) => r.product === product && r.operation === operation && r.audience === audience)?.amount || 0
  : 0;
```

The القطعة `Select`'s `onChange` also searches `rates` for the fallback operation — point it at `jobs` instead:

```tsx
onChange={(e) => { const p = e.target.value as WorkshopProduct; setProduct(p);
  setOperation(jobs.find((r) => r.product === p)?.operation || 'cut'); }}
```

- [ ] **Step 4: Add the overview filter**

In `Overview`, add `const [audience, setAudience] = useState<"all" | WorkshopAudience>("all");` and render this filter row directly above the stat tiles:

```tsx
<div className="flex flex-wrap gap-2" role="group" aria-label="تصفية حسب نوع الزبون">
  {([["all", "الكل"], ["wholesale", "ممثلين"], ["retail", "تجزئة"]] as ["all" | WorkshopAudience, string][])
    .map(([key, label]) => (
      <button key={key} type="button" onClick={() => setAudience(key)} aria-pressed={audience === key}
        className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
          audience === key ? "border-orange-ink bg-orange-ink text-white" : "border-line bg-surface text-ink"
        }`}>
        {label}
      </button>
    ))}
</div>
```

Drive the القطع and أجور القطع tiles from it:

```tsx
const pieces = audience === "all" ? data.totals.pieces
  : audience === "retail" ? data.totals.pieces_retail : data.totals.pieces_wholesale;
const production = audience === "all" ? data.totals.production
  : audience === "retail" ? data.totals.production_retail : data.totals.production_wholesale;
```

Render الحوافز/الخصومات/المستحق **only when `audience === "all"`** — they belong to no audience, so a sliced المستحق would not add up. Update the `CalculationDetails` copy to say so when a filter is active:

```tsx
<p>الحوافز والخصومات لا تتبع نوع الزبون، لذلك يظهر المستحق في «الكل» فقط.</p>
```

- [ ] **Step 5: Verify types and lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint app/admin/workshop lib/workshop.ts`
Expected: 0 errors from both.

- [ ] **Step 6: Full verification**

Run:
```bash
cd backend && node --test test/
cd ../frontend && npx tsc --noEmit && npx eslint .
```
Expected: backend 124/124 PASS · tsc 0 · eslint 0 errors (6 pre-existing warnings in `android/app/build/` generated files are unrelated).

- [ ] **Step 7: Browser walkthrough**

These screens are phone-first and have historically hidden bugs code review did not catch (the 2026-07-26 autofill bug, the 2026-07-21 `bg-card` bug). With backend :4000 and frontend :3000 up:

1. `/workshop` as a worker → سجّل شغلك: confirm the toggle starts **unselected**, the price line reads 0, and سجّل is disabled.
2. Tap تجزئة → the price line shows the retail rate. Record 10 روب · قص.
3. Tap ممثلين → record 10 more → confirm the two entries show different amounts.
4. حسابك → أجور ممثلين and أجور تجزئة are separate, both ledger lines name their audience, المستحق equals the sum plus/minus adjustments.
5. `/admin/workshop` → أسعار القطع: set a تجزئة price different from ممثلين, save, reload, confirm it stuck.
6. نظرة عامة → the three filter buttons change القطع and أجور القطع; المستحق shows only under الكل.
7. تسجيل القطع → record on a worker's behalf with each audience; confirm submitting without choosing shows the Arabic error rather than a 500.
8. Check the browser console is clean at 390px width.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/admin/workshop/page.tsx frontend/lib/workshop.ts
git commit -m "feat(workshop): admin sets both prices per job, filters totals by audience"
```

---

## Deploy notes

`scripts/deploy.sh` runs `npm run migrate` (line 17) before `pm2 reload` (line 23), so 072 lands ahead of the code that reads `audience`. The migration is additive and the currently deployed code ignores the new columns, so the ordering is safe either way.

**After deploy:** the real تجزئة wages must be entered in `/admin/workshop` → أسعار القطع. Until then every retail rate equals its wholesale twin and the split is structurally correct but numerically meaningless.
