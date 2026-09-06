-- Migration 106 — «التجميع» (2026-09-06). For a ممثل SASH, التطريز produces two sub-pieces
-- (وشاح من الخلف, وشاح من الأمام) that برزان sews into one garment before الكوي. The stage sits
-- between embroidery and pressing FOR REP SASHES ONLY (productionController.nextStageFor /
-- isAssemblyPiece): a تجزئة piece, and a rep robe or cap, never enter it (owner 2026-09-06:
-- «just sashes for this stage, no cap and robe»). `assembler` (مجمّع) is the staff_type that
-- owns it — every line staff type may still see and move it (owner rule 2026-08-31).
--
-- ⚠️ This file carries ONLY the two enum values, on purpose (D10): `ALTER TYPE … ADD VALUE`
-- cannot be used as data inside the transaction that adds it, so any statement that USES
-- 'assembly' must live in a later migration or in application code. There is deliberately
-- no backfill (D9): pieces already on the line stay exactly where they are.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'assembly';
ALTER TYPE staff_type   ADD VALUE IF NOT EXISTS 'assembler';
