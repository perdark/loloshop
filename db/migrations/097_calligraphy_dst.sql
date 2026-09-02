-- Migration 097 — «ملف التطريز» : the machine file that belongs to a plate.
--
-- WHY. A calligraphy plate is a PICTURE. The embroidery machine reads needle coordinates,
-- not pictures, and bridging the two by hand in Wilcom costs 15–20 minutes per name. Worse,
-- the resulting files were saved under whatever the operator typed on the machine keypad —
-- «44444441000.DST», «ggergergerg.EMB» — so nothing in the shop could answer «وين ملف
-- تطريز فلان؟» (measured on the shop's own «مفرد جاهز ٧» archive: 417 DST files, 412 with a
-- keypad name, zero carrying a student, an order or a date).
--
-- `backend/lib/digitize/` now produces that file from the plate automatically. These three
-- columns are where it lands, so the DST is born knowing whose it is.
--
-- ⚠️ `dst_stats` CARRIES `coverage`, AND THAT NUMBER IS THE SAFETY RAIL, NOT A STATISTIC.
-- It is the fraction of the artwork that actually received thread. An auto-digitised file
-- that misses part of a letter still opens, still previews, and still runs — the mistake is
-- only visible once it is stitched on a customer's sash. Any screen that offers the file
-- must show coverage beside it, and anything under ~0.95 means «open this one first».
-- Do not reduce this column to a boolean.
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS dst_path         TEXT;
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS dst_stats        JSONB;
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS dst_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN calligraphy_plates.dst_path IS
  'Public /uploads URL of the generated Tajima .DST for this plate, or NULL if never generated.';
COMMENT ON COLUMN calligraphy_plates.dst_stats IS
  'Digitiser report: stitches, jumps, coverage, spill, widthMm, heightMm, ms. coverage < 0.95 = review before stitching.';

-- The workbench lists «الجاهزة للتطريز» — a partial index keeps that lookup cheap without
-- indexing the ~1,900 rows that have no machine file.
CREATE INDEX IF NOT EXISTS idx_calligraphy_dst
    ON calligraphy_plates(job_id)
 WHERE dst_path IS NOT NULL;
