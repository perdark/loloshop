-- Migration 108 — الرف يصير مفتوح: ١٠ خانات لكل قسم، ٣٠ قطعة بالخانة، وكل الأقسام مشتركة.
--
-- Owner ask, 2026-09-06:
--   · «رف A بيه ١٠ خانات، أريد B و C بعد ١٠».
--   · «كل قسم بيه ٢٠، أريدها ٣٠ للكل».
--   · «خليهم بس يحطون القطع» — asked when told shelf C is two sections sharing one range.
--     That answer is what decides `mode`: the shelf should accept a piece, not argue about
--     whose خانة it is.
--
-- The «ملاحظة» half of the same conversation is migration 107 — a different subject, a
-- different table, and it was already written in an earlier session; do not fold them.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PART 2 — the shelf becomes uniform and communal.
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Before:  A روب 10 خانة / 10 لكل خانة exclusive · B وشاح 15 / 20 shared
--          C قبعة 6 / 4 exclusive · C شال 1 / بلا حد shared
-- After:   every section 10 خانة, 30 لكل خانة, mode = 'shared'.
--
-- ⚠️ THIS RETIRES «طالب واحد لكل خانة» (D2) COMPLETELY — it is no longer true of any section.
-- Migration 085 made only the وشاح communal and HANDOFF.md's landmine says the rule became
-- per-section; from here it is per-section in name only, because every section is shared.
-- `placePiece`'s `ERR_SLOT_TAKEN` («الخانة مشغولة بطالب آخر») can no longer fire for anything,
-- which is exactly the owner's «خليهم بس يحطون القطع». Two consequences that must survive any
-- future tidy-up, both already written down under the D2 landmine:
--   · A communal bin's student_id is NULL and MUST stay NULL. «وين روب فلان؟» is answered by
--     searching each PLACED PIECE's student name (ShelfMap.tsx), never the bin's owner. A
--     leftover owner on a 30-piece bin would claim one student owns all thirty.
--   · max_per_slot is a FLAG, not a cap. placePiece never refuses on count (D4); the number
--     only decides when the screen says «فوق الحد».
--
-- Guarded exactly the way 085 is, and for the same reason: db/schema.sql repeats this block
-- and scripts/deploy.sh applies schema.sql on EVERY deploy, so an unguarded UPDATE would
-- silently revert an admin's later edit through PATCH /production/shelf/sections/:id on the
-- next push. Each statement below matches only the state it is replacing.

-- 2a. Everything communal. mode has no admin UI (patchSection takes slot_count/max_per_slot
--     only), so `mode = 'exclusive'` is a safe one-way guard — after this runs there is
--     nothing left to match.
UPDATE shelf_sections SET mode = 'shared' WHERE mode = 'exclusive';

-- 2b. An exclusive bin that just became communal must lose its owner (the 085 pattern).
UPDATE shelf_slot_occupancy so SET student_id = NULL
 WHERE so.closed_at IS NULL AND so.student_id IS NOT NULL;

-- 2c. 30 per خانة. Guarded on the exact values being replaced (10 روب · 20 وشاح · 4 قبعة ·
--     NULL شال) so an admin who later types a different number keeps it across deploys. The
--     one number this cannot protect is a deliberate re-entry of an old value — typing 20 back
--     onto the وشاح would be reset to 30 by the next deploy. Narrow enough to accept; widen
--     the guard, do not drop it.
UPDATE shelf_sections
   SET max_per_slot = 30
 WHERE (piece_type = 'robe'  AND max_per_slot = 10)
    OR (piece_type = 'sash'  AND max_per_slot = 20)
    OR (piece_type = 'cap'   AND max_per_slot = 4)
    OR (piece_type = 'shawl' AND max_per_slot IS NULL);

