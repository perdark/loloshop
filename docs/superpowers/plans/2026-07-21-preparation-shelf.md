# رف التجهيز (Preparation Shelf) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give التجهيز a shelf that stages retail pieces in per-student bins while their set waits for the slow embroidered sash, and surfaces which sets are complete and packable right now.

**Architecture:** A new `shelf_sections` config table drives 3 shelves (A روب · B وشاح · C قبعة+شال). Bin state lives in `shelf_slot_occupancy` (one open bin per physical slot, DB-enforced) + `shelf_placements` (one row per shelved piece). All logic lives in a new `backend/lib/shelf.js`; `backend/controllers/shelfController.js` is a thin HTTP layer. Collection reuses the existing `performAdvance` state machine — no parallel state machine is introduced. `orders` is not modified.

**Tech Stack:** Express 5 · PostgreSQL (laptop-local PG17 on :5433 in dev) · Next.js 16 App Router + React 19 · Tailwind v4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-preparation-shelf-design.md`. Decisions D1–D7 there are owner-locked; do not renegotiate them in code.
- **Retail only** (`students.wholesaler_id IS NULL`), enforced **server-side** in every query. Rep pieces never appear.
- All error responses: `{ error: <Arabic message>, code: 'ERR_*' }`.
- All UI is Arabic, `dir="rtl"`, iPad-first, tap targets ≥44px. Never hardcode Arabic text as English.
- Brand tokens only: orange `#F47B42`/`#FFB100`, cream `#FAEBD7`, card `#FFF8F0`, ink `#1A1A1A`. Never purple gradients or Inter.
- Order-status rules live ONLY in the backend. The frontend must never re-derive whether a transition is allowed — it renders `can_*` flags the API returns.
- Dev DB is the laptop-local PG17 (`postgresql://loloshop:loloshop_dev@127.0.0.1:5433/loloshop`). Never point tests at prod.
- **A concurrent Claude session is editing frontend/design files.** Commit **by explicit path only** — never `git add -A`.

---

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/069_preparation_shelf.sql` (create) | Schema + seeded sections |
| `db/schema.sql` (modify) | Mirror of 069 so `npm run migrate` stays idempotent |
| `backend/lib/shelf.js` (create) | All shelf logic: sections, suggestion, place, collect, release, board |
| `backend/controllers/shelfController.js` (create) | Thin HTTP layer over `lib/shelf.js` |
| `backend/routes/production.js` (modify) | Mount shelf routes |
| `backend/controllers/productionController.js` (modify) | Release bins on revert/delete; expose suggestion on advance |
| `backend/test/shelf.test.js` (create) | Integration tests against dev PG, self-cleaning |
| `frontend/lib/shelf.ts` (create) | Typed API wrappers + types |
| `frontend/app/staff/shelf/page.tsx` (create) | Route shell |
| `frontend/components/staff/shelf/ShelfConsole.tsx` (create) | 3-zone console |
| `frontend/components/staff/shelf/ShelfMap.tsx` (create) | Zone 3 shelf furniture |
| `frontend/components/staff/shelf/PlaceSheet.tsx` (create) | Shared confirm/change-bin sheet |
| `frontend/components/staff/StaffSidebar.tsx` (modify) | «رف التجهيز» nav link |
| `frontend/app/staff/page.tsx` (modify) | Presser confirm-sheet hook after advance |

`backend/controllers/productionController.js` is already 1552 lines; shelf logic deliberately does **not** go there.

---

## Task 1: Migration + seeded config

**Files:**
- Create: `db/migrations/069_preparation_shelf.sql`
- Modify: `db/schema.sql` (append mirror)

**Interfaces:**
- Produces: tables `shelf_sections`, `shelf_slot_occupancy`, `shelf_placements`; type `shelf_mode`.

- [ ] **Step 1: Confirm 069 is free** (a concurrent session may have claimed it)

```bash
ls db/migrations/ | tail -3
```
Expected: highest is `068_otp_send_events.sql`. If `069` exists, renumber this migration to the next free number everywhere in this plan.

- [ ] **Step 2: Write the migration**

```sql
-- 069: رف التجهيز — per-student staging bins between الكوي and التجهيز.
-- Retail only. Config is per-SECTION so a shelf may mix modes (C = 6 exclusive cap
-- bins + 1 shared شال bin). See docs/superpowers/specs/2026-07-21-preparation-shelf-design.md

