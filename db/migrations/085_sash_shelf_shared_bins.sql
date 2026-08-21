-- 085 — the وشاح shelf becomes COMMUNAL, 20 sashes to a خانة (owner 2026-08-21).
--
-- WHAT WAS WRONG. D2 of the shelf spec gives every student their own خانة, and `placePiece`
-- enforces it: a second student hitting an open exclusive bin gets «الخانة مشغولة بطالب آخر».
-- That is right for روب and قبعة — they are bulky, a خانة holds a handful, and «whose bin is
-- this» is the label a preparer wants. It is wrong for the وشاح.
--
-- Measured on PRODUCTION the day this was written:
--   · 47 sashes sitting at التجهيز, against 15 sash خانات.
--   · ZERO retail students owned more than one sash.
--   · Exactly 2 bins had ever been opened — B01 (طيبة محمد) and B02 (9m_so Marwa), one sash
--     each, i.e. two different students each burning a whole خانة.
-- So one-student-per-خانة capped the sash shelf at 15 students while 47 sashes needed an
-- address, and the natural move — stack the next sash in the same خانة — was refused. The
-- old `max_per_slot = 10` could never even be reached: it bounded ONE student's own pile.
--
-- WHAT CHANGES. `mode = 'shared'` (any student's sash may join a خانة) and
-- `max_per_slot = 20` (the real capacity of one physical sash خانة). No new enum value and no
-- schema change: 'shared' already existed for the شال bin. What is new is that lib/shelf.js's
-- `suggestSlot` now FILLS a communal bin to its max and then moves to the next one, instead of
-- always proposing the section's first bin. A communal section with NO max (شال, unchanged)
-- never reaches that test and stays the single bottomless bin it has always been.
--
-- روب (10) and قبعة (4) are deliberately untouched — they keep D2.
--
-- ⚠️ «وين وشاح فلان؟» is still answerable, and that is not an accident: the shelf map searches
-- each PLACED PIECE's student name (ShelfMap.tsx), never the bin's owner, so a communal bin
-- still lights up for the student you typed. The bin's own `student_id` is what stops being
-- meaningful — hence the third statement below.

-- 1. The section itself. Guarded on `mode` so re-running is a no-op and so a later runtime
--    edit through PATCH /production/shelf/sections/:id is not silently reverted.
UPDATE shelf_sections
   SET mode = 'shared', max_per_slot = 20
 WHERE piece_type = 'sash'
   AND mode = 'exclusive';

-- 2. Bins already open on the sash shelf carry an owner from the exclusive era. Ownership no
--    longer applies there, and a stale student_id would make the bin claim a single owner
--    while holding several students' sashes — a label that is worse than none. The pieces
--    keep their own student_id on shelf_placements, which is what every lookup actually reads.
UPDATE shelf_slot_occupancy so
   SET student_id = NULL
  FROM shelf_sections sec
 WHERE so.section_id = sec.id
   AND sec.piece_type = 'sash'
   AND so.closed_at IS NULL
   AND so.student_id IS NOT NULL;
