-- Dasturxon admin/restoran egasi/kuryer oqimi uchun qo'shimcha maydonlar.
-- Supabase SQL Editor'da bir marta ishga tushiriladi.

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS work_hours VARCHAR(80) DEFAULT '09:00 - 23:00';

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS gallery_images TEXT[] DEFAULT '{}';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS courier_telegram_id BIGINT,
  ADD COLUMN IF NOT EXISTS courier_picked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS courier_on_route_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_lat DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS delivery_lon DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS delivery_distance_m INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(4),
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_id BIGINT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS courier_lat DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS courier_lon DECIMAL(10,7);

CREATE INDEX IF NOT EXISTS idx_orders_courier_telegram_id ON orders(courier_telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_role_available ON users(role, is_available);
