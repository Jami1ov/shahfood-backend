const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const genToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { phone, name, password } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefon raqam kerak' });

  const { data: existing } = await supabase
    .from('users').select('id').eq('phone', phone).single();
  if (existing) return res.status(400).json({ error: 'Bu raqam allaqachon ro\'yxatdan o\'tgan' });

  const { data: user, error } = await supabase
    .from('users')
    .insert({ phone, name: name || 'Foydalanuvchi', role: 'customer' })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Default manzil qo'shish
  await supabase.from('addresses').insert({
    user_id: user.id,
    label: 'Shahrisabz markazi',
    address: 'Shahrisabz, O\'zbekiston',
    lat: 39.0593,
    lon: 66.8487,
    is_active: true
  });

  res.json({ user, token: genToken(user.id) });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefon raqam kerak' });

  let { data: user } = await supabase
    .from('users').select('*').eq('phone', phone).single();

  // Yo'q bo'lsa, avtomatik yaratish (OTP tizimi o'rniga)
  if (!user) {
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ phone, name: 'Foydalanuvchi', role: 'customer' })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    user = newUser;
  }

  res.json({ user, token: genToken(user.id) });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').auth, async (req, res) => {
  const { data: addresses } = await supabase
    .from('addresses').select('*').eq('user_id', req.user.id);
  res.json({ ...req.user, addresses: addresses || [] });
});

// PUT /api/auth/profile
router.put('/profile', require('../middleware/auth').auth, async (req, res) => {
  const { name, phone } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (phone) updates.phone = phone;

  const { data, error } = await supabase
    .from('users').update(updates).eq('id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
