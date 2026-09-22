-- Additive upgrade: existing categories keep their creation-time order.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER;
