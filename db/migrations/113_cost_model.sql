-- 113 — THE COST MODEL: what a piece costs to make, what the shop spends every month, and
-- what it loses. (2026-09-26, owner: «الداشبورد ما تنطي الارباح صح — ما دخلنا التكلفة والخسائر»)
--
-- Until this migration nothing in the database knew what anything COSTS. Every «ربح» on every
-- screen was built from `orders.price` and `orders.cost`, and `orders.cost` is not a production
-- cost at all: on a rep row it is حصة الإدارة, on a retail row it is NULL. Salaries, workshop
-- piece wages and AI spend were tracked in their own tables and subtracted from nothing.
--
-- Three tables, all edited by the admin at /admin/costs (add · edit · delete — owner's rule):
--   · cost_items          — the price list: «ستان الوشاح 3,000 د.ع للمتر».
--   · product_cost_lines  — the recipe: «الوشاح ياخذ 0.5 متر ستان». Per product TYPE, plus
--                           optional extras for ONE product (e.g. the lined robes' lining).
--                           MATERIALS ONLY — sewing wages come from workshop_production_entries
--                           and salaries from payroll; putting labour here counts it twice.
--   · shop_expenses       — monthly bills (rent, generator…), one-off spends, and losses.
--
-- ⚠️ THE SEEDS ARE ESTIMATES AND SAY SO (`confirmed = FALSE`). They are Baghdad market
-- guesses written for the owner to correct in one sitting with the admin — /admin/costs prints
-- «تقديري» until each row is confirmed.
--
-- ⚠️ THE SEED RUNS ONCE, EVER, AND THAT IS LOAD-BEARING. `db/schema.sql` repeats this file and
-- `scripts/deploy.sh` applies schema.sql on EVERY deploy. `ON CONFLICT DO NOTHING` would not be
-- enough: it stops duplicates, but a row the admin DELETED has no conflict left, so the next
-- deploy would quietly put it back. The guard is a marker row in site_settings instead — once
-- it exists the seed never runs again, whatever the admin has deleted since.

CREATE TABLE IF NOT EXISTS cost_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE,                         -- seed handle only; admin-added rows have none
  category    TEXT NOT NULL CHECK (category IN ('material','embroidery','press','packaging','operating','other')),
  name_ar     TEXT NOT NULL CHECK (length(btrim(name_ar)) > 0),
  unit_ar     TEXT NOT NULL DEFAULT 'قطعة',
  unit_cost   BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
  note_ar     TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS product_cost_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type  TEXT NOT NULL CHECK (product_type IN ('sash','robe','cap','shawl')),
  -- NULL = every product of this type. Set = an EXTRA for this one product, added on top.
  product_id    UUID REFERENCES products(id) ON DELETE CASCADE,
  -- 'rep' = pieces ordered through a ممثل (wholesaler_approval IS NOT NULL), same split as counts.js.
  audience      TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','retail','rep')),
  cost_item_id  UUID NOT NULL REFERENCES cost_items(id) ON DELETE CASCADE,
  qty           NUMERIC(10,3) NOT NULL CHECK (qty > 0),
  note_ar       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_cost_lines_type ON product_cost_lines(product_type, product_id);

CREATE TABLE IF NOT EXISTS shop_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- monthly: `amount` every month from starts_on's month through ends_on's month (open-ended if NULL)
  -- one_off / loss: `amount` once, on starts_on
  kind        TEXT NOT NULL CHECK (kind IN ('monthly','one_off','loss')),
  category    TEXT NOT NULL DEFAULT 'other',
  name_ar     TEXT NOT NULL CHECK (length(btrim(name_ar)) > 0),
  amount      BIGINT NOT NULL CHECK (amount >= 0),
  starts_on   DATE NOT NULL,
  ends_on     DATE,
  confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
  note_ar     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK (ends_on IS NULL OR (kind = 'monthly' AND ends_on >= starts_on))
);
CREATE INDEX IF NOT EXISTS idx_shop_expenses_kind ON shop_expenses(kind, starts_on);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM site_settings WHERE key = 'cost_model_seeded') THEN
    RETURN;
  END IF;

  INSERT INTO cost_items (code, category, name_ar, unit_ar, unit_cost, sort, note_ar) VALUES
    -- قماش ومواد
    ('sash_satin',      'material',   'ستان الوشاح',                    'متر',  3000, 10, 'عرض ١٥٠ سم تقريباً'),
    ('sash_interface',  'material',   'حشوة/فازلين لاصق للوشاح',         'متر',  1500, 20, NULL),
    ('robe_fabric',     'material',   'قماش الروب (كريب/جبردين)',        'متر',  3500, 30, NULL),
    ('robe_lining',     'material',   'بطانة الروب',                     'متر',  2000, 40, 'للروبات المبطنة فقط'),
    ('cap_body',        'material',   'جسم القبعة (كرتون مقوّى + قماش)', 'قطعة', 1500, 50, NULL),
    ('cap_tassel',      'material',   'شرّابة القبعة (الطرّة)',           'قطعة',  750, 60, NULL),
    ('trims',           'material',   'مطاط + كبسات + أزرار',            'قطعة',  250, 70, NULL),
    ('shawl_fabric',    'material',   'قماش الشال',                      'متر',  3000, 80, NULL),
    ('sew_thread',      'material',   'بكرة خيط خياطة',                  'بكرة', 1500, 90, 'بكرة ~٥٠٠٠ متر'),
    -- تطريز
    ('emb_thread',      'embroidery', 'خيط تطريز (كون)',                 'كون',  2500, 110, 'كون ~٥٠٠٠ متر؛ الوشاح ~٣٠-٤٠ ألف غرزة'),
    ('bobbin_thread',   'embroidery', 'خيط بوبين (سفلي)',                'بكرة',  250, 120, NULL),
    ('emb_backing',     'embroidery', 'فازلين تطريز (ظهر)',              'متر',  1000, 130, NULL),
    ('emb_needles',     'embroidery', 'إبر وصيانة ماكنة التطريز',         'قطعة',  150, 140, 'مستهلكات موزّعة على القطع'),
    -- كوي وتكبيس وطباعة
    ('press_power',     'press',      'كهرباء الكوي/التكبيس + بخار',      'قطعة',  100, 210, NULL),
    ('dtf_print',       'press',      'طباعة DTF/فلكس + كبس حراري',       'قطعة', 1000, 220, 'غير مربوطة بأي منتج — اربطها إذا تستخدمونها'),
    -- تغليف وبكجات
    ('poly_bag',        'packaging',  'كيس نايلون شفاف',                  'قطعة',  150, 310, NULL),
    ('garment_cover',   'packaging',  'كيس/غطاء الروب',                   'قطعة', 1000, 320, NULL),
    ('gift_bag',        'packaging',  'كيس/علبة هدية بالشعار',            'قطعة', 1500, 330, NULL),
    ('sticker_card',    'packaging',  'ستيكر + كرت شكر',                  'قطعة',  150, 340, NULL),
    ('tissue',          'packaging',  'ورق تغليف (مناديل)',               'قطعة',  100, 350, NULL);

  INSERT INTO product_cost_lines (product_type, cost_item_id, qty)
  SELECT v.t, ci.id, v.q
    FROM (VALUES
      ('sash','sash_satin',0.5), ('sash','sash_interface',0.5), ('sash','sew_thread',0.05),
      ('sash','emb_thread',0.08), ('sash','bobbin_thread',0.3), ('sash','emb_backing',0.3),
      ('sash','emb_needles',1), ('sash','press_power',1), ('sash','poly_bag',1),
      ('sash','gift_bag',1), ('sash','sticker_card',1), ('sash','tissue',1),
      ('robe','robe_fabric',3.2), ('robe','sew_thread',0.15), ('robe','trims',1),
      ('robe','press_power',1), ('robe','garment_cover',1), ('robe','sticker_card',1),
      ('cap','cap_body',1), ('cap','cap_tassel',1), ('cap','trims',1), ('cap','sew_thread',0.03),
      ('cap','emb_thread',0.02), ('cap','emb_needles',1), ('cap','poly_bag',1),
      ('shawl','shawl_fabric',1.2), ('shawl','sew_thread',0.03), ('shawl','press_power',1),
      ('shawl','poly_bag',1)
    ) AS v(t, code, q)
    JOIN cost_items ci ON ci.code = v.code;

  -- The lined robes («مبطن» in the name) carry lining on top of the type-wide recipe.
  INSERT INTO product_cost_lines (product_type, product_id, cost_item_id, qty)
  SELECT 'robe', p.id, ci.id, 2.5
    FROM products p JOIN cost_items ci ON ci.code = 'robe_lining'
   WHERE p.type = 'robe' AND p.name_ar LIKE '%مبطن%';

  INSERT INTO shop_expenses (kind, category, name_ar, amount, starts_on, note_ar) VALUES
    ('monthly', 'rent',        'إيجار المحل/الورشة',               1000000, DATE '2026-06-01', NULL),
    ('monthly', 'power',       'مولدة (اشتراك أمبيرات)',             250000, DATE '2026-06-01', NULL),
    ('monthly', 'power',       'كهرباء وطنية',                       100000, DATE '2026-06-01', NULL),
    ('monthly', 'internet',    'إنترنت',                              50000, DATE '2026-06-01', NULL),
    ('monthly', 'software',    'سيرفر + دومين + واتساب OTP',          60000, DATE '2026-06-01', 'الذكاء الاصطناعي محسوب لحاله من السجل'),
    ('monthly', 'marketing',   'إعلانات انستغرام',                   300000, DATE '2026-06-01', NULL),
    ('monthly', 'maintenance', 'صيانة المكائن',                      150000, DATE '2026-06-01', NULL),
    ('monthly', 'machines',    'اهتلاك مكائن التطريز',               240000, DATE '2026-06-01', 'ماكنة ~١٠ آلاف$ على ٥ سنين'),
    ('monthly', 'misc',        'ضيافة ونثريات',                      100000, DATE '2026-06-01', NULL);

  INSERT INTO site_settings (key, value)
  VALUES ('cost_settings', '{"usd_iqd": 1450, "unsalaried_day_rate": 16600}'::jsonb)
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO site_settings (key, value) VALUES ('cost_model_seeded', to_jsonb(now()::text));
END $$;
