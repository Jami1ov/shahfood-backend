const router = require('express').Router();
const supabase = require('../config/supabase');
const { auth, adminOnly } = require('../middleware/auth');

const STAGE_LABELS = ['Qabul qilindi', 'Tayyorlanmoqda', 'Kuryer yo\'lda', 'Yetkazildi'];

// Telegram bot xabarnoma (agar bot ulangan bo'lsa)
const notifyTelegram = async (chatId, message) => {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('Telegram xato:', e.message);
  }
};

// POST /api/orders — yangi buyurtma
router.post('/', auth, async (req, res) => {
  const {
    restaurant_id, items, subtotal, discount, delivery_fee,
    total, address, lat, lon, payment_method,
    promo_code, no_call, courier_note, estimated_minutes
  } = req.body;

  if (!items?.length) return res.status(400).json({ error: 'Buyurtma bo\'sh' });

  // Promo kodni tekshirish
  if (promo_code) {
    const { data: promo } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', promo_code)
      .eq('is_active', true)
      .single();
    if (!promo) return res.status(400).json({ error: 'Promo kod yaroqsiz' });
    if (promo.used_count >= promo.max_uses)
      return res.status(400).json({ error: 'Promo kod tugagan' });
    await supabase
      .from('promo_codes')
      .update({ used_count: promo.used_count + 1 })
      .eq('code', promo_code);
  }

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      user_id: req.user.id,
      restaurant_id, items, subtotal, discount,
      delivery_fee, total, address, lat, lon,
      payment_method: payment_method || 'cash',
      promo_code, no_call, courier_note,
      estimated_minutes: estimated_minutes || 30,
      stage: 0, status: STAGE_LABELS[0]
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Bonus ball qo'shish (har 100 so'mda 1 ball)
  const bonusEarned = Math.floor(subtotal / 100);
  await supabase.from('users')
    .update({ bonus_points: supabase.rpc('bonus_add', { amount: bonusEarned }) })
    .eq('id', req.user.id);

  // Restoran egasiga Telegram xabari
  const { data: resto } = await supabase
    .from('restaurants').select('name, owner_telegram_id').eq('id', restaurant_id).single();

  if (resto?.owner_telegram_id) {
    const itemsList = items.map(i => `• ${i.name} × ${i.qty}`).join('\n');
    await notifyTelegram(
      resto.owner_telegram_id,
      `🔔 <b>Yangi buyurtma #${order.id}!</b>\n\n${itemsList}\n\n💰 Jami: ${total.toLocaleString()} so'm\n📍 Manzil: ${address}\n💳 To'lov: ${payment_method}`
    );
  }

  res.json(order);
});

// GET /api/orders — foydalanuvchi buyurtmalari
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, restaurants(name, emoji, bg_gradient)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/orders/:id
router.get('/:id', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, restaurants(name, emoji, bg_gradient)')
    .eq('id', req.params.id)
    .single();
  if (error || (data.user_id !== req.user.id && req.user.role !== 'admin'))
    return res.status(404).json({ error: 'Topilmadi' });
  res.json(data);
});

