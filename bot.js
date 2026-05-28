const TelegramBot = require('node-telegram-bot-api');
const supabase = require('./config/supabase');

const SHAHRISABZ = { lat: 39.0593, lon: 66.8487 };

const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return +(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1);
};

const fmt = n => n.toLocaleString('uz-UZ') + " so'm";

// Har bir foydalanuvchining sessiya holati
const sessions = {};

const initBot = (app) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('⚠️  TELEGRAM_BOT_TOKEN yo\'q — bot o\'chirilgan');
    return;
  }

  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram bot ishga tushdi');

  const getSession = (chatId) => {
    if (!sessions[chatId]) sessions[chatId] = { step: 'start', cart: {}, restoId: null };
    return sessions[chatId];
  };

  const mainMenu = (chatId, text = 'Assalomu alaykum! Dasturxon — Shahrisabz yetkazib berish xizmati 🍽️') => {
    bot.sendMessage(chatId, text, {
      reply_markup: {
        keyboard: [
          [{ text: '🍽️ Restoranlar' }, { text: '📦 Buyurtmalarim' }],
          [{ text: '📍 Manzilim', request_location: true }, { text: '👤 Profil' }]
        ],
        resize_keyboard: true
      }
    });
  };

  // /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const sess = getSession(chatId);

    // Foydalanuvchini topish yoki yaratish
    let { data: user } = await supabase.from('users')
      .select('*').eq('phone', `tg_${chatId}`).single();

    if (!user) {
      const { data } = await supabase.from('users').insert({
        phone: `tg_${chatId}`,
        name: msg.from.first_name || 'Telegram foydalanuvchi',
        role: 'customer'
      }).select().single();
      user = data;
    }

    sess.userId = user?.id;
    sess.userName = user?.name || msg.from.first_name;
    mainMenu(chatId);
  });

  // Restoranlar ro'yxati
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const sess = getSession(chatId);

    // Manzil yuborilganda
    if (msg.location) {
      sess.userLat = msg.location.latitude;
      sess.userLon = msg.location.longitude;
      bot.sendMessage(chatId, `📍 Manzilingiz aniqlandi! Eng yaqin restoranlar ko'rsatilmoqda...`);
    }

    if (text === '🍽️ Restoranlar' || text === '/restaurants') {
      const { data: restaurants } = await supabase
        .from('restaurants').select('*').eq('is_open', true);

      let rList = restaurants || [];
      if (sess.userLat && sess.userLon) {
        rList = rList.map(r => ({
          ...r,
          dist: haversine(sess.userLat, sess.userLon, r.lat, r.lon)
        })).sort((a, b) => a.dist - b.dist);
      }

      const keyboard = rList.map(r => ([{
        text: `${r.emoji} ${r.name} ${r.dist ? `(${r.dist}km)` : ''} — ⭐${r.rating}`
      }]));
      keyboard.push([{ text: '🔙 Orqaga' }]);

      sess.step = 'choose_resto';
      sess.restoList = rList;

      bot.sendMessage(chatId, '🍽️ <b>Ochiq restoranlar:</b>', {
        parse_mode: 'HTML',
        reply_markup: { keyboard, resize_keyboard: true }
      });
    }

    else if (sess.step === 'choose_resto') {
      const chosen = sess.restoList?.find(r =>
        text.includes(r.name)
      );
      if (chosen) {
        sess.restoId = chosen.id;
        sess.restoName = chosen.name;
        sess.cart = {};
        sess.step = 'menu';

        const { data: cats } = await supabase
          .from('menu_categories').select('*')
          .eq('restaurant_id', chosen.id).order('sort_order');

        const keyboard = cats.map(c => ([{ text: `📂 ${c.name}` }]));
        keyboard.push([{ text: '🛒 Savatcha' }, { text: '🔙 Orqaga' }]);

        bot.sendMessage(chatId,
          `<b>${chosen.emoji} ${chosen.name}</b>\n⭐ ${chosen.rating} · ${fmt(chosen.delivery_fee)} yetkazma · Min: ${fmt(chosen.min_order)}`,
          { parse_mode: 'HTML', reply_markup: { keyboard, resize_keyboard: true } }
        );
        sess.categories = cats;
      }
    }

    else if (sess.step === 'menu' && text.startsWith('📂 ')) {
      const catName = text.replace('📂 ', '');
      const cat = sess.categories?.find(c => c.name === catName);
      if (!cat) return;

      const { data: items } = await supabase
        .from('menu_items').select('*')
        .eq('category_id', cat.id).eq('is_available', true);

      sess.currentItems = items;
      sess.step = 'choose_item';

      const keyboard = items.map(item => ([{
        text: `${item.name} — ${fmt(item.price)}`
      }]));
      keyboard.push([{ text: '🔙 Menyuga qaytish' }]);

      bot.sendMessage(chatId, `<b>📂 ${catName}</b>`, {
        parse_mode: 'HTML',
        reply_markup: { keyboard, resize_keyboard: true }
      });
    }

    else if (sess.step === 'choose_item') {
      const item = sess.currentItems?.find(i => text.includes(i.name));
      if (item) {
        sess.cart[item.id] = {
          ...item,
          qty: (sess.cart[item.id]?.qty || 0) + 1
        };
        const total = Object.values(sess.cart).reduce((s, i) => s + i.price * i.qty, 0);
        bot.sendMessage(chatId,
          `✅ <b>${item.name}</b> qo'shildi!\nSavatda: ${fmt(total)}\n\nDavom etish yoki 🛒 Savatcha`,
          { parse_mode: 'HTML' }
        );
      } else if (text === '🔙 Menyuga qaytish') {
        sess.step = 'menu';
      }
    }

    else if (text === '🛒 Savatcha') {
      const items = Object.values(sess.cart);
      if (!items.length) {
        bot.sendMessage(chatId, '🛒 Savatcha bo\'sh. Restoran tanlang.');
        return;
      }
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const resto = sess.restoList?.find(r => r.id === sess.restoId);
      const total = subtotal + (resto?.delivery_fee || 8000);
      const list = items.map(i => `• ${i.name} × ${i.qty} = ${fmt(i.price * i.qty)}`).join('\n');

      sess.step = 'confirm_order';
      sess.orderTotal = total;
      sess.orderSubtotal = subtotal;

      bot.sendMessage(chatId,
        `🛒 <b>Savatchingiz:</b>\n\n${list}\n\nYetkazma: ${fmt(resto?.delivery_fee || 8000)}\n<b>Jami: ${fmt(total)}</b>\n\nBuyurtma berishni tasdiqlaysizmi?`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            keyboard: [
              [{ text: '✅ Tasdiqlash' }],
              [{ text: '❌ Bekor qilish' }]
            ],
            resize_keyboard: true
          }
        }
      );
    }

    else if (sess.step === 'confirm_order' && text === '✅ Tasdiqlash') {
      if (!sess.userId) {
        bot.sendMessage(chatId, '⚠️ Avval /start bosing');
        return;
      }
      const items = Object.values(sess.cart).map(i => ({
        id: i.id, name: i.name, price: i.price, qty: i.qty
      }));
      const resto = sess.restoList?.find(r => r.id === sess.restoId);

      const { data: order, error } = await supabase.from('orders').insert({
        user_id: sess.userId,
        restaurant_id: sess.restoId,
        items,
        subtotal: sess.orderSubtotal,
        discount: 0,
        delivery_fee: resto?.delivery_fee || 8000,
        total: sess.orderTotal,
        address: sess.userLat ? `${sess.userLat}, ${sess.userLon}` : 'Shahrisabz',
        lat: sess.userLat || SHAHRISABZ.lat,
        lon: sess.userLon || SHAHRISABZ.lon,
        payment_method: 'cash',
        stage: 0,
        status: 'Qabul qilindi'
      }).select().single();

      if (error) {
        bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Qaytadan urinib ko\'ring.');
        return;
      }

      // Restoran egasiga xabar
      if (resto?.owner_telegram_id) {
        const itemsList = items.map(i => `• ${i.name} × ${i.qty}`).join('\n');
        bot.sendMessage(resto.owner_telegram_id,
          `🔔 <b>Yangi buyurtma #${order.id} (Telegram)</b>\n\n${itemsList}\n\n💰 Jami: ${fmt(sess.orderTotal)}\n💳 Naqd`,
          { parse_mode: 'HTML' }
        );
      }

      sess.cart = {};
      sess.step = 'start';

      bot.sendMessage(chatId,
        `🎉 <b>Buyurtma #${order.id} qabul qilindi!</b>\n\nTaxminiy vaqt: ~30 daqiqa\nKuzatish uchun saytga o'ting: ${process.env.FRONTEND_URL || 'shahfood.uz'}`,
        { parse_mode: 'HTML' }
      );
      mainMenu(chatId, '✅ Buyurtmangiz restoranga yuborildi!');
    }

    else if (text === '📦 Buyurtmalarim') {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, status, stage, total, created_at, restaurants(name)')
        .eq('user_id', sess.userId || '')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!orders?.length) {
        bot.sendMessage(chatId, '📦 Hozircha buyurtmalar yo\'q.');
        return;
      }

      const ICONS = ['✅','👨‍🍳','🛵','🎉'];
      const list = orders.map(o =>
        `${ICONS[o.stage]} <b>#${o.id}</b> — ${o.restaurants?.name}\n${o.status} · ${fmt(o.total)}`
      ).join('\n\n');

      bot.sendMessage(chatId, `📦 <b>So'nggi buyurtmalar:</b>\n\n${list}`, { parse_mode: 'HTML' });
    }

    else if (text === '🔙 Orqaga' || text === '❌ Bekor qilish') {
      sess.step = 'start';
      mainMenu(chatId);
    }
  });

  return bot;
};

module.exports = { initBot };
