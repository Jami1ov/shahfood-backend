const router = require('express').Router();
const supabase = require('../config/supabase');
const { auth, adminOnly } = require('../middleware/auth');

const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1);
};

// GET /api/restaurants?lat=&lon=&category=&sort=distance
router.get('/', async (req, res) => {
  const { lat, lon, category, sort = 'distance', q } = req.query;

  let query = supabase.from('restaurants').select('*');
  if (q) query = query.ilike('name', `%${q}%`);

  const { data: restaurants, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  let result = restaurants.map(r => ({
    ...r,
    dist: lat && lon ? haversine(+lat, +lon, r.lat, r.lon) : null,
    estimated_minutes: lat && lon
      ? Math.round(10 + haversine(+lat, +lon, r.lat, r.lon) * 8)
      : r.delivery_fee > 7000 ? 35 : 25
  }));

  // Kategoriya filtri
  if (category && category !== 'all') {
    result = result.filter(r => r.category?.includes(category));
  }

  // Saralash
  if (sort === 'distance' && lat && lon) result.sort((a, b) => a.dist - b.dist);
  else if (sort === 'rating') result.sort((a, b) => b.rating - a.rating);
  else if (sort === 'fee') result.sort((a, b) => a.delivery_fee - b.delivery_fee);

  res.json(result);
});

// GET /api/restaurants/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('restaurants').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Topilmadi' });
  res.json(data);
});

// GET /api/restaurants/:id/menu
router.get('/:id/menu', async (req, res) => {
  const { data: categories } = await supabase
    .from('menu_categories')
    .select('*')
    .eq('restaurant_id', req.params.id)
    .order('sort_order');

  const { data: items } = await supabase
    .from('menu_items')
    .select('*')
    .eq('restaurant_id', req.params.id)
    .eq('is_available', true);

  const result = categories?.map(cat => ({
    ...cat,
    items: items?.filter(item => item.category_id === cat.id) || []
  }));

  res.json(result || []);
});

// GET /api/restaurants/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, users(name)')
    .eq('restaurant_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(20);
  res.json(data || []);
});

// ── ADMIN ──────────────────────────────────────

// POST /api/restaurants (admin)
router.post('/', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('restaurants').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PUT /api/restaurants/:id (admin)
router.put('/:id', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('restaurants').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PATCH /api/restaurants/:id/toggle (admin - ochiq/yopiq)
router.patch('/:id/toggle', auth, adminOnly, async (req, res) => {
  const { data: r } = await supabase
    .from('restaurants').select('is_open').eq('id', req.params.id).single();
  const { data, error } = await supabase
    .from('restaurants').update({ is_open: !r.is_open }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/restaurants/:id/menu (admin - menyu qo'shish)
router.post('/:id/menu', auth, adminOnly, async (req, res) => {
  const { category_name, name, description, price } = req.body;
  const restoId = +req.params.id;

  let { data: cat } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('restaurant_id', restoId)
    .eq('name', category_name)
    .single();

  if (!cat) {
    const { data: newCat } = await supabase
      .from('menu_categories')
      .insert({ restaurant_id: restoId, name: category_name })
      .select().single();
    cat = newCat;
  }

  const { data, error } = await supabase
    .from('menu_items')
    .insert({ restaurant_id: restoId, category_id: cat.id, name, description, price })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /api/restaurants/menu/:itemId (admin)
router.delete('/menu/:itemId', auth, adminOnly, async (req, res) => {
  await supabase.from('menu_items').delete().eq('id', req.params.itemId);
  res.json({ success: true });
});

module.exports = router;
