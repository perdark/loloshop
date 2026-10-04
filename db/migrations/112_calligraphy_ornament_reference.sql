-- 112: the calligraphy ornament dial + the student's photo as a style reference.
--
-- `ornament` is the level the understanding layer (backend/lib/calligraphyUnderstand.js) read
-- out of the student's own words — «بزخرفة قليلة» → light — or the designer chose: none · light
-- · medium · rich. NULL means the zone default, i.e. exactly what every plate before this
-- migration rendered, so nothing already in the table changes meaning and NO BACKFILL exists
-- (none is needed, and a one-time UPDATE copied into schema.sql is the 101 incident).
--
-- `ref_image_url` is the student's OWN uploaded photo, set only when they asked for «نفس الخط
-- الي بالصورة» AND lib/calligraphyPhoto.js judged the photo to be writing. A plate carrying one
-- is always generated alone (the reference belongs to one student), so the batcher keys sheets
-- on (variant, style, ornament) and never lets a reference plate join a sheet.
--
-- Both are plain nullable columns: re-running this file is a no-op, which is what db/schema.sql
-- (applied on every deploy) requires.
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS ornament TEXT;
ALTER TABLE calligraphy_plates ADD COLUMN IF NOT EXISTS ref_image_url TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calligraphy_plates_ornament_chk') THEN
    ALTER TABLE calligraphy_plates ADD CONSTRAINT calligraphy_plates_ornament_chk
      CHECK (ornament IS NULL OR ornament IN ('none', 'light', 'medium', 'rich'));
  END IF;
END $$;
