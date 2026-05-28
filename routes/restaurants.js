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

// Foydalanuvchi shu restoranni tahrirlay oladimi (admin yoki shu restoran egasi)
const canEditRestaurant = async (user, restaurantId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'restaurant_owner') return false;
  const { data: r } = await supabase.from('restaurants')
    .select('owner_telegram_id').eq('id', restaurantId).single();
  return !!r && Number(r.owner_telegram_id) === Number(user.telegram_id);
};

// Base64 rasmni Supabase Storage'ga yuklash, public URL qaytarish
const uploadImage = async (base64Data, prefix = 'item') => {
  if (!base64Data) return null;
  // "data:image/jpeg;base64,XXXX" yoki to'g'ridan-to'g'ri base64
  const m = String(base64Data).match(/^data:(image\/[a-z]+);base64,(.+)$/);
  let mime = 'image/jpeg', raw = base64Data;
  if (m) { mime = m[1]; raw = m[2]; }
  const ext = mime.split('/')[1] || 'jpg';
  const buf = Buffer.from(raw, 'base64');
  const path = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;

  const { error } = await supabase.storage
    .from('menu-images')
    .upload(path, buf, { contentType: mime, upsert: false });
  if (error) throw new Error('Rasm yuklashda xato: ' + error.message);

  const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
  return data?.publicUrl || null;
};

// ── Ommaviy endpointlar ───────────────────────────────

// GET /api/restaurants
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

  if (category && category !== 'all') {
    result = result.filter(r => r.category?.includes(category));
  }

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
// Qaytadi: { categories: [...], items: [...] }
// Mehmonlar uchun faqat is_available=true, egalar uchun hammasi
router.get('/:id/menu', async (req, res) => {
  const restoId = req.params.id;
  let editorMode = false;

  // Agar Authorization header bo'lsa, foydalanuvchini tekshiramiz
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { data: user } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
      if (user) editorMode = await canEditRestaurant(user, restoId);
    } catch (e) {}
  }

  const { data: categories } = await supabase
    .from('menu_categories').select('*')
    .eq('restaurant_id', restoId).order('sort_order');

  let itemsQuery = supabase.from('menu_items').select('*').eq('restaurant_id', restoId);
  if (!editorMode) itemsQuery = itemsQuery.eq('is_available', true);
  const { data: items } = await itemsQuery;

  res.json({ categories: categories || [], items: items || [] });
});

// GET /api/restaurants/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  const { data } = await supabase
    .from('reviews').select('*, users(name)')
    .eq('restaurant_id', req.params.id)
    .order('created_at', { ascending: false }).limit(20);
  res.json(data || []);
});

// ── ADMIN: restoran yaratish/yangilash ──────────────────