-- 2d. Ten خانات per section, and the bins carried onto the new layout — ONE statement.
--
-- Two things have to happen together and in order, which is why this is a DO block rather
-- than two UPDATEs. Section ranges are DERIVED, never stored (loadSections walks slot_count
-- in sort_order), so the moment slot_count changes, every previous range is gone and there is
-- nothing left to map an existing bin FROM. The old ranges are read first, into locals.
--
-- What the two halves do:
--   · slot_count → 10, but NEVER below the highest bin that currently holds pieces.
--     `patchSection` refuses that shrink at runtime with ERR_SLOT_OCCUPIED; a migration has
--     nobody to refuse to, so it clamps. B وشاح is the only section that shrinks (15 → 10);
--     on the dev DB only B01/B02 are open, but prod is not this DB — a sash sitting in B13
--     keeps the section at 13 خانة and an admin can shrink it later from /admin/shelf.
--   · Growing قبعة 6 → 10 re-flows shelf C: شال slides from C07 to C11. An open شال bin left
--     behind at slot 7 would read as a قبعة bin — its section_id says شال while its slot_index
--     falls inside قبعة's range — and `placePiece` would refuse to add to it with
--     ERR_WRONG_SECTION. So every open bin is carried to the same POSITION inside its own new
--     section. The printed code on such a bin changes (C07 → C11); tell the worker before
--     they go looking for it. The dev DB has no C bins open at all — this exists for prod.
--
-- Sections are walked in DESCENDING sort_order so a section shifting UP never lands on a slot
-- its lower sibling has not vacated yet (shelf_slot_one_open is a unique index on
-- (shelf_code, slot_index) WHERE closed_at IS NULL — a transient collision would abort).
-- Idempotent: on a second run every section is already 10, so old_from = new_from and the
-- carry is a no-op.
DO $$
DECLARE
  sec        RECORD;
  new_from   INT;
  min_needed INT;
BEGIN
  -- Snapshot the CURRENT ranges before a single slot_count moves. After the first write the
  -- old layout is unrecoverable, so an open bin would have nothing to be mapped FROM.
  CREATE TEMP TABLE _shelf_reflow ON COMMIT DROP AS
  SELECT id, shelf_code, sort_order,
         COALESCE(SUM(slot_count) OVER (
           PARTITION BY shelf_code ORDER BY sort_order
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) + 1 AS old_from,
         COALESCE(SUM(slot_count) OVER (
           PARTITION BY shelf_code ORDER BY sort_order
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) + slot_count AS old_to
    FROM shelf_sections;

  -- Phase 1 — resize every section. Order is irrelevant here; nothing reads a range yet.
  FOR sec IN SELECT * FROM _shelf_reflow LOOP
    SELECT COALESCE(MAX(slot_index - sec.old_from + 1), 0) INTO min_needed
      FROM shelf_slot_occupancy
     WHERE shelf_code = sec.shelf_code AND closed_at IS NULL
       AND slot_index BETWEEN sec.old_from AND sec.old_to;

    UPDATE shelf_sections
       SET slot_count = GREATEST(10, min_needed)
     WHERE id = sec.id;
  END LOOP;

  -- Phase 2 — carry the open bins onto the new layout, HIGHEST section first so a section
  -- sliding up never lands on a slot its lower sibling has not vacated yet. (shelf_slot_one_open
  -- is a unique index on (shelf_code, slot_index) WHERE closed_at IS NULL, so a transient
  -- collision aborts the whole deploy.) Every slot_count is final by now, so new_from is real.
  FOR sec IN SELECT * FROM _shelf_reflow ORDER BY shelf_code, sort_order DESC LOOP
    SELECT COALESCE(SUM(slot_count), 0) + 1 INTO new_from
      FROM shelf_sections
     WHERE shelf_code = sec.shelf_code AND sort_order < sec.sort_order;

    IF new_from <> sec.old_from THEN
      UPDATE shelf_slot_occupancy
         SET slot_index = slot_index + (new_from - sec.old_from)
       WHERE shelf_code = sec.shelf_code AND closed_at IS NULL
         AND slot_index BETWEEN sec.old_from AND sec.old_to;
    END IF;
  END LOOP;

  DROP TABLE _shelf_reflow;
END $$;
