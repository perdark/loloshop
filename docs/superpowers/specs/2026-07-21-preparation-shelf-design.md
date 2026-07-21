# رف التجهيز — Preparation Shelf (design spec)

**Date:** 2026-07-21
**Status:** design locked, not implemented
**Supersedes:** `design-mockups/preparation-shelf-prototype/index.html` (throwaway prototype — a generic 3×10 grid; see §1 for why it is not the design)

---

## 1. Problem & reframe

Pieces of one student's order **do not finish at the same time**. Measured on the live DB (2026-07-21):

| Piece | Path to التجهيز | Speed |
|---|---|---|
| قبعة | plain, `needs_pressing = false` → straight to التجهيز | arrives first |
| روب | plain, pressed → الكوي → التجهيز | arrives early |
| شال | plain, `needs_pressing = false` → straight to التجهيز | arrives early |
| وشاح | التصميم → التطريز → الكوي → التجهيز | **arrives last** |

353 retail pieces are still at التصميم and 79 at التطريز, while 205 retail pieces already sit at التجهيز. So a student's robe and cap physically wait — for days or weeks — for their sash to catch up.

**The shelf is therefore a waiting room for incomplete sets, not storage.**

The prototype mockup treats the grid as the hero and makes the worker toggle between تسكين and جمع modes. That answers "where is this piece" but not the question that actually costs money: **"whose set is complete right now so I can pack it and free the bins?"**

### The screen answers three questions, in priority order

| # | Question | Zone |
|---|---|---|
| 1 | من جاهز للتغليف الآن؟ | **جاهز للتغليف** (hero) |
| 2 | شنو وصل توّا ولازم أسكّنه؟ | **وصلت توّا** (inbox) |
| 3 | وين القطعة الفلانية؟ | **الرف** (map) |

All three are live simultaneously. **There is no mode switch** — placing and collecting are different taps, not different modes.

### The idea the mockup cannot have

Every waiting خانة shows **what it is waiting for and where that piece is right now**:

> «ينتظر: وشاح — في التطريز»

This turns dead storage into a live status board, and is the strongest justification for building this in-app rather than on paper.

---

## 2. Locked decisions (owner, 2026-07-21)

| # | Decision |
|---|---|
| D1 | Shelves are **retail-only**. ممثل/دفعة pieces never appear on this screen; they stay on the existing قائمة التجهيز. |
| D2 | **One student per خانة** for exclusive sections. A خانة is that student's bin for that piece type. |
| D3 | System **suggests** the خانة, worker **confirms**, worker **may change** it. |
| D4 | Overflow never blocks: a worker may **exceed a خانة's max** (renders over-capacity), or leave the piece **«بلا خانة»** — still fully packable. |
| D5 | خانات free **both** ways: tick pieces individually, and the set **auto-closes** when the last piece is ticked. |
| D6 | Caps skip الكوي structurally, so التجهيز shelves whatever الكوي cannot, via the **«وصلت توّا»** inbox. |
| D7 | شال takes **one خانة out of C's 7** (6 قبعة + 1 شال), as a **shared bin** — all students, no max — and **counts toward «set complete»**. |

---

## 3. Shelf model

| Shelf | Section | خانات | Max/خانة | Mode |
|---|---|---|---|---|
| **A** | روب | 10 | 10 | exclusive (one student) |
| **B** | وشاح | 15 | 10 | exclusive (one student) |
| **C** | قبعة — C01–C06 | 6 | 4 | exclusive (one student) |
| **C** | شال — C07 | 1 | ∞ | **shared** (all students) |

Config is **per-section, not per-shelf**: a shelf holds one or more ordered sections, each with its own piece type, slot count, max, and mode. `mode` is a real editable property, so شال is not a hardcoded special case — a shared bin can later be added to any shelf, or شال promoted to its own shelf D, as a config row rather than a code change.

**Slot codes** derive from `shelf_code` + running index across the shelf's sections in `sort_order`: shelf C yields `C01…C06` (قبعة) then `C07` (شال).

