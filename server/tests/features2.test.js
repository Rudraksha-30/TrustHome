/**
 * Integration tests for the second round of changes: availability tracking, review and chat edit/delete,
 * photo and video upload, the quality inspector, and the access rules for browsing providers.
 * Runs only when TEST_MONGO_URI is set (same as integration.test.js).
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-123456';

const request = require('supertest');
const mongoose = require('mongoose');

const BASE_URI = process.env.TEST_MONGO_URI;
const maybe = BASE_URI ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d, hour = 10) => { const t = new Date(Date.now() + d * DAY); t.setUTCHours(hour, 0, 0, 0); return t.toISOString(); };

// Smallest byte strings that start like real files (enough for the magic-byte check)
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(40)]);

maybe('round 2 features against MongoDB', () => {
  let app;
  const dbName = `sm_test2_${Date.now()}`;
  const ctx = {};
  const api = () => request(app);
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function register(role, name, email) {
    const res = await api().post('/api/auth/register').send({ name, email, password: 'Password123', role });
    expect(res.status).toBe(201);
    return { token: res.body.token, user: res.body.user };
  }

  beforeAll(async () => {
    await mongoose.connect(BASE_URI, { dbName });
    app = require('../src/app');
    const User = require('../src/models/User');
    ctx.cust = await register('customer', 'Cara Customer', 'cara@test.dev');
    ctx.other = await register('customer', 'Omar Other', 'omar@test.dev');
    ctx.pro = await register('provider', 'Paul Pro', 'paul@test.dev');
    ctx.pro2 = await register('provider', 'Pia Pro', 'pia@test.dev');
    await User.create({ name: 'Ina Inspector', email: 'ina@test.dev', password: 'Password123', role: 'inspector' });
    const l = await api().post('/api/auth/login').send({ email: 'ina@test.dev', password: 'Password123' });
    ctx.insp = { token: l.body.token };

    await api().put('/api/providers/me/profile').set(auth(ctx.pro.token))
      .send({ headline: 'Plumber', categories: ['plumbing'], serviceArea: 'Jaipur', priceMin: 100, priceMax: 500 });
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  describe('availability (points 8 and 9)', () => {
    test('cannot go live with an empty listing', async () => {
      const res = await api().patch('/api/providers/me/availability').set(auth(ctx.pro2.token)).send({ available: true });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/headline/);
    });

    test('going live lists the provider; going off hides them and blocks booking', async () => {
      const on = await api().patch('/api/providers/me/availability').set(auth(ctx.pro.token)).send({ available: true });
      expect(on.status).toBe(200);
      const list = await api().get('/api/providers').set(auth(ctx.cust.token));
      expect(list.body.total).toBe(1);
      ctx.profileId = list.body.providers[0]._id;
      ctx.proId = list.body.providers[0].user._id;

      await api().patch('/api/providers/me/availability').set(auth(ctx.pro.token)).send({ available: false });
      expect((await api().get('/api/providers').set(auth(ctx.cust.token))).body.total).toBe(0);
      const book = await api().post('/api/bookings').set(auth(ctx.cust.token))
        .send({ providerId: ctx.proId, category: 'plumbing', scheduledStart: inDays(4) });
      expect(book.status).toBe(409);
      expect(book.body.message).toMatch(/not taking bookings/i);

      await api().patch('/api/providers/me/availability').set(auth(ctx.pro.token)).send({ available: true });
    });

    test('the provider can see how long they were off, and a duplicate toggle adds nothing', async () => {
      await api().patch('/api/providers/me/availability').set(auth(ctx.pro.token)).send({ available: true });
      const res = await api().get('/api/providers/me/availability?days=30').set(auth(ctx.pro.token));
      expect(res.status).toBe(200);
      expect(res.body.isAvailable).toBe(true);
      expect(res.body.recent.length).toBe(4); // unavailable (from signup), available, unavailable, available
    });

    test('customers cannot read availability controls; providers cannot browse', async () => {
      expect((await api().get('/api/providers/me/availability').set(auth(ctx.cust.token))).status).toBe(403);
      expect((await api().get('/api/providers').set(auth(ctx.pro.token))).status).toBe(403);
      expect((await api().get('/api/providers')).status).toBe(401);
    });
  });

  describe('booking, media, chat and review editing', () => {
    test('booking ignores any client-sent duration (point 7)', async () => {
      const res = await api().post('/api/bookings').set(auth(ctx.cust.token))
        .send({ providerId: ctx.proId, category: 'plumbing', scheduledStart: inDays(5), durationMinutes: 480 });
      expect(res.status).toBe(201);
      expect(res.body.booking.durationMinutes).toBe(60);
      ctx.booking = res.body.booking;
      await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.pro.token)).send({ status: 'accepted' });
    });

    test('photos and videos: real files are accepted, fakes and strangers are refused (point 13)', async () => {
      const up = (token, buf, type) => api().post(`/api/bookings/${ctx.booking._id}/media`).set(auth(token)).set('Content-Type', type).send(buf);

      const img = await up(ctx.cust.token, PNG, 'image/png');
      expect(img.status).toBe(201);
      const vid = await up(ctx.pro.token, MP4, 'video/mp4');
      expect(vid.status).toBe(201);

      const fake = await up(ctx.cust.token, Buffer.from('<html><script>alert(1)</script></html> padding padding'), 'image/png');
      expect(fake.status).toBe(415); // header says PNG, bytes say otherwise
      expect((await up(ctx.other.token, PNG, 'image/png')).status).toBe(403);

      const list = await api().get(`/api/bookings/${ctx.booking._id}/media`).set(auth(ctx.cust.token));
      expect(list.body.media).toHaveLength(2);
      ctx.media = list.body.media;

      // the signed address works without a login header, and is not guessable
      const file = await api().get(ctx.media[0].url);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toMatch(/^(image|video)\//);
      expect((await api().get(`/api/media/${ctx.media[0]._id}/file`)).status).toBe(401);
      expect((await api().get(`/api/media/${ctx.media[0]._id}/file?t=junk`)).status).toBe(401);
    });

    test('only the uploader can delete a file', async () => {
      const mine = ctx.media.find((m) => m.uploader.name === 'Cara Customer');
      expect((await api().delete(`/api/media/${mine._id}`).set(auth(ctx.pro.token))).status).toBe(403);
      expect((await api().delete(`/api/media/${mine._id}`).set(auth(ctx.cust.token))).status).toBe(200);
    });

    test('chat: edit and delete own messages only (point 3)', async () => {
      const post = await api().post(`/api/bookings/${ctx.booking._id}/messages`).set(auth(ctx.cust.token)).send({ text: 'Helo' });
      const id = post.body.message._id;

      expect((await api().patch(`/api/bookings/${ctx.booking._id}/messages/${id}`).set(auth(ctx.pro.token)).send({ text: 'hax' })).status).toBe(403);
      const ed = await api().patch(`/api/bookings/${ctx.booking._id}/messages/${id}`).set(auth(ctx.cust.token)).send({ text: 'Hello' });
      expect(ed.status).toBe(200);
      expect(ed.body.message.text).toBe('Hello');
      expect(ed.body.message.editedAt).toBeTruthy();

      const after = new Date(Date.now() - 60000).toISOString();
      const del = await api().delete(`/api/bookings/${ctx.booking._id}/messages/${id}`).set(auth(ctx.cust.token));
      expect(del.status).toBe(200);
      const poll = await api().get(`/api/bookings/${ctx.booking._id}/messages?after=${encodeURIComponent(after)}`).set(auth(ctx.pro.token));
      const gone = poll.body.messages.find((m) => m._id === id);
      expect(gone.deleted).toBe(true);
      expect(gone.text).toBe('');
      expect((await api().patch(`/api/bookings/${ctx.booking._id}/messages/${id}`).set(auth(ctx.cust.token)).send({ text: 'again' })).status).toBe(409);
    });

    test('reviews: edit recalculates the score, delete removes it, others cannot touch it (point 1)', async () => {
      await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.pro.token)).send({ status: 'in_progress' });
      await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.pro.token)).send({ status: 'completed' });

      const rev = await api().post('/api/reviews').set(auth(ctx.cust.token)).send({ bookingId: ctx.booking._id, rating: 5, comment: 'Great' });
      expect(rev.status).toBe(201);
      const id = rev.body.review._id;
      const s1 = rev.body.trust.score;

      expect((await api().patch(`/api/reviews/${id}`).set(auth(ctx.other.token)).send({ rating: 1 })).status).toBe(403);
      const ed = await api().patch(`/api/reviews/${id}`).set(auth(ctx.cust.token)).send({ rating: 1, comment: 'Changed my mind' });
      expect(ed.status).toBe(200);
      expect(ed.body.review.editedAt).toBeTruthy();
      expect(ed.body.trust.score).toBeLessThan(s1);

      expect((await api().delete(`/api/reviews/${id}`).set(auth(ctx.pro.token))).status).toBe(403);
      expect((await api().delete(`/api/reviews/${id}`).set(auth(ctx.cust.token))).status).toBe(200);
      const list = await api().get(`/api/providers/${ctx.profileId}/reviews`).set(auth(ctx.cust.token));
      expect(list.body.reviews).toHaveLength(0);
      // after deleting, the customer may review again
      expect((await api().post('/api/reviews').set(auth(ctx.cust.token)).send({ bookingId: ctx.booking._id, rating: 4 })).status).toBe(201);
    });
  });

  describe('notifications (point 6) and quality inspector (point 2)', () => {
    test('each person only ever receives their own notifications', async () => {
      const mine = await api().get('/api/notifications').set(auth(ctx.pro.token));
      const theirs = await api().get('/api/notifications').set(auth(ctx.cust.token));
      expect(mine.body.notifications.length).toBeGreaterThan(0);
      for (const n of mine.body.notifications) expect(n.user === undefined || n.user === ctx.pro.user._id).toBe(true);
      expect(mine.body.notifications.some((n) => /accepted your/i.test(n.message))).toBe(false); // that one was for the customer
      expect(theirs.body.notifications.some((n) => /accepted/i.test(n.message))).toBe(true);
    });

    test('inspector gets a read-only report; others are refused', async () => {
      const res = await api().get('/api/inspector/report').set(auth(ctx.insp.token));
      expect(res.status).toBe(200);
      expect(res.body.providers.length).toBe(2);
      expect(res.body.providers[0]).toHaveProperty('flags');
      expect(res.body.providers[0].availability).toHaveProperty('unavailablePct');
      expect((await api().get('/api/inspector/report').set(auth(ctx.cust.token))).status).toBe(403);
      expect((await api().get('/api/inspector/report')).status).toBe(401);
    });

    test('inspector cannot use admin or customer features', async () => {
      expect((await api().get('/api/admin/stats').set(auth(ctx.insp.token))).status).toBe(403);
      expect((await api().get('/api/providers').set(auth(ctx.insp.token))).status).toBe(403);
      expect((await api().get(`/api/bookings/${ctx.booking._id}/media`).set(auth(ctx.insp.token))).status).toBe(403);
    });

    test('no one can register as an inspector', async () => {
      const res = await api().post('/api/auth/register').send({ name: 'Sneaky', email: 'sneaky@test.dev', password: 'Password123', role: 'inspector' });
      expect(res.status).toBe(400);
    });
  });
});