// PATCH /api/orders/:id/stage — holat yangilash (admin/courier/restaurant_owner)
router.patch('/:id/stage', auth, async (req, res) => {
  if (!['admin', 'courier', 'restaurant_owner'].includes(req.user.role))
    return res.status(403).json({ error: 'Ruxsat yo\'q' });

  const newStage = req.body.stage;
  if (newStage < 0 || newStage > 3)
    return res.status(400).json({ error: 'Noto\'g\'ri holat' });

  // Restoran egasi faqat o'z restorani buyurtmalarini va faqat 0→1 qadamini o'zgartira oladi
  if (req.user.role === 'restaurant_owner') {
    const { data: ord } = await supabase
      .from('orders').select('restaurant_id, stage').eq('id', req.params.id).single();
    if (!ord) return res.status(404).json({ error: 'Buyurtma topilmadi' });
    const { data: resto } = await supabase
      .from('restaurants').select('owner_telegram_id').eq('id', ord.restaurant_id).single();
    if (!resto || resto.owner_telegram_id !== req.user.telegram_id)
      return res.status(403).json({ error: 'Bu buyurtma sizning restoraningizniki emas' });
    if (newStage > 2) return res.status(403).json({ error: 'Bu qadamni faqat kuryer yoki admin qila oladi' });
  }

  const { data: order, error } = await supabase
    .from('orders')
    .update({ stage: newStage, status: STAGE_LABELS[newStage], updated_at: new Date() })
    .eq('id', req.params.id)
    .select('*, users(name, telegram_id), restaurants(name, emoji)').single();

  if (error) return res.status(500).json({ error: error.message });

  // Mijozga Telegram xabari
  const stageEmojis = ['✅', '👨‍🍳', '🛵', '🎉'];
  const stageMsg = [
    'Buyurtmangiz qabul qilindi va restoran tasdiqlashini kutmoqda',
    'Buyurtmangiz tayyorlanmoqda',
    'Kuryer yo\'lga chiqdi',
    'Buyurtmangiz yetkazildi! Yoqimli ishtaha 🍽️'
  ];
  if (order.users?.telegram_id) {
    const msg = `${stageEmojis[newStage]} <b>Buyurtma #${order.id}</b>\n${order.restaurants?.emoji || '🍽️'} ${order.restaurants?.name || ''}\n\n${stageMsg[newStage]}`;
    await notifyTelegram(order.users.telegram_id, msg);
  }

  res.json(order);
});

// GET /api/orders/restaurant/mine — restoran egasining buyurtmalari
router.get('/restaurant/mine', auth, async (req, res) => {
  if (req.user.role !== 'restaurant_owner' && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Ruxsat yo\'q' });

  // Bu egaga tegishli restoranlarni topamiz
  const { data: myRestos } = await supabase
    .from('restaurants').select('id, name, emoji')
    .eq('owner_telegram_id', req.user.telegram_id);

  if (!myRestos?.length) return res.json({ restaurants: [], orders: [] });

  const restoIds = myRestos.map(r => r.id);
  const { data: orders } = await supabase
    .from('orders')
    .select('*, users(name, phone)')
    .in('restaurant_id', restoIds)
    .order('created_at', { ascending: false })
    .limit(100);

  res.json({ restaurants: myRestos, orders: orders || [] });
});

// POST /api/orders/:id/review — sharh
router.post('/:id/review', auth, async (req, res) => {
  const { restaurant_rating, courier_rating, tags, comment } = req.body;

  const { data: order } = await supabase
    .from('orders').select('*').eq('id', req.params.id).single();
  if (!order || order.user_id !== req.user.id)
    return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (order.stage !== 3)
    return res.status(400).json({ error: 'Faqat yetkazilgan buyurtmani baholash mumkin' });

  const { data: review, error } = await supabase
    .from('reviews')
    .insert({
      order_id: order.id,
      user_id: req.user.id,
      restaurant_id: order.restaurant_id,
      restaurant_rating, courier_rating, tags, comment
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Restoran reytingini yangilash
  const { data: allReviews } = await supabase
    .from('reviews')
    .select('restaurant_rating')
    .eq('restaurant_id', order.restaurant_id);

  const avg = allReviews.reduce((s, r) => s + r.restaurant_rating, 0) / allReviews.length;
  await supabase.from('restaurants').update({
    rating: +avg.toFixed(1),
    review_count: allReviews.length
  }).eq('id', order.restaurant_id);

  res.json(review);
});

// ── ADMIN ──────────────────────────────────────

// GET /api/orders/admin/all
router.get('/admin/all', auth, adminOnly, async (req, res) => {
  const { stage, restaurant_id } = req.query;
  let query = supabase
    .from('orders')
    .select('*, users(name, phone), restaurants(name)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (stage !== undefined) query = query.eq('stage', +stage);
  if (restaurant_id) query = query.eq('restaurant_id', +restaurant_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
