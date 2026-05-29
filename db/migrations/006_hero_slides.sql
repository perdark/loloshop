-- Hero slider — admin-managed cinematic slides on the student home page.
CREATE TABLE IF NOT EXISTS hero_slides (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url    TEXT NOT NULL,
  kicker_ar    TEXT,
  title_ar     TEXT NOT NULL,
  caption_ar   TEXT,
  accent       TEXT,
  cta_label_ar TEXT,
  cta_href     TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hero_slides_active_sort ON hero_slides (active, sort);
