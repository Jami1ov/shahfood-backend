require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));app.use(express.json({ limit: '8mb' }));
app.use(morgan('dev'));

// Rate limiting — spam himoyasi
const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use('/api/', limiter);

// ── Routes ──────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/restaurants', require('./routes/restaurants'));
app.use('/api/orders',      require('./routes/orders'));
app.use('/api/admin',       require('./routes/admin'));

// Promo kod tekshirish
app.post('/api/promo/validate', async (req, res) => {
  const { code } = req.body;
  const supabase = require('./config/supabase');
  const { data } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('code', code?.toUpperCase())
    .eq('is_active', true)
    .single();

  if (!data) return res.status(404).json({ valid: false, error: 'Kod topilmadi' });
  if (data.used_count >= data.max_uses)
    return res.status(400).json({ valid: false, error: 'Kod tugagan' });
  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.status(400).json({ valid: false, error: 'Kod muddati o\'tgan' });

  res.json({ valid: true, discount: data.discount_percent, description: data.description });
});

// Health check
app.get('/health', (req, res) => res.json({
  status: 'ok',
  time: new Date().toISOString(),
  env: process.env.NODE_ENV || 'development'
}));

// 404
app.use((req, res) => res.status(404).json({ error: 'Yo\'l topilmadi' }));

// Global xato ushlagich
app.use((err, req, res, next) => {
  console.error('Server xato:', err.message);
  res.status(500).json({ error: 'Server xatosi' });
});

// ── Telegram bot ────────────────────────────────
const { initBot } = require('./bot');
initBot(app);

const { initKuryerBot } = require('./kuryer_bot');
initKuryerBot(app);

// ── Start ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════╗
  ║   🍽️  ShahFood Backend v1.0     ║
  ║   Port: ${PORT}                      ║
  ║   Supabase: ${process.env.SUPABASE_URL ? '✅ ulangan' : '❌ URL yo\'q'}      ║
  ║   Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ ulangan' : '⚠️  sozlanmagan'}   ║
  ╚══════════════════════════════════╝
  `);
});

module.exports = app;