DO $$ BEGIN
  CREATE TYPE shelf_mode AS ENUM ('exclusive', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS shelf_sections (
  id           SERIAL PRIMARY KEY,
  shelf_code   TEXT       NOT NULL,
  piece_type   TEXT       NOT NULL,
  label_ar     TEXT       NOT NULL,
  slot_count   INT        NOT NULL CHECK (slot_count >= 0),
  max_per_slot INT,
  mode         shelf_mode NOT NULL DEFAULT 'exclusive',
  sort_order   INT        NOT NULL,
  UNIQUE (shelf_code, sort_order)
);

CREATE TABLE IF NOT EXISTS shelf_slot_occupancy (
  id         SERIAL PRIMARY KEY,
  shelf_code TEXT NOT NULL,
  slot_index INT  NOT NULL,
  student_id UUID REFERENCES students(id),
  section_id INT  NOT NULL REFERENCES shelf_sections(id),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ
);

-- THE constraint: at most one OPEN bin per physical slot.
CREATE UNIQUE INDEX IF NOT EXISTS shelf_slot_one_open
  ON shelf_slot_occupancy (shelf_code, slot_index) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS shelf_placements (
  order_id     UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  occupancy_id INT  NOT NULL REFERENCES shelf_slot_occupancy(id),
  student_id   UUID NOT NULL REFERENCES students(id),
  placed_by    UUID REFERENCES users(id),
  placed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_by UUID REFERENCES users(id),
  collected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shelf_placements_live
  ON shelf_placements (student_id) WHERE collected_at IS NULL;
CREATE INDEX IF NOT EXISTS shelf_placements_occupancy
  ON shelf_placements (occupancy_id);

-- Seeded layout (owner-locked D7). Idempotent.
INSERT INTO shelf_sections (shelf_code, piece_type, label_ar, slot_count, max_per_slot, mode, sort_order)
VALUES
  ('A', 'robe',  'روب',   10, 10,   'exclusive', 1),
  ('B', 'sash',  'وشاح',  15, 10,   'exclusive', 1),
  ('C', 'cap',   'قبعة',   6,  4,   'exclusive', 1),
  ('C', 'shawl', 'شال',    1, NULL, 'shared',    2)
ON CONFLICT (shelf_code, sort_order) DO NOTHING;
```

- [ ] **Step 3: Apply it**

```bash
cd backend && npm run migrate:file ../db/migrations/069_preparation_shelf.sql
```
Expected: no error.

- [ ] **Step 4: Verify the seed**

```bash
cd backend && node -e "
require('dotenv').config(); const {query}=require('./lib/db');
query('SELECT shelf_code,piece_type,slot_count,max_per_slot,mode FROM shelf_sections ORDER BY shelf_code,sort_order')
 .then(r=>{console.table(r.rows);process.exit(0)});"
```
Expected: 4 rows — A/robe/10/10/exclusive · B/sash/15/10/exclusive · C/cap/6/4/exclusive · C/shawl/1/null/shared.

- [ ] **Step 5: Mirror into `db/schema.sql`** — append the same statements so a fresh `npm run migrate` builds the tables.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/069_preparation_shelf.sql db/schema.sql
git commit -m "feat(shelf): migration 069 — preparation shelf tables + seeded sections"
```

---

## Task 2: `backend/lib/shelf.js` — core logic

**Files:**
- Create: `backend/lib/shelf.js`
- Create: `backend/test/shelf.test.js`

**Interfaces:**
- Consumes: `lib/db.js` `{ query, tx }`; Task 1 tables.
- Produces:
  - `loadSections()` → `Section[]` where `Section = {id, shelf_code, piece_type, label_ar, slot_count, max_per_slot, mode, sort_order, slot_from, slot_to}`
  - `slotCode(shelf_code, slot_index)` → `'A03'`
  - `suggestSlot(section, studentId, occupancyRows)` → `{shelf_code, slot_index, over} | null`
  - `placePiece(orderId, user, target?)` → `{placement, slot_code, over}` — throws `ShelfError`
  - `collectPiece(orderId, user)` → `{collected, set_closed, advanced_ids}`
  - `releaseForOrder(orderId, client?)` → `void` (used by revert/delete)
  - `buildBoard(user)` → board object (shape in Task 3)
  - `class ShelfError extends Error { status, code, messageAr }`

- [ ] **Step 1: Write failing tests**

```js
// backend/test/shelf.test.js — run against laptop-local dev PG, self-cleaning.
const test = require('node:test');
const assert = require('node:assert');
const shelf = require('../lib/shelf');

test('slotCode pads to 2 digits', () => {
  assert.strictEqual(shelf.slotCode('A', 3), 'A03');
  assert.strictEqual(shelf.slotCode('C', 7), 'C07');
});

test('sections carry derived slot ranges', async () => {
  const s = await shelf.loadSections();
  const cap = s.find((x) => x.piece_type === 'cap');
  const shawl = s.find((x) => x.piece_type === 'shawl');
  assert.strictEqual(cap.slot_from, 1);
  assert.strictEqual(cap.slot_to, 6);
  assert.strictEqual(shawl.slot_from, 7);   // shawl starts AFTER the cap section
  assert.strictEqual(shawl.slot_to, 7);
  assert.strictEqual(shawl.mode, 'shared');
});

test('suggestSlot reuses the student own bin, else lowest free', async () => {
  const sections = await shelf.loadSections();
  const robe = sections.find((x) => x.piece_type === 'robe');
  const S1 = '11111111-1111-1111-1111-111111111111';
  // no bins open → lowest free index
  assert.deepStrictEqual(
    shelf.suggestSlot(robe, S1, []),
    { shelf_code: 'A', slot_index: 1, over: false }
  );
  // student already owns A02 with 10 pieces (at max) → still their own bin, flagged over
  const occ = [{ shelf_code: 'A', slot_index: 2, student_id: S1, live_count: 10 }];
  assert.deepStrictEqual(
    shelf.suggestSlot(robe, S1, occ),
    { shelf_code: 'A', slot_index: 2, over: true }
  );
  // a DIFFERENT student's bin is skipped, not reused
  const other = [{ shelf_code: 'A', slot_index: 1, student_id: 'x', live_count: 1 }];
  assert.deepStrictEqual(
    shelf.suggestSlot(robe, S1, other),
    { shelf_code: 'A', slot_index: 2, over: false }
  );
});

test('suggestSlot returns null when the section is full of other students', async () => {
  const sections = await shelf.loadSections();
  const cap = sections.find((x) => x.piece_type === 'cap');
  const occ = Array.from({ length: 6 }, (_, i) => ({
    shelf_code: 'C', slot_index: i + 1, student_id: 'other', live_count: 1,
  }));
  assert.strictEqual(shelf.suggestSlot(cap, 'me', occ), null);
});

test('shared section always returns its single slot regardless of student', async () => {
  const sections = await shelf.loadSections();
  const shawl = sections.find((x) => x.piece_type === 'shawl');
  const occ = [{ shelf_code: 'C', slot_index: 7, student_id: null, live_count: 40 }];
  assert.deepStrictEqual(
    shelf.suggestSlot(shawl, 'anyone', occ),
    { shelf_code: 'C', slot_index: 7, over: false }   // shared bins have no max
  );
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend && node --test test/shelf.test.js
```
Expected: FAIL — `Cannot find module '../lib/shelf'`.

- [ ] **Step 3: Implement `backend/lib/shelf.js`**

Key rules to encode (from the spec):
- `slot_from`/`slot_to` are derived by running-sum of `slot_count` over a shelf's sections ordered by `sort_order`. Shelf C therefore yields cap 1–6, شال 7.
- `suggestSlot`: shared → the section's single slot, `over` always `false` (no max). Exclusive → the student's own open bin if one exists in range (`over = live_count >= max_per_slot`), else the lowest index in range with no open bin, else `null`.
- `placePiece` runs inside `tx`, takes `SELECT … FOR UPDATE` on the target occupancy row, and rejects an exclusive bin already open for a **different** student with `ShelfError(409, 'ERR_SLOT_TAKEN', 'الخانة مشغولة بطالب آخر')`. Exceeding `max_per_slot` in the student's **own** bin is allowed and returns `over: true`.
- Reject wrong piece type for the section (`ERR_WRONG_SECTION`) and out-of-range index (`ERR_BAD_SLOT`).
- Reject a non-retail order (`ERR_NOT_RETAIL`) and an order not at `preparing` (`ERR_NOT_IN_PREPARING`).
- `collectPiece` stamps `collected_at/by`, advances that order via `performAdvance`, then closes the bin (`closed_at = now()`) if it has no live placements left.
- `releaseForOrder` deletes the placement and closes an emptied bin — called by revert and delete.
- Set key = `checkout_group_id ?? 'student:'+student_id`. **Set is `ready` when every live piece of the set has reached `preparing` or beyond** — placement is an address, not a gate, so an un-shelved piece does not block readiness (D4).

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend && node --test test/shelf.test.js
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/shelf.js backend/test/shelf.test.js
git commit -m "feat(shelf): core bin logic — sections, suggestion, place/collect/release"
```

---

## Task 3: Controller + routes

**Files:**
- Create: `backend/controllers/shelfController.js`
- Modify: `backend/routes/production.js`

**Interfaces:**
- Consumes: everything `lib/shelf.js` produces.
- Produces: 5 endpoints under `/api/production`.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/shelf` | — | `{data: Board}` |
| `POST` | `/shelf/place` | `{order_id, shelf_code?, slot_index?}` | `{data: {slot_code, over}}` |
| `POST` | `/shelf/collect` | `{order_id}` | `{data: {set_closed, advanced_ids}}` |
| `POST` | `/shelf/close-set` | `{set_key}` | `{data: {advanced_ids}}` |
| `DELETE` | `/shelf/placement/:orderId` | — | `{data: {released: true}}` |

`Board` shape:

```ts
{
  sections: Section[],
  shelves: [{ code, slots: [{ index, slot_code, section_id, piece_type, mode,
                              student_id, student_name, count, max, over,
                              state: 'empty'|'ready'|'waiting'|'over',
                              waiting_for: string[],      // e.g. ['وشاح — في التطريز']
                              oldest_placed_at, pieces: [{order_id, piece_type}] }] }],
  sets: [{ set_key, student_id, student_name, state: 'ready'|'waiting',
           pieces: [{order_id, piece_type, slot_code|null, collected, stage_ar}] }],
  inbox: [{ order_id, student_id, student_name, piece_type,
            suggestion: {shelf_code, slot_index, slot_code, over} | null }]
}
```

- [ ] **Step 1: Implement the controller** — thin wrappers that catch `ShelfError` and map to `{error, code}` with its `status`.

- [ ] **Step 2: Mount routes** in `backend/routes/production.js`, after the existing `router.use(authRequired, requireRole('admin','staff'))` line:

```js
// رف التجهيز — retail staging bins between الكوي and التجهيز.
// Permission (presser | preparer | manager | admin) is enforced inside the controller.
const shelfC = require('../controllers/shelfController');
router.get('/shelf', shelfC.getBoard);
router.post('/shelf/place', shelfC.place);
router.post('/shelf/collect', shelfC.collect);
router.post('/shelf/close-set', shelfC.closeSet);
router.delete('/shelf/placement/:orderId', shelfC.releasePlacement);
```

- [ ] **Step 3: Syntax check**

```bash
cd backend && node --check controllers/shelfController.js && node --check routes/production.js && node --check lib/shelf.js
```
Expected: no output (exit 0).

- [ ] **Step 4: Live HTTP smoke** — restart `node server.js`, mint a preparer token, `GET /api/production/shelf`.
Expected: 200 with `sections.length === 4` and `shelves.length === 3`.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/shelfController.js backend/routes/production.js
git commit -m "feat(shelf): board/place/collect/close-set/release endpoints"
```

---

## Task 4: Release bins on revert & delete

**Files:**
- Modify: `backend/controllers/productionController.js` (`revert`, `deleteOrder`)

**Why:** a piece reverted out of التجهيز leaves a phantom occupied خانة with nothing physically in it. This is the highest-value edge case in the spec (§10).

- [ ] **Step 1: Write the failing test** in `backend/test/shelf.test.js`: place a piece, revert its order, assert the placement is gone and the bin's `closed_at` is set.
- [ ] **Step 2: Run — expect FAIL** (placement survives).
- [ ] **Step 3:** In `revert`, inside the existing `tx` callback, call `await releaseForOrder(id, client)`. `deleteOrder` needs no change — `ON DELETE CASCADE` clears the placement — but must still close an emptied bin, so call `releaseForOrder` before the delete.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add backend/controllers/productionController.js backend/test/shelf.test.js
git commit -m "fix(shelf): release the bin when a piece reverts or is deleted"
```

---

## Task 5: Frontend API layer

**Files:**
- Create: `frontend/lib/shelf.ts`

**Interfaces:**
- Produces: `getShelfBoard()`, `placePiece(orderId, target?)`, `collectPiece(orderId)`, `closeSet(setKey)`, `releasePlacement(orderId)`, plus exported types `ShelfBoard`, `ShelfSlot`, `ShelfSet`, `ShelfInboxItem`, `ShelfSection` mirroring Task 3's shapes exactly.

Follow the existing `frontend/lib/staff.ts` pattern: `import { api } from "./api"`, return `res.data.data`.

- [ ] **Step 1:** Write the wrappers and types.
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit` → expect 0 source errors.
- [ ] **Step 3: Commit** `git add frontend/lib/shelf.ts`

---

## Task 6: The shelf console

**Files:**
- Create: `frontend/app/staff/shelf/page.tsx`, `frontend/components/staff/shelf/ShelfConsole.tsx`, `ShelfMap.tsx`, `PlaceSheet.tsx`
- Modify: `frontend/components/staff/StaffSidebar.tsx`

Three zones, no mode switch (spec §7):
1. **جاهز للتغليف** — `sets` with `state==='ready'`; big bin-code chips; tap chip = collect; «إغلاق الطرد» = close-set.
2. **وصلت توّا — سكّنها** — `inbox`; one-tap «ضعها في C04»; change opens `PlaceSheet`; dismiss leaves it «بلا خانة».
3. **الرف** — `ShelfMap`: 3 shelves at true proportions, colour by `state` (green ready · amber waiting · red over · grey empty), stacked spines rather than a digit, student-name search.

- [ ] **Step 1:** Build `PlaceSheet` first (shared by Task 7).
- [ ] **Step 2:** Build `ShelfMap`.
- [ ] **Step 3:** Build `ShelfConsole` with 15s `usePolling` + `useProductionEvents` refresh, and sessionStorage state-restore under key `loloshop-shelf-console` guarded by a `loadedOnce` flag (established StationConsole pattern — validation effects must not wipe restored state against the pre-fetch empty list).
- [ ] **Step 4:** Add the nav link. In `getNavLinks`, for `preparer` (and the manager/admin branch): `{ href: "/staff/shelf", label: "رف التجهيز", icon: iconClipboard(), prefix: true }`.
- [ ] **Step 5:** `npx tsc --noEmit` → 0 · `npm run lint` → 0 errors.
- [ ] **Step 6: Commit** the four frontend paths explicitly.

---

## Task 7: الكوي hand-off sheet

**Files:**
- Modify: `frontend/app/staff/page.tsx` (presser branch)

When a presser advances a piece (`pressing → preparing`), show `PlaceSheet` with the suggested bin: «ضعها في A03» / تغيير / تخطّي. Skipping leaves the piece un-shelved — it then appears in التجهيز's inbox (D6). The sheet must never block the advance: the advance already succeeded when the sheet opens.

Caps and شال never reach here (`needs_pressing = false`), which is exactly why Zone 2 exists.

- [ ] **Step 1:** Fetch the suggestion after a successful advance and render `PlaceSheet`.
- [ ] **Step 2:** `npx tsc --noEmit` → 0.
- [ ] **Step 3: Commit** `git add frontend/app/staff/page.tsx`

---

## Task 8: Editable config + shrink guard

**Files:**
- Modify: `backend/controllers/shelfController.js`, `backend/routes/production.js`
- Create: `frontend/app/admin/shelf/page.tsx`

- [ ] **Step 1: Write the failing test** — with a piece in `B12`, `PATCH` sash `slot_count` to 10 must be refused naming `B12`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3:** Add `PATCH /shelf/sections/:id` (`requireStaffType()` → manager + admin). Refuse shrinking below the highest **open** bin index with `ShelfError(409, 'ERR_SLOT_OCCUPIED', 'B12 مشغولة — فرّغها أولاً')`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5:** Admin card at `/admin/shelf` to edit `slot_count` / `max_per_slot` per section.
- [ ] **Step 6: Commit.**

---

## Task 9: Verify + hand to the owner

- [ ] **Step 1:** Full gates — `node --check` on every touched backend file · `node --test backend/test/shelf.test.js` · `npx tsc --noEmit` · `npm run lint`.
- [ ] **Step 2:** Live e2e on dev PG, self-cleaning: suggestion per mode · exclusive-bin rejection of a second student · over-stuff allowed in own bin · «بلا خانة» path · collect → advance → auto-close · revert releases bin · shrink guard · concurrent claim.
- [ ] **Step 3:** Start BE `:4000` + FE `:3000`; mint 7-day tokens for a **presser** and a **preparer**; open two browser windows, one per role.
- [ ] **Step 4:** Append click-steps to `TESTING-WALKTHROUGH.md` (untracked — never commit tokens).
- [ ] **Step 5:** Update `PROGRESS.md` and add a `HANDOFF.md` entry. **Do not push** — deploy is the owner's call, and a concurrent session shares this tree.

---

## Self-Review

**Spec coverage:** §3 shelf model → T1 · §4 data model → T1 · §5 placement/suggestion → T2 · §6 collection/auto-close → T2 · §7 screen → T6 · §8 API → T3 · §9 editing + shrink guard → T8 · §10 edge cases → T4 (revert/delete), T2 (concurrency, shared bin, wrong type) · §12 verification → T9. No gaps.

**Type consistency:** `Section`/`ShelfSection`, `slot_code`, `over`, `set_key`, `state` are used identically in T2 → T3 → T5 → T6. `releaseForOrder` and `suggestSlot` keep one name throughout.

**Known risk:** migration number 069 may be claimed by the concurrent session — Task 1 Step 1 checks before writing.
