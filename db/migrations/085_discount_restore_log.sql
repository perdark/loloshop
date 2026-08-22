-- Migration 085 — an UNDO ledger for «إنهاء الخصومات» (ending a storefront discount round).
--
-- Ending a discount is the one catalogue edit that RAISES a live price, and it touches many
-- products in one press. There is no per-product history anywhere else in this schema — a
-- product's price is a single mutable column — so without this table the only record of what a
-- price was before the restore is `products.compare_at_price`, which the same operation clears.
-- That is the whole reason this exists: after the press, the old value must still be readable.
--
-- Every row is one price cell that was written (or would have been, see `applied`), so a
-- rollback is a plain UPDATE from `old_price` filtered on one `batch_id`. Nothing is deleted
-- and nothing here is ever read by the storefront.
--
-- `scope` is 'product' for products.base_price, or a price_role name ('retail' / 'wholesaler')
-- for the matching product_price_roles row — the two places an effective price can live
-- (see catalogController.buildShopFeed: COALESCE(ppr.base_price, p.base_price)).

CREATE TABLE IF NOT EXISTS discount_restore_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL,
  restored_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name  TEXT NOT NULL,
  scope         TEXT NOT NULL,
  old_price     BIGINT,
  new_price     BIGINT,
  old_compare_at_price BIGINT,
  note          TEXT
);

CREATE INDEX IF NOT EXISTS idx_discount_restore_batch ON discount_restore_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_discount_restore_at    ON discount_restore_log(restored_at DESC);
