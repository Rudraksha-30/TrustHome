const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Kept separate from server.js so tests can import the app without opening a port or a DB connection.
const app = express();

// Render/Vercel put a proxy in front of the app; without this every visitor looks like the same IP to the rate limiter.
app.set('trust proxy', 1);

app.use(helmet());

// CLIENT_URL may hold several comma-separated origins, e.g. "https://my-app.vercel.app,http://localhost:5173"
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins }));

app.use(express.json({ limit: '100kb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// NFR-6: slow down password guessing and fake-account spam.
// Only login and register are limited. GET /api/auth/me runs on every page load, so counting it would
// lock ordinary users out (and many students share one IP on a college network).
const authLimiter = (options = {}) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT) || 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many attempts. Please wait a few minutes and try again.' },
    ...options,
  });

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth/login', authLimiter({ skipSuccessfulRequests: true })); // only FAILED logins count
app.use('/api/auth/register', authLimiter());
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/providers', require('./routes/provider.routes'));
app.use('/api/bookings', require('./routes/booking.routes'));
app.use('/api/reviews', require('./routes/review.routes'));
app.use('/api/disputes', require('./routes/dispute.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/portfolio', require('./routes/portfolio.routes'));
app.use('/api/media', require('./routes/media.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/inspector', require('./routes/inspector.routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
