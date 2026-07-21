-- 070: رف التجهيز — per-student staging bins between الكوي and التجهيز.
--
-- WHY: pieces of one student's order do NOT finish together. Caps/robes/shawls are plain
-- and arrive at التجهيز early; the وشاح must pass التصميم → التطريز → الكوي and arrives last.
-- So robes and caps physically WAIT for the sash. This shelf is that waiting room.
--
-- Retail only (students.wholesaler_id IS NULL) — rep/دفعة pieces are handled بالجملة and
-- never get a bin. Config is per-SECTION so one shelf may mix modes: shelf C is 6 exclusive
-- cap bins + 1 SHARED شال bin. Spec: docs/superpowers/specs/2026-07-21-preparation-shelf-design.md

DO $$ BEGIN
  CREATE TYPE shelf_mode AS ENUM ('exclusive', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS shelf_sections (
  id           SERIAL PRIMARY KEY,
  shelf_code   TEXT       NOT NULL,
  piece_type   TEXT       NOT NULL,
  label_ar     TEXT       NOT NULL,
  slot_count   INT        NOT NULL CHECK (slot_count >= 0),
  max_per_slot INT,                      -- NULL = unlimited (shared bins)
  mode         shelf_mode NOT NULL DEFAULT 'exclusive',
  sort_order   INT        NOT NULL,
  UNIQUE (shelf_code, sort_order)
);

-- A bin = one OPEN occupancy row on a physical slot. Exclusive bins carry the one student
-- who owns them; shared bins carry NULL. Rows are NEVER deleted — they are stamped
-- closed_at when the bin frees, so collection history survives bin reuse.
CREATE TABLE IF NOT EXISTS shelf_slot_occupancy (
  id         SERIAL PRIMARY KEY,
  shelf_code TEXT NOT NULL,
  slot_index INT  NOT NULL,
  student_id UUID REFERENCES students(id),
  section_id INT  NOT NULL REFERENCES shelf_sections(id),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ
);

-- THE constraint: at most one OPEN bin per physical slot. This is what makes
-- "one student per خانة" a database rule instead of something the code must remember.
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

-- Seeded layout (owner-locked 2026-07-21). All four numbers are editable at runtime
-- via /admin/shelf or a single UPDATE — no code change, no deploy.
INSERT INTO shelf_sections (shelf_code, piece_type, label_ar, slot_count, max_per_slot, mode, sort_order)
VALUES
  ('A', 'robe',  'روب',   10, 10,   'exclusive', 1),
  ('B', 'sash',  'وشاح',  15, 10,   'exclusive', 1),
  ('C', 'cap',   'قبعة',   6,  4,   'exclusive', 1),
  ('C', 'shawl', 'شال',    1, NULL, 'shared',    2)
ON CONFLICT (shelf_code, sort_order) DO NOTHING;
