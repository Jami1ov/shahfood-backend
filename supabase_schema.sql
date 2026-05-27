-- ============================================
-- ShahFood Database Schema for Supabase
-- supabase.com da SQL Editor ga paste qiling
-- ============================================

-- Foydalanuvchilar
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'customer' CHECK (role IN ('customer','admin','courier','restaurant_owner')),
  bonus_points INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Restoranlar
CREATE TABLE restaurants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  phone VARCHAR(20),
  lat DECIMAL(10,7) NOT NULL,
  lon DECIMAL(10,7) NOT NULL,
  category VARCHAR(50)[],
  emoji VARCHAR(10) DEFAULT '🍽️',
  badge VARCHAR(50),
  bg_gradient TEXT DEFAULT 'linear-gradient(145deg,#c27842,#e8a96a)',
  rating DECIMAL(2,1) DEFAULT 5.0,
  review_count INTEGER DEFAULT 0,
  delivery_fee INTEGER DEFAULT 8000,
  min_order INTEGER DEFAULT 20000,
  is_open BOOLEAN DEFAULT true,
  owner_telegram_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Menyu kategoriyalari
CREATE TABLE menu_categories (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Menyu mahsulotlari
CREATE TABLE menu_items (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manzillar
CREATE TABLE addresses (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(50) DEFAULT 'Uyim',
  address TEXT NOT NULL,
  lat DECIMAL(10,7),
  lon DECIMAL(10,7),
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Promo kodlar
CREATE TABLE promo_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(30) UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  description VARCHAR(100),
  max_uses INTEGER DEFAULT 100,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Buyurtmalar
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  restaurant_id INTEGER REFERENCES restaurants(id),
  items JSONB NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER DEFAULT 0,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  address TEXT NOT NULL,
  lat DECIMAL(10,7),
  lon DECIMAL(10,7),
  payment_method VARCHAR(20) DEFAULT 'cash' CHECK (payment_method IN ('cash','payme','click')),
  promo_code VARCHAR(30),
  no_call BOOLEAN DEFAULT false,
  courier_note TEXT,
  stage INTEGER DEFAULT 0 CHECK (stage BETWEEN 0 AND 3),
  status VARCHAR(50) DEFAULT 'Qabul qilindi',
  courier_id UUID REFERENCES users(id),
  estimated_minutes INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sharhlar
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  user_id UUID REFERENCES users(id),
  restaurant_id INTEGER REFERENCES restaurants(id),
  restaurant_rating INTEGER CHECK (restaurant_rating BETWEEN 1 AND 5),
  courier_rating INTEGER CHECK (courier_rating BETWEEN 1 AND 5),
  tags TEXT[],
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SAMPLE DATA — Shahrisabzdagi restoranlar
-- ============================================

INSERT INTO restaurants (name, address, phone, lat, lon, category, emoji, badge, bg_gradient, rating, review_count, delivery_fee, min_order, is_open) VALUES
('Shahrisabz Palace', 'Amir Temur ko''chasi, 12', '+998971112233', 39.0601, 66.8452, ARRAY['uzbek','wedding'], '🏛️', 'Mashhur', 'linear-gradient(145deg,#c27842,#e8a96a)', 4.8, 247, 8000, 30000, true),
('Temur Cafe', 'Mustaqillik ko''chasi, 7', '+998902223344', 39.0612, 66.8501, ARRAY['cafe','sweet'], '☕', 'Tez yetkazma', 'linear-gradient(145deg,#1a6080,#2ba0cc)', 4.5, 183, 6000, 20000, true),
('Oq Saroy', 'Navruz maydoni, 1', '+998913334455', 39.0578, 66.8471, ARRAY['uzbek','wedding'], '🕌', 'Premium', 'linear-gradient(145deg,#6a4f9e,#9a7fd4)', 4.7, 312, 10000, 50000, true),
('Pizza House', 'Yosh avlod ko''chasi, 15', '+998934445566', 39.0625, 66.8520, ARRAY['pizza','fastfood'], '🍕', 'Chegirmalar', 'linear-gradient(145deg,#c44000,#f07020)', 4.3, 156, 7000, 25000, true),
('Shakarchi', 'Ko''k gumbaz ko''chasi, 3', '+998945556677', 39.0590, 66.8510, ARRAY['sweet','icecream','cafe'], '🍰', 'Eng sevimli', 'linear-gradient(145deg,#b03070,#e060a0)', 4.6, 209, 5000, 15000, true),
('Choyxona Gavhar', 'Registon ko''chasi, 22', '+998996667788', 39.0570, 66.8460, ARRAY['uzbek','soup'], '🫖', 'Halol', 'linear-gradient(145deg,#0d7a5a,#1ab584)', 4.4, 128, 6000, 20000, false),
('Barbekyu King', 'Yangi hayot ko''chasi, 9', '+998907778899', 39.0640, 66.8530, ARRAY['bbq','fastfood'], '🔥', 'Kechgacha ochiq', 'linear-gradient(145deg,#2a1050,#8a1535)', 4.5, 174, 8000, 35000, true),
('Milliy Ta''m', 'Do''stlik ko''chasi, 18', '+998918889900', 39.0582, 66.8495, ARRAY['uzbek'], '🍲', 'Halol', 'linear-gradient(145deg,#2c3a9e,#5a6ee0)', 4.6, 261, 7000, 25000, true),
('Ice Dream', 'Bahor ko''chasi, 5', '+998939990011', 39.0608, 66.8476, ARRAY['icecream','sweet'], '🍦', 'Tez yetkazma', 'linear-gradient(145deg,#3a8ac4,#80c4f0)', 4.3, 97, 5000, 12000, true),
('Gulshan Oshxonasi', 'Ipak yo''li ko''chasi, 33', '+998970112233', 39.0595, 66.8465, ARRAY['uzbek','soup'], '🌸', 'Oilaviy', 'linear-gradient(145deg,#4a8a20,#80c040)', 4.7, 198, 6000, 20000, true),
('Mehnat Oshxona', 'Mehnat ko''chasi, 44', '+998901223344', 39.0560, 66.8490, ARRAY['uzbek','soup'], '🥘', 'Arzon', 'linear-gradient(145deg,#8a4020,#c07040)', 4.2, 89, 5000, 15000, true),
('Fast Burger', 'Sport ko''chasi, 6', '+998912334455', 39.0618, 66.8508, ARRAY['fastfood'], '🍔', 'Tezkor', 'linear-gradient(145deg,#c44000,#f07020)', 4.1, 142, 6000, 18000, true);

-- Shahrisabz Palace menyusi
INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES
(1,'Birinchi taom',1),(1,'Ikkinchi taom',2),(1,'Sho''rvalar',3),(1,'Salatlar',4),(1,'Non va garnir',5),(1,'Ichimliklar',6);

INSERT INTO menu_items (restaurant_id, category_id, name, description, price) VALUES
(1,1,'Manti (6 ta)','Qo''zilikli, qaymoq bilan',22000),
(1,1,'Somsa (2 ta)','Tandirda pishirilgan',10000),
(1,1,'Chuchvara','Qaymoq bilan',18000),
(1,2,'Osh (plov)','Qo''zilikli milliy plov',25000),
(1,2,'Shashlik (4 ta)','Qo''zi go''shtidan',32000),
(1,2,'Lag''mon','Qo''lda tortilgan',18000),
(1,2,'Dimlama','Sabzavotli go''sht',24000),
(1,3,'Mastava','An''anaviy guruchli',15000),
(1,3,'Sho''rva','Qo''zilikli',14000),
(1,4,'Achichuk','Pomidor, piyoz',10000),
(1,4,'Toshkent salati','Mol tili bilan',12000),
(1,5,'Tandir non (2 ta)','Yangi pishirilgan',6000),
(1,6,'Ko''k choy','An''anaviy',4000),
(1,6,'Kompot','Mevali',5000),
(1,6,'Cola (0.5l)','Sovuq',8000);

-- Temur Cafe menyusi
INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES
(2,'Kofe',1),(2,'Issiq ichimliklar',2),(2,'Non-pishiriqlar',3),(2,'Shirinliklar',4),(2,'Sovuq ichimliklar',5);

INSERT INTO menu_items (restaurant_id, category_id, name, description, price) VALUES
(2,7,'Espresso','Kuchli, aromatli',8000),
(2,7,'Cappuccino','Qaymoqli, issiq',12000),
(2,7,'Latte','Yumshoq ta''mli',13000),
(2,7,'Americano','Kuchli, suvli',9000),
(2,7,'Raf kofe','Qaymoqli, shirin',15000),
(2,8,'Choy (dastgoh)','Ko''k yoki qora',7000),
(2,8,'Salep','Issiq, foydali',10000),
(2,9,'Croissant','Yangi pishirilgan',9000),
(2,9,'Muffin','Shokoladli',8000),
(2,10,'Cheesecake','Klassik, qulupnaylik',22000),
(2,10,'Tiramisu','Italyan deserti',20000),
(2,11,'Smoothie','Mango, banan',14000),
(2,11,'Fresh juice','Limon, apelsin',12000);

-- Promo kodlar
INSERT INTO promo_codes (code, discount_percent, description, max_uses) VALUES
('SHAHFOOD10', 10, 'Birinchi buyurtmaga 10% chegirma', 500),
('YANGI50', 50, 'Yetkazma narxiga 50% chegirma', 100),
('BIRINCHI', 15, 'Yangi foydalanuvchiga 15% chegirma', 200);

-- ============================================
-- Row Level Security (RLS) - muhim!
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Foydalanuvchi faqat o'z ma'lumotlarini ko'ra oladi
CREATE POLICY "Users see own data" ON users FOR SELECT USING (auth.uid()::text = id::text);
CREATE POLICY "Users see own orders" ON orders FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY "Users manage own addresses" ON addresses FOR ALL USING (auth.uid()::text = user_id::text);

-- Restoranlar va menyu hammaga ochiq
CREATE POLICY "Restaurants are public" ON restaurants FOR SELECT USING (true);
CREATE POLICY "Menu items are public" ON menu_items FOR SELECT USING (true);
CREATE POLICY "Menu categories are public" ON menu_categories FOR SELECT USING (true);
