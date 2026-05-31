const router = require('express').Router();
const supabase = require('../config/supabase');
const { auth, adminOnly } = require('../middleware/auth');

// Barcha admin routlar himoyalangan
router.use(auth, adminOnly);

// ── GET /api/admin/stats ──────────────
router.get('/stats', async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    { count: totalOrders },
    { count: todayOrders },
    { data: revenueData },
    { data: activeOrders },
    { count: totalUsers },
    { count: totalRestaurants }
  ] = await Promise.all([
    supabase.from('orders').select('*', { count: 'exact', head: true }),
    supabase.from('orders').select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString()),
    supabase.from('orders').select('total, created_at'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).lt('stage', 3),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('restaurants').select('*', { count: 'exact', head: true })
  ]);

  const totalRevenue = revenueData?.reduce((s, o) => s + (o.total || 0), 0) || 0;
  const todayRevenue = revenueData?.filter(o => new Date(o.created_at) >= today)
    .reduce((s, o) => s + (o.total || 0), 0) || 0;

  res.json({
    totalOrders: totalOrders || 0,
    todayOrders: todayOrders || 0,
    totalRevenue,
    todayRevenue,
    activeOrders: activeOrders || 0,
    totalUsers: totalUsers || 0,
    totalRestaurants: totalRestaurants || 0
  });
});

// ── GET /api/admin/users (boyitilgan: buyurtma soni + sarflagan) ──────────────
router.get('/users', async (req, res) => {
  const { data: users } = await supabase
    .from('users')
    .select('id, name, phone, role, gender, bonus_points, created_at')
    .order('created_at', { ascending: false });

  const { data: orders } = await supabase.from('orders').select('user_id, total');
  const agg = {};
  (orders || []).forEach(o => {
    if (!o.user_id) return;
    if (!agg[o.user_id]) agg[o.user_id] = { count: 0, spent: 0 };
    agg[o.user_id].count++;
    agg[o.user_id].spent += o.total || 0;
  });

  res.json((users || []).map(u => ({
    ...u,
    order_count: agg[u.id]?.count || 0,
    total_spent: agg[u.id]?.spent || 0
  })));
});

// ── GET /api/admin/orders ──────────────
router.get('/orders', async (req, res) => {
  const { data } = await supabase
    .from('orders')
    .select('id, total, status, stage, payment_method, created_at, restaurants(name), users(name, phone)')
    .order('created_at', { ascending: false })
    .limit(100);
  res.json(data || []);
});

// ── Restoranlar boshqaruvi ──────────────
router.get('/restaurants', async (req, res) => {
  const { data } = await supabase.from('restaurants').select('*').order('id');
  res.json(data || []);
});

router.post('/restaurants', async (req, res) => {
  const { name, address, phone, lat, lon, emoji, category, delivery_fee, min_order } = req.body;
  if (!name || !address || lat == null || lon == null)
    return res.status(400).json({ error: 'Nom, manzil, lat va lon kerak' });

  const { data, error } = await supabase.from('restaurants').insert({
    name,
    address,
    phone: phone || null,
    lat: Number(lat),
    lon: Number(lon),
    emoji: emoji || '🍽️',
    category: category ? (Array.isArray(category) ? category : [category]) : null,
    delivery_fee: delivery_fee != null ? Number(delivery_fee) : 8000,
    min_order: min_order != null ? Number(min_order) : 20000,
    is_open: true
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.patch('/restaurants/:id', async (req, res) => {
  const allowed = ['name', 'address', 'phone', 'lat', 'lon', 'emoji', 'delivery_fee', 'min_order', 'is_open', 'rating', 'work_hours'];
  const updates = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];

  let { data, error } = await supabase
    .from('restaurants').update(updates).eq('id', req.params.id).select().single();
  if (error && /work_hours/i.test(error.message || '')) {
    delete updates.work_hours;
    ({ data, error } = await supabase
      .from('restaurants').update(updates).eq('id', req.params.id).select().single());
  }
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.patch('/restaurants/:id/toggle', async (req, res) => {
  const { data: r } = await supabase
    .from('restaurants').select('is_open').eq('id', req.params.id).single();
  const { data } = await supabase
    .from('restaurants').update({ is_open: !r?.is_open }).eq('id', req.params.id).select().single();
  res.json(data);
});

router.delete('/restaurants/:id', async (req, res) => {
  const { error } = await supabase.from('restaurants').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: 'O\'chirib bo\'lmadi (buyurtmalari bor bo\'lishi mumkin). O\'rniga yoping.' });
  res.json({ ok: true });
});

// ── Promo kodlar ──────────────
router.get('/promos', async (req, res) => {
  const { data } = await supabase
    .from('promo_codes').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

router.post('/promos', async (req, res) => {
  const { code, discount_percent, description, max_uses, expires_at } = req.body;
  if (!code || !discount_percent)
    return res.status(400).json({ error: 'Kod va chegirma kerak' });

  const { data, error } = await supabase
    .from('promo_codes')
    .insert({ code: code.toUpperCase(), discount_percent, description, max_uses, expires_at })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.patch('/promos/:id/toggle', async (req, res) => {
  const { data: promo } = await supabase
    .from('promo_codes').select('is_active').eq('id', req.params.id).single();
  const { data } = await supabase
    .from('promo_codes').update({ is_active: !promo.is_active })
    .eq('id', req.params.id).select().single();
  res.json(data);
});

module.exports = router;
