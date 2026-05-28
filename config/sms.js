// Eskiz.uz orqali SMS yuborish (IXTIYORIY).
// Hozircha asosiy kanal — Telegram (bepul). SMS faqat env sozlansa ishlaydi:
//   ESKIZ_EMAIL + ESKIZ_PASSWORD   (yoki tayyor ESKIZ_TOKEN)
// Eskiz sozlanmagan bo'lsa, sendSMS false qaytaradi va tizim Telegramdan foydalanadi.

let cachedToken = null;

async function getToken() {
  if (process.env.ESKIZ_TOKEN) return process.env.ESKIZ_TOKEN;
  if (cachedToken) return cachedToken;
  if (!process.env.ESKIZ_EMAIL || !process.env.ESKIZ_PASSWORD) return null;

  try {
    const r = await fetch('https://notify.eskiz.uz/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ESKIZ_EMAIL,
        password: process.env.ESKIZ_PASSWORD
      })
    });
    const j = await r.json();
    cachedToken = j?.data?.token || null;
    return cachedToken;
  } catch (e) {
    console.error('Eskiz auth xato:', e.message);
    return null;
  }
}

async function sendSMS(phone, text) {
  const token = await getToken();
  if (!token) return false; // SMS sozlanmagan — Telegram orqali yuboriladi

  try {
    const r = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        mobile_phone: String(phone).replace(/\D/g, ''),
        message: text,
        from: process.env.ESKIZ_FROM || '4546'
      })
    });
    if (r.status === 401) { cachedToken = null; } // token eskirgan
    return r.ok;
  } catch (e) {
    console.error('Eskiz SMS xato:', e.message);
    return false;
  }
}

module.exports = { sendSMS };
