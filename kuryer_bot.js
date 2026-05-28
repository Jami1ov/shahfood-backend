// Dasturxon — Kuryer boti (@dasturxon_kuryer_bot)
// Bo'lak: shahfood-backend/kuryer_bot.js
// Env: KURYER_BOT_TOKEN

const TelegramBot = require('node-telegram-bot-api');
const supabase = require('./config/supabase');

const STAGES = ['Qabul qilindi', 'Tayyorlanmoqda', 'Kuryer yo\'lda', 'Yetkazildi'];

const fmt = n => (n || 0).toLocaleString('uz-UZ') + " so'm";
const normPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('998') ? d : (d.length === 9 ? '998' + d : d); };

// Ikki nuqta orasidagi masofa (metr)
const distanceM = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const sessions = {};

const initKuryerBot = (app) => {
  if (!process.env.KURYER_BOT_TOKEN) {
    console.log('⚠️  KURYER_BOT_TOKEN yo\'q — kuryer bot o\'chirilgan');
    return;
  }

  const bot = new TelegramBot(process.env.KURYER_BOT_TOKEN, { polling: true });
  console.log('🛵 Kuryer bot ishga tushdi');

  // App'ga ulashamiz — boshqa joydan kuryerlarga xabar yuborish uchun
  if (app && typeof app.set === 'function') app.set('kuryerBot', bot);

  const getSession = (chatId) => {
    if (!sessions[chatId]) sessions[chatId] = { step: 'start' };
    return sessions[chatId];
  };

  // ── Asosiy menyu ──
  const mainMenu = (chatId, text, availability) => {
    const isAvail = availability !== undefined ? availability : false;
    bot.sendMessage(chatId, text, {
      reply_markup: {
        keyboard: [
          [{ text: isAvail ? '🟢 Bo\'shman (ish qabul qilaman)' : '🔴 Bandman (ish qabul qilmayman)' }],
          [{ text: '📦 Faol buyurtmalarim' }, { text: '👤 Profil' }],
          [{ text: '📊 Bugungi statistikam' }]
        ],
        resize_keyboard: true
      }
    });
  };

  // ── /start ──
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const sess = getSession(chatId);

    const { data: user } = await supabase.from('users')
      .select('*').eq('telegram_id', chatId).single();

    if (user && user.phone && !String(user.phone).startsWith('tg_')) {
      // Ro'yxatdan o'tgan, lekin kuryer roli yo'q bo'lsa — qo'shamiz
      if (user.role !== 'courier' && user.role !== 'admin') {
        await supabase.from('users').update({ role: 'courier' }).eq('id', user.id);
        bot.sendMessage(chatId, '✅ Siz endi kuryer sifatida ro\'yxatdan o\'tdingiz!');
      }
      sess.userId = user.id;
      sess.userName = user.name;
      sess.role = user.role === 'admin' ? 'admin' : 'courier';
      mainMenu(chatId, `Salom, ${user.name || 'kuryer'}! 🛵\nDasturxon — kuryer kabineti`, user.is_available);
      return;
    }

    sess.step = 'await_contact';
    bot.sendMessage(chatId,
      '🛵 Salom! Dasturxon kuryer botiga xush kelibsiz.\n\nIshlay boshlash uchun telefon raqamingizni ulashing 👇',
      {
        reply_markup: {
          keyboard: [[{ text: '📱 Raqamni ulashish', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      }
    );
  });

  // ── Asosiy xabar ishlovchisi ──
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const sess = getSession(chatId);
    const text = msg.text;

    // Kontakt — ro'yxatdan o'tish
    if (msg.contact) {
      const phone = normPhone(msg.contact.phone_number);
      const name = msg.from.first_name || 'Kuryer';
      let user;

      const { data: byPhone } = await supabase.from('users').select('*').eq('phone', phone).single();
      if (byPhone) {
        await supabase.from('users').update({ telegram_id: chatId, role: byPhone.role === 'admin' ? 'admin' : 'courier' }).eq('id', byPhone.id);
        user = byPhone;
      } else {
        const { data: nu } = await supabase.from('users')
          .insert({ phone, name, role: 'courier', telegram_id: chatId, is_verified: true })
          .select().single();
        user = nu;
      }

      sess.userId = user?.id;
      sess.userName = name;
      sess.role = user?.role === 'admin' ? 'admin' : 'courier';
      sess.step = 'main';

      const adminNote = sess.role === 'admin' ? '\n\n🔍 Siz super-admin sifatida kuzatuvchi rejimda kirdingiz.' : '';

      bot.sendMessage(chatId,
        `✅ Xush kelibsiz, ${name}!${adminNote}\n\nIshlay boshlash uchun "🟢 Bo'shman" tugmasini bosing.`,
        { reply_markup: { remove_keyboard: true } }
      );
      setTimeout(() => mainMenu(chatId, 'Asosiy menyu 👇', false), 500);
      return;
    }

    // Joriy joylashuv yuborildi
    if (msg.location) {
      // Yetkazib berishni tasdiqlashda
      if (sess.confirmingOrderId) {
        await confirmDelivery(chatId, sess, msg.location);
        return;
      }
      // Aks holda — joriy joyni saqlaymiz
      if (sess.userId) {
        await supabase.from('users').update({
          courier_lat: msg.location.latitude,
          courier_lon: msg.location.longitude
        }).eq('id', sess.userId);
      }
      bot.sendMessage(chatId, '📍 Joylashuv saqlandi.');
      return;
    }

    if (!text || !sess.userId) return;

    // Bo'shman/Bandman almashtirish
    if (text.startsWith('🟢 Bo\'shman') || text.startsWith('🔴 Bandman')) {
      const newAvail = text.startsWith('🟢');
      await supabase.from('users').update({ is_available: newAvail }).eq('id', sess.userId);
      mainMenu(chatId,
        newAvail
          ? '✅ Endi yangi buyurtmalar sizga e\'lon qilinadi.\n\nTayyor turing — buyurtma kelganda xabar beraman 🛵'
          : '🔴 Yangi buyurtmalar yuborilmaydi.',
        newAvail
      );
      return;
    }

    // Faol buyurtmalarim
    if (text === '📦 Faol buyurtmalarim') {
      const { data: orders } = await supabase
        .from('orders')
        .select('*, restaurants(name, emoji)')
        .eq('courier_telegram_id', chatId)
        .lt('stage', 3)
        .order('created_at', { ascending: false });

      if (!orders?.length) {
        bot.sendMessage(chatId, 'Hozircha faol buyurtmalaringiz yo\'q.');
        return;
      }
      for (const o of orders) {
        await sendOrderActions(chatId, o);
      }
      return;
    }

    // Profil
    if (text === '👤 Profil') {
      const { data: u } = await supabase.from('users').select('*').eq('id', sess.userId).single();
      const { count } = await supabase.from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('courier_telegram_id', chatId).eq('stage', 3);

      bot.sendMessage(chatId,
        `👤 <b>Profilingiz</b>\n\n` +
        `Ism: ${u?.name || '—'}\n` +
        `📱 Raqam: +${u?.phone || '—'}\n` +
        `🛵 Yetkazgan buyurtmalar: ${count || 0} ta\n` +
        `Holat: ${u?.is_available ? '🟢 Bo\'sh' : '🔴 Band'}`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Bugungi statistika
    if (text === '📊 Bugungi statistikam') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: todayOrders } = await supabase.from('orders')
        .select('total, delivery_fee, stage')
        .eq('courier_telegram_id', chatId)
        .gte('created_at', today.toISOString());

      const delivered = (todayOrders || []).filter(o => o.stage === 3);
      const fees = delivered.reduce((s, o) => s + (o.delivery_fee || 0), 0);

      bot.sendMessage(chatId,
        `📊 <b>Bugungi statistika</b>\n\n` +
        `📦 Bugun yetkazilgan: ${delivered.length} ta\n` +
        `💰 Yetkazma haqi (taxminiy): ${fmt(fees)}\n\n` +
        `<i>Haqiqiy maoshingiz Dasturxon tomonidan alohida hisoblanadi.</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Tasdiqlash kodi kiritish
    if (sess.awaitingCodeForOrder) {
      const code = String(text).replace(/\D/g, '').slice(0, 4);
      if (code.length !== 4) {
        bot.sendMessage(chatId, '⚠️ Kod 4 raqamdan iborat bo\'lishi kerak. Qaytadan kiriting:');
        return;
      }
      await verifyDeliveryCode(chatId, sess, code);
      return;
    }
  });

  // ── Inline tugmalar (callback) ──
  bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const sess = getSession(chatId);
    if (!sess.userId) {
      bot.answerCallbackQuery(q.id, { text: 'Avval /start bosing' });
      return;
    }

    const data = q.data || '';

    // Buyurtmani olish: take_<orderId>
    if (data.startsWith('take_')) {
      const orderId = parseInt(data.slice(5), 10);
      await takeOrder(chatId, sess, orderId, q);
      return;
    }

    // Yo'lga chiqdim: route_<orderId>
    if (data.startsWith('route_')) {
      const orderId = parseInt(data.slice(6), 10);
      await goOnRoute(chatId, sess, orderId, q);
      return;
    }

    // Yetkazdim: deliver_<orderId>
    if (data.startsWith('deliver_')) {
      const orderId = parseInt(data.slice(8), 10);
      await startDelivery(chatId, sess, orderId, q);
      return;
    }
  });

  // ─────────────────────────────────────────────
  // Funksiyalar
  // ─────────────────────────────────────────────

  // Buyurtmaning amaliyot tugmalarini chizish
  async function sendOrderActions(chatId, o) {
    const stage = o.stage;
    const restName = o.restaurants?.name || 'Restoran';
    const restEmoji = o.restaurants?.emoji || '🍽️';

    let stageLabel, buttons;
    if (stage === 2 && !o.courier_on_route_at) {
      stageLabel = '🛵 Yo\'lga chiqing';
      buttons = [[{ text: '🚗 Yo\'lga chiqdim', callback_data: `route_${o.id}` }]];
    } else if (stage === 2) {
      stageLabel = '🚗 Yo\'ldasiz';
      buttons = [[{ text: '🎉 Yetkazdim', callback_data: `deliver_${o.id}` }]];
    } else {
      stageLabel = STAGES[stage];
      buttons = [];
    }

    const itemsList = (o.items || []).map(i => `  • ${i.name} ×${i.qty}`).join('\n');

    await bot.sendMessage(chatId,
      `<b>${restEmoji} ${restName} — №${o.id}</b>\n` +
      `<i>${stageLabel}</i>\n\n` +
      `${itemsList}\n\n` +
      `💰 Jami: ${fmt(o.total)}\n` +
      `📍 Manzil: ${o.address}\n` +
      (o.courier_note ? `📝 Izoh: ${o.courier_note}\n` : '') +
      `📱 Mijoz: +${o.users?.phone || '—'} (${o.users?.name || ''})`,
      {
        parse_mode: 'HTML',
        reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined
      }
    );

    // Manzilni xaritada yuborish
    if (o.lat && o.lon) {
      await bot.sendLocation(chatId, o.lat, o.lon);
    }
  }

  // ── Kuryer buyurtmani oladi ──
  async function takeOrder(chatId, sess, orderId, q) {
    if (sess.role === 'admin') {
      bot.answerCallbackQuery(q.id, { text: 'Siz kuzatuvchisiz — qabul qilolmaysiz' });
      return;
    }

    const { data: order } = await supabase
      .from('orders').select('*, restaurants(name, emoji), users(name, phone, telegram_id)')
      .eq('id', orderId).single();

    if (!order) {
      bot.answerCallbackQuery(q.id, { text: 'Buyurtma topilmadi' });
      return;
    }

    if (order.courier_telegram_id) {
      bot.answerCallbackQuery(q.id, { text: 'Bu buyurtma allaqachon olingan' });
      try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id });
        await bot.editMessageText(q.message.text + '\n\n⚠️ Boshqa kuryer oldi', { chat_id: chatId, message_id: q.message.message_id });
      } catch (e) {}
      return;
    }

    if (order.stage !== 2) {
      bot.answerCallbackQuery(q.id, { text: 'Bu buyurtma hozir kuryer kutmayapti' });
      return;
    }

    // Buyurtmani biriktirish
    await supabase.from('orders').update({
      courier_telegram_id: chatId,
      courier_picked_at: new Date().toISOString()
    }).eq('id', orderId);

    bot.answerCallbackQuery(q.id, { text: '✅ Sizga biriktirildi!' });

    // E'londagi xabarni yangilaymiz
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id });
      await bot.editMessageText(q.message.text + '\n\n✅ <b>Sizga biriktirildi</b>', { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML' });
    } catch (e) {}

    // Keyingi qadam tugmalari
    await sendOrderActions(chatId, { ...order, stage: 2 });

    // Mijozga xabar
    const { data: cur } = await supabase.from('users').select('name, phone').eq('id', sess.userId).single();
    if (order.users?.telegram_id) {
      await sendToMijoz(app, order.users.telegram_id,
        `🛵 <b>Kuryer biriktirildi!</b>\n\n` +
        `👤 ${cur?.name || 'Kuryer'}\n` +
        `📱 +${cur?.phone || '—'}\n\n` +
        `Buyurtmangiz tez orada yo'lga chiqadi.`
      );
    }

    // Restoran egasiga xabar
    if (order.restaurants) {
      const { data: resto } = await supabase
        .from('restaurants').select('owner_telegram_id').eq('id', order.restaurant_id).single();
      if (resto?.owner_telegram_id) {
        await sendToMijoz(app, resto.owner_telegram_id,
          `🛵 #${orderId} buyurtmani <b>${cur?.name || 'kuryer'}</b> (+${cur?.phone}) oldi.`
        );
      }
    }

    // Boshqa kuryerlardan e'lonni o'chiramiz
    const broadcasts = global._kuryerBroadcasts?.[orderId] || [];
    for (const { chatId: otherChatId, messageId } of broadcasts) {
      if (otherChatId === chatId) continue;
      try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: otherChatId, message_id: messageId });
        await bot.editMessageText(`⚠️ <b>Buyurtma #${orderId}</b>\n\nBoshqa kuryer oldi.`, { chat_id: otherChatId, message_id: messageId, parse_mode: 'HTML' });
      } catch (e) {}
    }
    if (global._kuryerBroadcasts) delete global._kuryerBroadcasts[orderId];
  }

  // ── Yo'lga chiqdim ──
  async function goOnRoute(chatId, sess, orderId, q) {
    if (sess.role === 'admin') {
      bot.answerCallbackQuery(q.id, { text: 'Siz kuzatuvchisiz' });
      return;
    }
    const { data: order } = await supabase
      .from('orders').select('*, restaurants(name, emoji), users(telegram_id, name, phone)')
      .eq('id', orderId).single();

    if (!order || order.courier_telegram_id !== chatId) {
      bot.answerCallbackQuery(q.id, { text: 'Bu sizning buyurtmangiz emas' });
      return;
    }

    await supabase.from('orders').update({
      courier_on_route_at: new Date().toISOString()
    }).eq('id', orderId);

    bot.answerCallbackQuery(q.id, { text: '🚗 Yo\'lga chiqdingiz' });
    try {
      await bot.editMessageReplyMarkup({
        inline_keyboard: [[{ text: '🎉 Yetkazdim', callback_data: `deliver_${orderId}` }]]
      }, { chat_id: chatId, message_id: q.message.message_id });
    } catch (e) {}

    // Mijozga
    if (order.users?.telegram_id) {
      await sendToMijoz(app, order.users.telegram_id,
        `🚗 <b>Kuryer yo'lda!</b>\n\nBuyurtma #${orderId} yo'lga chiqdi.`
      );
    }
  }

  // ── Yetkazdim — birinchi qadam: GPS so'raymiz ──
  async function startDelivery(chatId, sess, orderId, q) {
    if (sess.role === 'admin') {
      bot.answerCallbackQuery(q.id, { text: 'Siz kuzatuvchisiz' });
      return;
    }
    const { data: order } = await supabase
      .from('orders').select('*').eq('id', orderId).single();
    if (!order || order.courier_telegram_id !== chatId) {
      bot.answerCallbackQuery(q.id, { text: 'Bu sizning buyurtmangiz emas' });
      return;
    }

    bot.answerCallbackQuery(q.id);
    sess.confirmingOrderId = orderId;

    bot.sendMessage(chatId,
      `📍 <b>Yetkazishni tasdiqlash — #${orderId}</b>\n\n` +
      `1️⃣ Joriy joylashuvingizni yuboring (tugma bilan)\n` +
      `2️⃣ Keyin mijozdan 4 xonali tasdiqlash kodini so'rang va yozing\n\n` +
      `Bu ikkalasi yetkazganingizning isboti uchun kerak.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '📍 Joriy joylashuv', request_location: true }],
            [{ text: '❌ Bekor qilish' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      }
    );
  }

  // ── GPS tekshirish ──
  async function confirmDelivery(chatId, sess, location) {
    const orderId = sess.confirmingOrderId;
    const { data: order } = await supabase
      .from('orders').select('*, users(telegram_id, name)').eq('id', orderId).single();

    if (!order || order.courier_telegram_id !== chatId) {
      bot.sendMessage(chatId, '⚠️ Buyurtma topilmadi');
      sess.confirmingOrderId = null;
      return;
    }

    const dist = distanceM(location.latitude, location.longitude, order.lat, order.lon);

    if (dist > 300) {
      bot.sendMessage(chatId,
        `⚠️ <b>Manzilga juda uzoqsiz!</b>\n\n` +
        `Sizning joylashuvingiz mijoz manzilidan <b>${dist} metr</b> uzoq.\n` +
        `Yaqinroq boring (200 metr ichida) va qaytadan urinib ko'ring.\n\n` +
        `Agar mijoz manzili noto'g'ri ko'rsatilgan bo'lsa, super-admin bilan bog'laning.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // GPS o'tdi — endi kod so'raymiz
    await supabase.from('orders').update({
      delivery_lat: location.latitude,
      delivery_lon: location.longitude,
      delivery_distance_m: dist
    }).eq('id', orderId);

    sess.awaitingCodeForOrder = orderId;
    sess.confirmingOrderId = null;

    bot.sendMessage(chatId,
      `✅ GPS tasdiqlandi (${dist}m masofada).\n\n` +
      `Endi <b>mijozdan 4 xonali kodni so'rang</b> va shu yerga yozing.\n\n` +
      `<i>Kod mijozning botida ko'rinadi.</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: { keyboard: [[{ text: '❌ Bekor qilish' }]], resize_keyboard: true }
      }
    );
  }

  // ── Kodni tekshirish ──
  async function verifyDeliveryCode(chatId, sess, code) {
    const orderId = sess.awaitingCodeForOrder;
    const { data: order } = await supabase
      .from('orders').select('*, restaurants(name, emoji), users(telegram_id, name)').eq('id', orderId).single();

    if (!order || order.courier_telegram_id !== chatId) {
      bot.sendMessage(chatId, '⚠️ Buyurtma topilmadi');
      sess.awaitingCodeForOrder = null;
      return;
    }

    if (code !== order.delivery_code) {
      bot.sendMessage(chatId,
        `❌ Kod noto'g'ri. Mijozdan yana so'rang.\n\n` +
        `<i>Agar mijoz kodni topa olmasa, super-admin bilan bog'laning.</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Hammasi to'g'ri — yetkazildi!
    await supabase.from('orders').update({
      stage: 3,
      status: 'Yetkazildi',
      delivered_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', orderId);

    sess.awaitingCodeForOrder = null;

    bot.sendMessage(chatId,
      `🎉 <b>Tabriklayman, buyurtma yetkazildi!</b>\n\n` +
      `Buyurtma #${orderId} muvaffaqiyatli yopildi.\n` +
      `Yangi buyurtma kelganda yana xabar beraman.`,
      { parse_mode: 'HTML' }
    );
    mainMenu(chatId, 'Asosiy menyu 👇', true);

    // Mijozga xabar — bahalash so'raymiz
    if (order.users?.telegram_id) {
      await sendToMijoz(app, order.users.telegram_id,
        `🎉 <b>Buyurtma yetkazildi!</b>\n\n` +
        `Buyurtma #${orderId} — ${order.restaurants?.emoji || '🍽️'} ${order.restaurants?.name}\n\n` +
        `Yoqimli ishtaha! 🍽️\n\n` +
        `Iltimos, xizmatimizni baholang (saytda yoki keyinroq).`
      );
    }

    // Restoran egasiga xabar
    const { data: resto } = await supabase
      .from('restaurants').select('owner_telegram_id, name').eq('id', order.restaurant_id).single();
    if (resto?.owner_telegram_id) {
      await sendToMijoz(app, resto.owner_telegram_id,
        `🎉 #${orderId} buyurtmasi yetkazildi.`
      );
    }
  }
};