router.post('/', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('restaurants').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('restaurants').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.patch('/:id/toggle', auth, adminOnly, async (req, res) => {
  const { data: r } = await supabase
    .from('restaurants').select('is_open').eq('id', req.params.id).single();
  const { data, error } = await supabase
    .from('restaurants').update({ is_open: !r.is_open }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── MENYU BOSHQARUVI (egasi yoki admin) ──────────────────

// POST /api/restaurants/:id/categories — yangi kategoriya
router.post('/:id/categories', auth, async (req, res) => {
  if (!(await canEditRestaurant(req.user, req.params.id)))
    return res.status(403).json({ error: 'Ruxsat yo\'q' });

  const { name, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom kerak' });

  // Eng katta sort_order ni topib, +1 qilamiz
  let order = sort_order;
  if (order == null) {
    const { data: maxRow } = await supabase
      .from('menu_categories').select('sort_order')
      .eq('restaurant_id', req.params.id)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    order = (maxRow?.sort_order || 0) + 1;
  }

  const { data, error } = await supabase
    .from('menu_categories')
    .insert({ restaurant_id: +req.params.id, name: name.trim(), sort_order: order })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PATCH /api/restaurants/menu/categories/:catId — kategoriyani tahrirlash
router.patch('/menu/categories/:catId', auth, async (req, res) => {
  const { data: cat } = await supabase
    .from('menu_categories').select('restaurant_id').eq('id', req.params.catId).single();
  if (!cat) return res.status(404).json({ error: 'Topilmadi' });
  if (!(await canEditRestaurant(req.user, cat.restaurant_id)))
    return res.status(403).json({ error: 'Ruxsat yo\'q' });

  const updates = {};
  if (req.body.name != null) updates.name = String(req.body.name).trim();
  if (req.body.sort_order != null) updates.sort_order = +req.body.sort_order;

  const { data, error } = await supabase
    .from('menu_categories').update(updates).eq('id', req.params.catId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /api/restaurants/menu/categories/:catId
router.delete('/menu/categories/:catId', auth, async (req, res) => {
  const { data: cat } = await supabase
    .from('menu_categories').select('restaurant_id').eq('id', req.params.catId).single();
  if (!cat) return res.status(404).json({ error: 'Topilmadi' });
  if (!(await canEditRestaurant(req.user, cat.restaurant_id)))
    return res.status(403).json({ error: 'Ruxsat yo\'q' });

  // Avval shu kategoriyadagi taomlarni o'chiramiz
  await supabase.from('menu_items').delete().eq('category_id', req.params.catId);
  const { error } = await supabase.from('menu_categories').delete().eq('id', req.params.catId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// POST /api/restaurants/:id/menu/items — yangi taom
router.post('/:id/menu/items', auth, async (req, res) => {
  if (!(await canEditRestaurant(req.user, req.params.id)))
    return res.status(403).json({ error: 'Ruxsat yo\'q' });

  const { category_id, name, description, price, image_base64, image_url } = req.body;
  if (!name?.trim() || !price || !category_id)
    return res.status(400).json({ error: 'Nom, narx va kategoriya kerak' });

  let finalImageUrl = image_url || null;
  if (image_base64) {
    try { finalImageUrl = await uploadImage(image_base64, 'item'); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

  const { data, error } = await supabase.from('menu_items').insert({
    restaurant_id: +req.params.id,
    category_id: +category_id,
    name: name.trim(),
    description: description?.trim() || null,
    price: +price,
    image_url: finalImageUrl,
    is_available: true
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PATCH /api/restaurants/menu/items/:itemId — taomni tahrirlash
router.patch('/menu/items/:itemId', auth, async (req, res) => {
  const { data: item } = await supabase
    .from('menu_items').select('restaurant_id').eq('id', req.params.itemId).single();
  if (!item) return res.status(404).json({ error: 'Topilmadi' });
  if (!(await canEditRestaurant(req.user, item.restaurant_id)))
    return res.status(403).json({ error: 'Ruxsat yo\'q' });

  const updates = {};
  if (req.body.name != null) updates.name = String(req.body.name).trim();
  if (req.body.description !== undefined) updates.description = req.body.description?.trim() || null;
  if (req.body.price != null) updates.price = +req.body.price;
  if (req.body.category_id != null) updates.category_id = +req.body.category_id;
  if (req.body.is_available != null) updates.is_available = !!req.body.is_available;
  if (req.body.image_url !== undefined) updates.image_url = req.body.image_url;

  if (req.body.image_base64) {
    try { updates.image_url = await uploadImage(req.body.image_base64, 'item'); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

  const { data, error } = await supabase
    .from('menu_items').update(updates).eq('id', req.params.itemId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /api/restaurants/menu/items/:itemId
router.delete('/menu/items/:itemId', auth, async (req, res) => {
  const { data: item } = await supabase
    .from('menu_items').select('restaurant_id').eq('id', req.params.itemId).single();
  if (!item) return res.status(404).json({ error: 'Topilmadi' });
  if (!(await canEditRestaurant(req.user, item.restaurant_id)))
    return res.status(403).json({ error: 'Ruxsat yo\'q' });

  const { error } = await supabase.from('menu_items').delete().eq('id', req.params.itemId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// ── Eski endpoint (orqaga moslik uchun) ──
router.post('/:id/menu', auth, adminOnly, async (req, res) => {
  const { category_name, name, description, price } = req.body;
  const restoId = +req.params.id;

  let { data: cat } = await supabase
    .from('menu_categories').select('id')
    .eq('restaurant_id', restoId).eq('name', category_name).single();
  if (!cat) {
    const { data: newCat } = await supabase
      .from('menu_categories').insert({ restaurant_id: restoId, name: category_name }).select().single();
    cat = newCat;
  }
  const { data, error } = await supabase
    .from('menu_items')
    .insert({ restaurant_id: restoId, category_id: cat.id, name, description, price })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/menu/:itemId', auth, adminOnly, async (req, res) => {
  await supabase.from('menu_items').delete().eq('id', req.params.itemId);
  res.json({ success: true });
});

module.exports = router;
