-- Migration 032: per-wholesaler «التسعيرة» (pricing) — replaces commission as the rep's
-- earning model. Two base prices for the طقم + editable per-rep surcharges (اضافات على السعر).
--
--   admin_price       = «سعر خاص بالمدير» — the admin's PRIVATE base price (the order's cost).
--   wholesaler_price  = «سعر الممثل والطلاب» — the base price reps & students see / pay.
--   pricing_addons    = surcharges added ONLY to the student-facing price:
--        royal_sash                  وشاح ملكي
--        royal_cap_when_normal_sash  وشاح عادي + قبعة ملكية
--        extra_cap_embroidery        تطريز القبعة الثاني (الأول مجاني)
--        robe_sleeve_each            تطريز ردن الروب (لكل ردن — حد أقصى ردنان)
--        american_shawl              شال امريكي
--
-- The rep's «المستحق» (earning) becomes the price gap = SUM(orders.profit) = price − cost,
-- so the legacy commission_rate column is kept (default 0) but no longer drives earnings.
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS admin_price      BIGINT NOT NULL DEFAULT 0 CHECK (admin_price >= 0);
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS wholesaler_price BIGINT NOT NULL DEFAULT 0 CHECK (wholesaler_price >= 0);
ALTER TABLE wholesalers ADD COLUMN IF NOT EXISTS pricing_addons   JSONB  NOT NULL DEFAULT
  '{"royal_sash":10000,"royal_cap_when_normal_sash":3000,"extra_cap_embroidery":3000,"robe_sleeve_each":5000,"american_shawl":25000}'::jsonb;