// ── Boshqa modullardan kuryer botiga xabar yuborish uchun yordamchi ──
// Asosiy bot (mijoz boti) orqali mijozga xabar
async function sendToMijoz(app, chatId, text) {
  const bot = app?.get?.('bot'); // asosiy mijoz boti
  if (!bot || !chatId) return;
  try { await bot.sendMessage(chatId, text, { parse_mode: 'HTML' }); }
  catch (e) { console.error('Mijozga xabar xato:', e.message); }
}

// ── Tashqi modullardan chaqirish uchun: barcha bo'sh kuryerlarga e'lon ──
async function broadcastToCouriers(app, order) {
  const bot = app?.get?.('kuryerBot');
  if (!bot) {
    console.log('⚠️  Kuryer bot ulanmagan');
    return;
  }

  const { data: couriers } = await supabase.from('users')
    .select('telegram_id, name')
    .eq('role', 'courier')
    .eq('is_available', true)
    .not('telegram_id', 'is', null);

  if (!couriers?.length) {
    console.log('⚠️  Hozirda bo\'sh kuryer yo\'q');
    return { sent: 0 };
  }

  // 4 xonali tasdiqlash kodi
  const deliveryCode = String(Math.floor(1000 + Math.random() * 9000));
  await supabase.from('orders').update({ delivery_code: deliveryCode }).eq('id', order.id);

  // Mijozga kodni yuboramiz
  const { data: orderFull } = await supabase
    .from('orders').select('*, users(telegram_id)').eq('id', order.id).single();
  if (orderFull?.users?.telegram_id) {
    await sendToMijoz(app, orderFull.users.telegram_id,
      `🔑 <b>Yetkazib berish kodingiz: ${deliveryCode}</b>\n\n` +
      `Kuryer yetkazganda undan shu kodni so'raydi. Hech kimga aytmang!`
    );
  }

  const { data: resto } = await supabase
    .from('restaurants').select('name, emoji, address').eq('id', order.restaurant_id).single();

  const text =
    `🛵 <b>Yangi buyurtma!</b>\n\n` +
    `${resto?.emoji || '🍽️'} <b>${resto?.name || 'Restoran'}</b>\n` +
    `📍 Olib ketish: ${resto?.address || '—'}\n` +
    `📍 Yetkazish: ${order.address}\n` +
    `💰 Buyurtma: ${(order.total || 0).toLocaleString('uz-UZ')} so'm\n` +
    `🚗 Yetkazma haqi: ${(order.delivery_fee || 0).toLocaleString('uz-UZ')} so'm\n\n` +
    `Birinchi olganga biriktiriladi! 👇`;

  // Saqlash uchun joy — yangilash uchun keyin kerak
  global._kuryerBroadcasts = global._kuryerBroadcasts || {};
  global._kuryerBroadcasts[order.id] = [];

  let sent = 0;
  for (const c of couriers) {
    try {
      const sentMsg = await bot.sendMessage(c.telegram_id, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '✋ Men olaman', callback_data: `take_${order.id}` }]] }
      });
      global._kuryerBroadcasts[order.id].push({ chatId: c.telegram_id, messageId: sentMsg.message_id });
      sent++;
    } catch (e) {
      console.error(`Kuryer ${c.telegram_id} ga yuborib bo'lmadi:`, e.message);
    }
  }

  return { sent };
}

module.exports = { initKuryerBot, broadcastToCouriers };