### Capacity reality (must not be glossed over)

Exclusive mode means concurrent *students*, not pieces: **10 robe-students · 15 sash-students · 6 cap-students**. Because a set holds its bins for the entire time it waits on the sash, bins turn over slowly. Against 59 retail caps currently at التجهيز, **shelf C is the tightest constraint in the system**. The «بلا خانة» list is therefore designed as a first-class surface, not an edge case, and is expected to carry real volume.

---

## 4. Data model — migration 069

> ⚠️ A concurrent session is active in this repo. Confirm `069` is still free before applying; renumber if taken.

```sql
CREATE TYPE shelf_mode AS ENUM ('exclusive', 'shared');

CREATE TABLE shelf_sections (
  id           SERIAL PRIMARY KEY,
  shelf_code   TEXT        NOT NULL,           -- 'A' | 'B' | 'C'
  piece_type   TEXT        NOT NULL,           -- 'robe' | 'sash' | 'cap' | 'shawl'
  label_ar     TEXT        NOT NULL,
  slot_count   INT         NOT NULL CHECK (slot_count  >= 0),
  max_per_slot INT,                            -- NULL = unlimited (shared bins)
  mode         shelf_mode  NOT NULL DEFAULT 'exclusive',
  sort_order   INT         NOT NULL,
  UNIQUE (shelf_code, sort_order)
);

CREATE TABLE shelf_slot_occupancy (
  id          SERIAL PRIMARY KEY,
  shelf_code  TEXT NOT NULL,
  slot_index  INT  NOT NULL,                   -- 1-based, across the whole shelf
  student_id  UUID REFERENCES students(id),    -- NULL for shared bins
  section_id  INT  NOT NULL REFERENCES shelf_sections(id),
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ                      -- set when the bin frees; row is never deleted
);

-- THE constraint: at most one OPEN bin per physical slot.
CREATE UNIQUE INDEX shelf_slot_one_open
  ON shelf_slot_occupancy (shelf_code, slot_index) WHERE closed_at IS NULL;

CREATE TABLE shelf_placements (
  order_id      UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  occupancy_id  INT  NOT NULL REFERENCES shelf_slot_occupancy(id),
  student_id    UUID NOT NULL REFERENCES students(id),
  placed_by     UUID REFERENCES users(id),
  placed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_by  UUID REFERENCES users(id),
  collected_at  TIMESTAMPTZ
);

CREATE INDEX shelf_placements_live ON shelf_placements (student_id)
  WHERE collected_at IS NULL;
CREATE INDEX shelf_placements_occupancy ON shelf_placements (occupancy_id);
```

### Why `shelf_slot_occupancy` exists

It makes **one-student-per-خانة a database constraint rather than a rule the code must remember**. An open occupancy row carries exactly one `student_id`, and every placement in that bin FKs to it — so a second student physically cannot be written into an exclusive bin. Shared bins (شال) carry `student_id = NULL` and are exempt by construction.

**Bins close, they never delete.** When the last live placement in a bin is collected, `closed_at` is stamped; the partial unique index then permits a new open bin at that slot. Deleting the row instead would cascade away the collected placements and **erase the collection history**, so the row is retained and `shelf_placements.occupancy_id` stays valid forever. Every bin that ever existed is auditable — who placed what, when, and who collected it.

**Shared bins:** the شال bin's occupancy row is created lazily on first placement with `student_id = NULL`, and closes like any other when emptied.

### Set identity

- **Bin ownership** is keyed on `student_id` (D2). If one student has two bundles each containing a robe, they correctly share one robe bin.
- **Set completeness** is keyed on `checkout_group_id` when present, else `student:<student_id>`. A set = every live (non-cancelled) piece of that group.

`orders` is **not** modified by this feature.

---

## 5. Placement

### Two doors

