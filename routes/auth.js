const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { sendSMS } = require('../config/sms');

const BOT_USERNAME = process.env.BOT_USERNAME || 'dasturxon_app_bot';

const genToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });

// Telefon raqamini normallashtirish: 998901234567 ko'rinishida
const normPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('998')) return d;
  if (d.length === 9) return '998' + d;
  return d;
};

// Foydalanuvchining maxfiy maydonlarisiz nusxasi
const publicUser = (u) => ({
  id: u.id,
  phone: u.phone,
  name: u.name,
  role: u.role,
  bonus_points: u.bonus_points,
  is_verified: u.is_verified,
  has_password: !!u.password_hash
});

// Vaqtinchalik tasdiqlash kodlari (xotirada, 5 daqiqa)
const codes = {}; // { phone: { code, expires, tries } }
const CODE_TTL = 5 * 60 * 1000;

// ── POST /api/auth/send-code  { phone } ──────────────
// Tasdiqlash kodini Telegram (bepul) yoki SMS orqali yuboradi
router.post('/send-code', async (req, res) => {
  const phone = normPhone(req.body.phone);
  if (phone.length < 12) return res.status(400).json({ error: 'Telefon raqam noto\'g\'ri' });

  const { data: user } = await supabase
    .from('users').select('*').eq('phone', phone).single();

  const code = String(Math.floor(100000 + Math.random() * 900000));
  codes[phone] = { code, expires: Date.now() + CODE_TTL, tries: 0 };

  const text = `🔐 Dasturxon tasdiqlash kodi: ${code}\n\nKod 5 daqiqa amal qiladi. Hech kimga aytmang!`;

  // 1) Telegram orqali (bepul) — agar raqam bot bilan bog'langan bo'lsa
  const bot = req.app.get('bot');
  if (user?.telegram_id && bot) {
    try {
      await bot.sendMessage(user.telegram_id, text);
      return res.json({ sent: true, channel: 'telegram' });
    } catch (e) {
      console.error('Telegram kod yuborish xato:', e.message);
    }
  }

  // 2) SMS orqali (Eskiz) — agar sozlangan bo'lsa
  const smsOk = await sendSMS(phone, `Dasturxon tasdiqlash kodi: ${code}`);
  if (smsOk) return res.json({ sent: true, channel: 'sms' });

  // 3) Hech qaysi yo'l yo'q — avval botni ochish kerak
  return res.status(409).json({
    error: 'Kodni yuborib bo\'lmadi',
    need_telegram: true,
    bot_url: `https://t.me/${BOT_USERNAME}`,
    message: 'Kodni olish uchun avval Telegram botimizni oching va raqamingizni ulashing.'
  });
});

// ── POST /api/auth/verify-code  { phone, code, name? } ──────────────
// Kodni tekshiradi, foydalanuvchini yaratadi/tasdiqlaydi, token beradi
router.post('/verify-code', async (req, res) => {
  const phone = normPhone(req.body.phone);
  const { code, name } = req.body;
  const rec = codes[phone];

  if (!rec) return res.status(400).json({ error: 'Avval kod so\'rang' });
  if (Date.now() > rec.expires) { delete codes[phone]; return res.status(400).json({ error: 'Kod muddati o\'tdi' }); }
  if (rec.tries >= 5) { delete codes[phone]; return res.status(429).json({ error: 'Juda ko\'p urinish. Qaytadan kod so\'rang' }); }
  if (String(code).trim() !== rec.code) {
    rec.tries++;
    return res.status(400).json({ error: 'Kod noto\'g\'ri' });
  }

  delete codes[phone];

  let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();

  if (!user) {
    const { data: nu, error } = await supabase.from('users')
      .insert({ phone, name: name || 'Foydalanuvchi', role: 'customer', is_verified: true })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    user = nu;

    // Standart manzil
    await supabase.from('addresses').insert({
      user_id: user.id,
      label: 'Shahrisabz markazi',
      address: 'Shahrisabz, O\'zbekiston',
      lat: 39.0593, lon: 66.8487, is_active: true
    });
  } else if (!user.is_verified) {
    await supabase.from('users').update({ is_verified: true }).eq('id', user.id);
    user.is_verified = true;
  }

  res.json({
    user: publicUser(user),
    token: genToken(user.id),
    need_password: !user.password_hash
  });
});

// ── POST /api/auth/set-password  (auth) { password } ──────────────
router.post('/set-password', require('../middleware/auth').auth, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Parol kamida 4 ta belgi bo\'lishi kerak' });

  const hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from('users').update({ password_hash: hash }).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── POST /api/auth/login  { phone, password } ──────────────
router.post('/login', async (req, res) => {
  const phone = normPhone(req.body.phone);
  const { password } = req.body;

  const { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();

  // Parol o'rnatilmagan bo'lsa — kod orqali kirish kerak
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Parol o\'rnatilmagan. Kod orqali kiring.', need_code: true });
  }

  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Telefon yoki parol noto\'g\'ri' });

  res.json({ user: publicUser(user), token: genToken(user.id) });
});

// ── GET /api/auth/me ──────────────
router.get('/me', require('../middleware/auth').auth, async (req, res) => {
  const { data: addresses } = await supabase.from('addresses').select('*').eq('user_id', req.user.id);
  res.json({ ...publicUser(req.user), addresses: addresses || [] });
});

// ── PUT /api/auth/profile  (auth) { name } ──────────────
router.put('/profile', require('../middleware/auth').auth, async (req, res) => {
  const { name } = req.body;
  const updates = {};
  if (name) updates.name = name;

  const { data, error } = await supabase.from('users').update(updates).eq('id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(publicUser(data));
});

module.exports = router;
