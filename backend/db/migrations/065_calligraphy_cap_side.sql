-- 065: calligraphy queue covers the cap SIDE zone («تطريز القبعة من الجانب») too.
-- Adds the enum value only — never used inside this migration, so it is safe to run
-- as its own file/transaction (PG allows ADD VALUE when the value isn't used yet).
ALTER TYPE calligraphy_variant ADD VALUE IF NOT EXISTS 'cap_side';
