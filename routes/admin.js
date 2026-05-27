const router = require('express').Router();
const supabase = require('../config/supabase');
const { auth, adminOnly } = require('../middleware/auth');

// Barcha admin routlar himoyalangan
router.use(auth, adminOnly);

// GET /api/admin/stats
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
    supabase.from('orders').select('total'),
    supabase.from('orders').select('id, status, stage, created_at, total')
      .lt('stage', 3).order('created_at', { ascending: false }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('restaurants').select('*', { count: 'exact', head: true })
  ]);

  const totalRevenue = revenueData?.reduce((s, o) => s + o.total, 0) || 0;
  const todayRevenue = revenueData?.filter(o => new Date(o.created_at) >= today)
    .reduce((s, o) => s + o.total, 0) || 0;

  res.json({
    totalOrders, todayOrders,
    totalRevenue, todayRevenue,
    activeOrders: activeOrders?.length || 0,
    totalUsers, totalRestaurants
  });
});

// GET /api/admin/promos
router.get('/promos', async (req, res) => {
  const { data } = await supabase
    .from('promo_codes').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

// POST /api/admin/promos
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

// PATCH /api/admin/promos/:id/toggle
router.patch('/promos/:id/toggle', async (req, res) => {
  const { data: promo } = await supabase
    .from('promo_codes').select('is_active').eq('id', req.params.id).single();
  const { data } = await supabase
    .from('promo_codes').update({ is_active: !promo.is_active })
    .eq('id', req.params.id).select().single();
  res.json(data);
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const { data } = await supabase
    .from('users').select('id, name, phone, role, bonus_points, created_at')
    .order('created_at', { ascending: false });
  res.json(data || []);
});

module.exports = router;