1. **الكوي** — on «إنهاء الكوي، نقل للتجهيز» the advance response carries a suggested خانة; a confirm sheet says «ضعها في A03». Confirm / change / dismiss.
2. **التجهيز** — anything reaching التجهيز un-shelved (every cap, every شال, plus any dismissed piece) appears in the **«وصلت توّا — سكّنها»** inbox with its own suggested خانة.

Dismissing is always allowed; the piece becomes «بلا خانة» and remains fully packable (D4).

### Suggestion algorithm

```
suggest(order):
  section = section_for(piece_type(order))
  if section.mode == 'shared':            return section's single slot
  if student already owns a live bin in section:
                                          return that bin        # may exceed max → over-capacity
  if a free slot exists in section:       return lowest free index
  else:                                   return null            # «بلا خانة»
```

Because a bin belongs to one student, **over-stuffing can only ever spill into that student's own bin** — never a stranger's. This is what makes D4's "allow over-stuff" safe rather than chaotic.

### Manual override

The worker may target any slot. Guards, all returning Arabic `ERR_*` errors:
- exclusive slot already owned by a **different** student → refused, naming the occupying student.
- slot index outside the section's range, or wrong piece type for the section → refused.
- exceeding `max_per_slot` **within the student's own bin** → allowed, flagged over-capacity.

Placement runs in a transaction with `SELECT … FOR UPDATE` on the occupancy row so two concurrent workers cannot claim the same bin.

---

## 6. Collection & closing

- Ticking a piece sets `collected_at`/`collected_by` and advances that piece `preparing → ready` through the **existing** `performAdvance` path — same transaction, audit rows, and notifications as every other stage transition. This feature introduces no parallel state machine.
- When the **last** live piece of a set is ticked, the set **auto-closes** (D5): remaining bins release — their occupancy rows are stamped `closed_at`, never deleted (§4).
- «إغلاق الطرد» performs the same thing in one tap for the whole set.
- Un-shelving / moving a piece is `DELETE` of its placement (bin releases if it was the last).

**Guard:** a set may only close when every piece in it — including شال (D7) — is ticked. Pieces still upstream (e.g. sash at التطريز) mean the set is *waiting*, never *ready*.

---

## 7. Screen

> The visual layer is specified as **intent and constraints**, not component code — a concurrent session is working on design, and this must compose with what they land rather than conflict with it.

**Route:** `/staff/shelf`, sidebar link «رف التجهيز» for `preparer` + `manager` + `admin`. The existing preparer queue is untouched (D1: reps still live there).

**Device:** iPad-first (staff device priority per CLAUDE.md), phone second, desktop scales up. Explicitly *not* the prototype's 330px desktop sidebar. RTL throughout, tap targets ≥44px.

### Zone 1 — جاهز للتغليف (hero)

Student cards whose every piece is shelved. Each card: student name (Amiri), and the bin codes as large pickup chips — `A03 · B07 · C07`. Tap a chip to tick that piece; last tick auto-closes. «إغلاق الطرد» closes the whole set.

### Zone 2 — وصلت توّا (inbox)

Un-shelved arrivals, each with its suggested خانة and a one-tap «ضعها في C04» confirm, plus change and dismiss.

### Zone 3 — الرف (map)

The three shelves at true proportions (10 / 15 / 6+1). Bin contents searchable by student name — this is how a شال is found among 69 in the shared bin.

**Colour encodes waiting-state, not occupancy** — this is the core visual decision:

| State | Meaning |
|---|---|
| green | set complete — collect it |
| amber | waiting on another piece (shows «ينتظر: وشاح — في التطريز») |
| red | over max |
| grey | empty |

Plus a quiet aging marker once a bin has been waiting a long time.

### Visual intent

- Brand tokens only — warm orange `#F47B42`/`#FFB100`, cream `#FAEBD7`, card `#FFF8F0`, ink `#1A1A1A`. The prototype invented a near-miss palette (`#c2410c`, `#faf4ea`); it is not the reference.
- The shelf should read as **physical furniture** — depth, inset bins, warm rails — not a flat dark grid.
- **Pieces render as stacked spines, not a digit.** A bin holding 4 robes shows 4 spines, so capacity is legible without reading numbers. This is the single largest legibility gain over the prototype.
- Amiri for student names, Cairo for UI.

