-- Migration 033: capture HOW an order was handed over when staff press «تأكيد التسليم».
-- Before this, ready→delivered recorded only delivered_at — so the shop could not tell
-- which delivered orders went out by توصيل (delivery, needs address+phone) vs استلام من المحل
-- (pickup), who actually received it, or which staff member confirmed it.
BEGIN;

-- 'delivery' = توصيل بعنوان ورقم · 'pickup' = استلام من المحل
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT
  CHECK (delivery_method IS NULL OR delivery_method IN ('delivery', 'pickup'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name   TEXT;  -- من استلم الطلب
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;  -- العنوان (للتوصيل)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_phone   TEXT;  -- رقم الهاتف (للتوصيل)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_notes   TEXT;  -- ملاحظة على التسليم
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_by     UUID REFERENCES users(id) ON DELETE SET NULL;

-- Fast lookup of the delivered list, newest first.
CREATE INDEX IF NOT EXISTS idx_orders_delivered ON orders(delivered_at DESC) WHERE status = 'delivered';

COMMIT;
