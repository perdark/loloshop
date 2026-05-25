-- LoloShop — "image required FROM the customer" (e.g. sash type مثلث needs a reference photo).
-- Admin toggles this per option-group or per individual option. Additive.

ALTER TABLE option_groups ADD COLUMN IF NOT EXISTS requires_customer_image BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE options       ADD COLUMN IF NOT EXISTS requires_customer_image BOOLEAN NOT NULL DEFAULT FALSE;

-- store the customer's uploaded image against their chosen option
ALTER TABLE order_items   ADD COLUMN IF NOT EXISTS customer_image_url TEXT;