**State restore:** sessionStorage key `loloshop-shelf-console`, following the established StationConsole pattern — restore scroll, filters, search, and open sheet, guarded by a `loadedOnce` flag so validation effects never wipe restored state against the pre-fetch empty list.

---

## 8. API

All under `/api/production`, `authRequired` + presser/preparer/manager/admin, retail-scoped server-side (D1).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/shelf` | Board: sections, occupancy, ready sets, inbox, waiting-for info |
| `POST` | `/shelf/place` | `{order_id, shelf_code?, slot_index?}` — omit target to accept the suggestion |
| `POST` | `/shelf/collect` | `{order_id}` — tick; auto-closes set if last |
| `POST` | `/shelf/close-set` | `{set_key}` — collect all remaining in one tap |
| `DELETE` | `/shelf/placement/:orderId` | Un-shelve / move |

Errors follow the repo convention: `{ error: <Arabic>, code: 'ERR_*' }`.

**Visibility:** the preparer already has front-desk visibility (contact + money), so this screen adds no new disclosure. The presser's confirm sheet shows only the suggested bin code and piece — no contact, no money — preserving the per-role minimal view.

---

## 9. Editing the numbers

All four numbers live in `shelf_sections` — **no code change, no deploy**. An admin card exposes shelf count, خانات per section, max per خانة, and mode. SQL fallback:

```sql
-- more cap bins
UPDATE shelf_sections SET slot_count = 8 WHERE shelf_code = 'C' AND piece_type = 'cap';
-- deeper sash bins
UPDATE shelf_sections SET max_per_slot = 12 WHERE piece_type = 'sash';
```

**Shrink guard:** reducing `slot_count` below the highest occupied index is refused with an Arabic error naming the blocking bin («B12 مشغولة — فرّغها أولاً»), so config edits can never orphan a shelved piece.

---

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Piece reverted out of التجهيز (`preparing → embroidery`) | Placement deleted, bin released. Revert path must call the release helper. |
| Piece cancelled / order deleted | `ON DELETE CASCADE` clears the placement; bin releases if last. |
| Student has 2 bundles with the same piece type | Same bin (bin is student-keyed); sets stay independently tracked by `checkout_group_id`. |
| Set with a piece still at التصميم | Set is *waiting*, never *ready*; bin shows «ينتظر». |
| Shared شال bin | `student_id IS NULL`; exempt from one-student and from max. |
| Rep student's piece | Never shelved, never shown (D1). |
| Two workers claim one bin | `FOR UPDATE` on the occupancy row serialises them; loser gets a named Arabic error. |

---

## 11. Out of scope

- Rep/دفعة pieces on the shelf (D1) — the schema does not preclude adding them later.
- Physical labels / barcode scanning.
- Cleanup of the stale التجهيز backlog — a separate data question.
- Shelf D for شال — reachable later as a config row, not a rewrite.

---

## 12. Verification

- Backend: `node --check` on touched files; controller e2e against the **laptop-local** dev PG (`:5433`) — self-cleaning, never prod.
- Cases: suggestion for each mode · exclusive-bin rejection of a second student · over-stuff allowed within own bin · «بلا خانة» path · tick → advance → auto-close · revert releases bin · shrink guard · concurrent claim.
- Frontend: `tsc` 0, `eslint` 0.
- Browser walkthrough by the owner (per standing instruction) — steps appended to `TESTING-WALKTHROUGH.md`.
- No `next build` locally unless disk allows; it runs on the server.

---

## 13. Coordination note

A second Claude session is working on design/frontend in this repo concurrently. Implementation should land **backend + migration first** (no overlap), and the frontend surface should be reconciled with that session's output before any commit. Commit **by explicit path only** — never `git add -A` — while both sessions are live.
