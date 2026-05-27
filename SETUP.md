# ShahFood Backend — To'liq O'rnatish Qo'llanmasi

## Kerakli narsalar
- Node.js 18+ (nodejs.org)
- Git (git-scm.com)
- Supabase akkaunt (supabase.com — BEPUL)
- Telegram akkaunt (bot uchun)
- Railway yoki Render akkaunt (deploy uchun — BEPUL)

---

## 1-QADAM: Supabase sozlash

1. **supabase.com** ga kiring → "New Project" → "ShahFood"
2. **Region**: Singapore (O'zbekistonga eng yaqin)
3. Parol yozib qo'ying, keyin kerak bo'ladi
4. Yaratilgandan keyin: **SQL Editor** → yangi query
5. `supabase_schema.sql` faylidagi BARCHA kodni copy qiling
6. SQL Editor ga paste qilib **Run** bosing
7. **Settings → API** ga o'ting:
   - `URL` ni nusxa oling → `.env` ga `SUPABASE_URL` ga qo'ying
   - `service_role` key ni nusxa oling → `SUPABASE_SERVICE_KEY` ga qo'ying

---

## 2-QADAM: Telegram bot yaratish

1. Telegramda **@BotFather** ga yozing
2. `/newbot` yozing
3. Bot nomi: `ShahFood Shahrisabz`
4. Bot username: `shahfood_bot` (yoki boshqa bo'sh nom)
5. Olingan token ni `.env` ga `TELEGRAM_BOT_TOKEN` ga qo'ying

---

## 3-QADAM: Backend ishga tushirish (lokal)

```bash
# Papkaga kiring
cd shahfood-backend

# .env faylini yarating
cp .env.example .env
# .env faylini oching va Supabase/Telegram ma'lumotlarini kiriting

# JWT secret yaratish
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Natijani .env dagi JWT_SECRET ga qo'ying

# Ishga tushirish
npm install
npm run dev
```

Konsolda ko'rishingiz kerak:
```
🍽️  ShahFood Backend v1.0
Port: 3001
Supabase: ✅ ulangan
Telegram: ✅ ulangan
```

---

## 4-QADAM: Testlash

```bash
# Health check
curl http://localhost:3001/health

# Restoranlar ro'yxati
curl http://localhost:3001/api/restaurants

# Geolokatsiya bilan (Shahrisabz koordinatalari)
curl "http://localhost:3001/api/restaurants?lat=39.0593&lon=66.8487&sort=distance"

# Ro'yxatdan o'tish
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"+998901234567","name":"Abu Bakr"}'
```

---

## 5-QADAM: Internetga chiqarish (Railway)

1. **railway.app** ga kiring → GitHub bilan login
2. "New Project" → "Deploy from GitHub repo"
3. Reponi tanlang
4. **Variables** bo'limiga `.env` dagi barcha qiymatlarni kiriting
5. Deploy tugmachi → URL tayyor!

**MUHIM**: `FRONTEND_URL` ga saytingiz domenini qo'ying (masalan: `https://shahfood.vercel.app`)

---

## 6-QADAM: Frontendni backendga ulash

Hozirgi React faylida `API_URL` ni qo'shing:

```javascript
const API_URL = 'https://your-backend.railway.app'; // yoki localhost:3001

// Misol — restoranlarni olish
const fetchRestaurants = async (lat, lon) => {
  const res = await fetch(`${API_URL}/api/restaurants?lat=${lat}&lon=${lon}&sort=distance`);
  return res.json();
};

// Ro'yxatdan o'tish
const register = async (phone, name) => {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name })
  });
  const data = await res.json();
  localStorage.setItem('token', data.token); // tokenni saqlash
  return data;
};

// Buyurtma berish
const placeOrder = async (orderData) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_URL}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(orderData)
  });
  return res.json();
};
```

---

## API Endpointlar

| Method | URL | Tavsif |
|--------|-----|--------|
| POST | /api/auth/register | Ro'yxatdan o'tish |
| POST | /api/auth/login | Kirish |
| GET | /api/auth/me | Profil |
| GET | /api/restaurants | Barcha restoranlar |
| GET | /api/restaurants/:id/menu | Menyu |
| POST | /api/orders | Buyurtma berish |
| GET | /api/orders | O'z buyurtmalari |
| GET | /api/orders/:id | Bitta buyurtma |
| POST | /api/orders/:id/review | Baholash |
| POST | /api/promo/validate | Promo kod |
| GET | /api/admin/stats | Admin statistika |

---

## Restoran egasiga Telegram bot ulash

1. Restoran egasi botga /start yozadi
2. Siz admin paneldan `owner_telegram_id` ni o'rnataysiz:
   ```sql
   UPDATE restaurants SET owner_telegram_id = 123456789 WHERE id = 1;
   ```
3. Endi yangi buyurtma kelganda avtomatik xabar boradi!

---

## Keyingi qadamlar (kelajakda)

- [ ] SMS OTP (Eskiz.uz yoki Playmobile API)
- [ ] Payme to'lov integratsiyasi
- [ ] Click to'lov integratsiyasi
- [ ] Real-time buyurtma kuzatuv (Supabase Realtime)
- [ ] React Native mobile ilova
- [ ] Kuryer mobile app
