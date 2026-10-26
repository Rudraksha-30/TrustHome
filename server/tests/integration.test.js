/**
 * End-to-end API tests against a REAL MongoDB.
 *
 * They only run when TEST_MONGO_URI is set (so `npm test` still works with no database):
 *
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test -- integration
 *
 * Each run uses its own throw-away database and drops it at the end.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-123456';

const request = require('supertest');
const mongoose = require('mongoose');

const BASE_URI = process.env.TEST_MONGO_URI;
const maybe = BASE_URI ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d, hour = 10) => {
  const t = new Date(Date.now() + d * DAY);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
};

maybe('full journey against MongoDB', () => {
  let app;
  const dbName = `sm_test_${Date.now()}`;
  const ctx = {};

  const api = () => request(app);
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  async function register(role, name, email) {
    const res = await api().post('/api/auth/register').send({ name, email, password: 'Password123', role });
    expect(res.status).toBe(201);
    return { token: res.body.token, user: res.body.user };
  }

  beforeAll(async () => {
    await mongoose.connect(BASE_URI, { dbName });
    app = require('../src/app');
    const User = require('../src/models/User');

    ctx.customer = await register('customer', 'Cathy Customer', 'cathy@test.dev');
    ctx.customer2 = await register('customer', 'Carl Customer', 'carl@test.dev');
    ctx.provider = await register('provider', 'Pat Plumber', 'pat@test.dev');

    await User.create({ name: 'Ada Admin', email: 'ada@test.dev', password: 'Password123', role: 'admin' });
    const login = await api().post('/api/auth/login').send({ email: 'ada@test.dev', password: 'Password123' });
    expect(login.status).toBe(200);
    ctx.admin = { token: login.body.token, user: login.body.user };
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  describe('auth', () => {
    test('duplicate email is rejected', async () => {
      const res = await api().post('/api/auth/register').send({ name: 'X', email: 'cathy@test.dev', password: 'Password123', role: 'customer' });
      expect(res.status).toBe(409);
    });

    test('wrong password gives a generic 401', async () => {
      const res = await api().post('/api/auth/login').send({ email: 'cathy@test.dev', password: 'nope-nope-nope' });
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/incorrect email or password/i);
    });

    test('passwords are never returned (NFR-8)', async () => {
      const res = await api().get('/api/auth/me').set(auth(ctx.customer.token));
      expect(res.status).toBe(200);
      expect(res.body.user.password).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/); // no bcrypt hash anywhere
    });

    test('a provider has an (empty) profile straight after registering', async () => {
      const res = await api().get('/api/providers/me/profile').set(auth(ctx.provider.token));
      expect(res.status).toBe(200);
      expect(res.body.profile.trust.score).toBe(50);
      expect(res.body.profile.trust.isNewProvider).toBe(true);
    });
  });

  describe('provider listing', () => {
    test('a customer cannot edit a provider profile (FR-4)', async () => {
      const res = await api().put('/api/providers/me/profile').set(auth(ctx.customer.token)).send({ headline: 'hax' });
      expect(res.status).toBe(403);
    });

    test('provider fills their listing and cannot self-verify or set their own score', async () => {
      const res = await api()
        .put('/api/providers/me/profile')
        .set(auth(ctx.provider.token))
        .send({
          headline: 'Fast plumbing fixes',
          description: 'Leaks and pipes',
          categories: ['Plumbing', ' Electrical '],
          serviceArea: 'Jaipur',
          priceMin: 300,
          priceMax: 900,
          isVerified: true,
          trust: { score: 100 },
        });
      expect(res.status).toBe(200);
      expect(res.body.profile.categories).toEqual(['plumbing', 'electrical']);
      expect(res.body.profile.isVerified).toBe(false);
      expect(res.body.profile.trust.score).toBe(50);
      ctx.profileId = res.body.profile._id;
    });

    test('a provider is NOT listed until they switch availability on (point 8)', async () => {
      expect((await api().get('/api/providers').set(auth(ctx.customer.token))).body.total).toBe(0);
      const on = await api().patch('/api/providers/me/availability').set(auth(ctx.provider.token)).send({ available: true });
      expect(on.status).toBe(200);
      expect(on.body.profile.isAvailable).toBe(true);
    });

    test('browse needs a login and is closed to providers (points 10 and 12)', async () => {
      expect((await api().get('/api/providers')).status).toBe(401);
      expect((await api().get('/api/providers').set(auth(ctx.provider.token))).status).toBe(403);
    });

    test('browse, filter and catalog work for customers (FR-8, FR-9, FR-10, point 11)', async () => {
      const as = (path) => api().get(path).set(auth(ctx.customer.token));
      const all = await as('/api/providers');
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(1);
      expect(all.body.providers[0].user.name).toBe('Pat Plumber');
      expect(all.body.providers[0].user.email).toBeUndefined();

      expect((await as('/api/providers?category=plumbing')).body.total).toBe(1);
      expect((await as('/api/providers?category=carpentry')).body.total).toBe(0);
      expect((await as('/api/providers?category=drainage')).status).toBe(400); // not in the fixed list
      expect((await as('/api/providers?area=jaipur')).body.total).toBe(1);
      expect((await as('/api/providers?q=.*')).body.total).toBe(1); // free-text search no longer exists, q is ignored

      const cat = await api().get('/api/providers/meta/catalog').set(auth(ctx.customer.token));
      expect(cat.body.services.map((x) => x.key)).toContain('plumbing');

      const one = await as(`/api/providers/${ctx.profileId}`);
      expect(one.status).toBe(200);
      ctx.providerUserId = one.body.profile.user._id;
    });
  });

  describe('booking lifecycle', () => {
    const slot = inDays(3, 10);

    test('only customers can book, and only future times', async () => {
      const asProvider = await api().post('/api/bookings').set(auth(ctx.provider.token))
        .send({ providerId: ctx.providerUserId, category: 'plumbing', scheduledStart: slot });
      expect(asProvider.status).toBe(403);

      const past = await api().post('/api/bookings').set(auth(ctx.customer.token))
        .send({ providerId: ctx.providerUserId, category: 'plumbing', scheduledStart: new Date(Date.now() - DAY).toISOString() });
      expect(past.status).toBe(400);

      const wrongCategory = await api().post('/api/bookings').set(auth(ctx.customer.token))
        .send({ providerId: ctx.providerUserId, category: 'carpentry', scheduledStart: slot });
      expect(wrongCategory.status).toBe(400);
    });

    test('customer books; the provider is notified (FR-11, FR-12)', async () => {
      const res = await api().post('/api/bookings').set(auth(ctx.customer.token))
        .send({ providerId: ctx.providerUserId, category: 'plumbing', scheduledStart: slot, notes: 'Kitchen tap', address: '12 MI Road' });
      expect(res.status).toBe(201);
      expect(res.body.booking.status).toBe('requested');
      ctx.booking = res.body.booking;

      const notes = await api().get('/api/notifications').set(auth(ctx.provider.token));
      expect(notes.body.unread).toBe(1);
      expect(notes.body.notifications[0].message).toMatch(/Cathy Customer/);
      expect(notes.body.notifications[0].link).toBe(`/bookings/${ctx.booking._id}`);
    });

    test('a customer cannot accept their own booking; strangers cannot see it', async () => {
      const accept = await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.customer.token)).send({ status: 'accepted' });
      expect(accept.status).toBe(403);

      const stranger = await api().get(`/api/bookings/${ctx.booking._id}`).set(auth(ctx.customer2.token));
      expect(stranger.status).toBe(403);
    });

    test('the provider cannot skip states', async () => {
      const res = await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.provider.token)).send({ status: 'completed' });
      expect(res.status).toBe(409);
    });

    test('provider accepts; response time is recorded and the customer is told (FR-13)', async () => {
      const res = await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.provider.token)).send({ status: 'accepted' });
      expect(res.status).toBe(200);
      expect(res.body.booking.respondedAt).toBeTruthy();
      expect(res.body.booking.statusHistory.map((s) => s.status)).toEqual(['requested', 'accepted']);

      const notes = await api().get('/api/notifications').set(auth(ctx.customer.token));
      expect(notes.body.notifications[0].message).toMatch(/Pat Plumber accepted/);
    });

    test('an overlapping request for an accepted slot is refused (FR-15)', async () => {
      const res = await api().post('/api/bookings').set(auth(ctx.customer2.token))
        .send({ providerId: ctx.providerUserId, category: 'plumbing', scheduledStart: new Date(new Date(slot).getTime() + 30 * 60000).toISOString() });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already booked/i);
    });

    test('back-to-back bookings are allowed (boundary)', async () => {
      const res = await api().post('/api/bookings').set(auth(ctx.customer2.token))
        .send({ providerId: ctx.providerUserId, category: 'plumbing', scheduledStart: new Date(new Date(slot).getTime() + 60 * 60000).toISOString() });
      expect(res.status).toBe(201);
      ctx.booking2 = res.body.booking;
    });

    test('accepting a request that now overlaps is blocked at accept time (authoritative check)', async () => {
      const Booking = require('../src/models/Booking');
      const start = new Date(new Date(slot).getTime() + 30 * 60000);
      const sneaky = await Booking.create({
        customer: ctx.customer2.user._id, provider: ctx.providerUserId, category: 'plumbing',
        scheduledStart: start, durationMinutes: 60, scheduledEnd: new Date(start.getTime() + 60 * 60000),
      });
      const res = await api().patch(`/api/bookings/${sneaky._id}/status`).set(auth(ctx.provider.token)).send({ status: 'accepted' });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/overlaps/i);
      await Booking.deleteOne({ _id: sneaky._id });
    });

    test('provider declines the second request', async () => {
      const res = await api().patch(`/api/bookings/${ctx.booking2._id}/status`).set(auth(ctx.provider.token)).send({ status: 'rejected' });
      expect(res.status).toBe(200);
      const again = await api().patch(`/api/bookings/${ctx.booking2._id}/status`).set(auth(ctx.provider.token)).send({ status: 'accepted' });
      expect(again.status).toBe(409); // rejected is terminal
    });

    test('cannot review before completion (FR-17)', async () => {
      const res = await api().post('/api/reviews').set(auth(ctx.customer.token)).send({ bookingId: ctx.booking._id, rating: 5 });
      expect(res.status).toBe(409);
    });

    test('provider starts then completes the job', async () => {
      const start = await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.provider.token)).send({ status: 'in_progress' });
      expect(start.status).toBe(200);
      const cancel = await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.customer.token)).send({ status: 'cancelled' });
      expect(cancel.status).toBe(409); // no cancelling once in progress (FR-16)
      const done = await api().patch(`/api/bookings/${ctx.booking._id}/status`).set(auth(ctx.provider.token)).send({ status: 'completed' });
      expect(done.status).toBe(200);
    });

    test('booking lists carry reviewed / disputeOpen flags for each side', async () => {
      const mine = await api().get('/api/bookings').set(auth(ctx.customer.token));
      expect(mine.body.bookings).toHaveLength(1);
      expect(mine.body.bookings[0].reviewed).toBe(false);
      const theirs = await api().get('/api/bookings').set(auth(ctx.provider.token));
      expect(theirs.body.bookings.length).toBe(2);
    });
  });

  describe('reviews and the trust score', () => {
    test('rating must be 1 to 5', async () => {
      const res = await api().post('/api/reviews').set(auth(ctx.customer.token)).send({ bookingId: ctx.booking._id, rating: 9 });
      expect(res.status).toBe(400);
    });

    test('only the customer of that booking can review it', async () => {
      const res = await api().post('/api/reviews').set(auth(ctx.customer2.token)).send({ bookingId: ctx.booking._id, rating: 5 });
      expect(res.status).toBe(403);
    });

    test('a review recalculates the score and is stored on the profile (FR-19, FR-20)', async () => {
      const res = await api().post('/api/reviews').set(auth(ctx.customer.token)).send({ bookingId: ctx.booking._id, rating: 5, comment: 'Quick and tidy' });
      expect(res.status).toBe(201);
      expect(res.body.trust.score).toBeGreaterThan(50); // 1 completed job, 5 stars, fast reply
      expect(res.body.trust.breakdown.rating.value).toBe(100);

      const profile = await api().get(`/api/providers/${ctx.profileId}`).set(auth(ctx.customer.token));
      expect(profile.body.profile.trust.score).toBe(res.body.trust.score);
      expect(profile.body.profile.trust.reviewCount).toBe(1);
      expect(profile.body.profile.trust.isNewProvider).toBe(true); // still under 3 reviews (FR-21)
      ctx.scoreAfterReview = res.body.trust.score;
    });

    test('a booking can only be reviewed once (FR-18)', async () => {
      const res = await api().post('/api/reviews').set(auth(ctx.customer.token)).send({ bookingId: ctx.booking._id, rating: 1 });
      expect(res.status).toBe(409);
    });

    test('reviews are listed publicly; the provider was notified', async () => {
      const list = await api().get(`/api/providers/${ctx.profileId}/reviews`).set(auth(ctx.customer.token));
      expect(list.body.reviews).toHaveLength(1);
      expect(list.body.reviews[0].customer.name).toBe('Cathy Customer');

      const mine = await api().get(`/api/bookings/${ctx.booking._id}/review`).set(auth(ctx.customer.token));
      expect(mine.body.review.rating).toBe(5);

      const notes = await api().get('/api/notifications').set(auth(ctx.provider.token));
      expect(notes.body.notifications.some((n) => n.type === 'review')).toBe(true);
    });
  });

  describe('chat (FR-22)', () => {
    test('both parties can exchange messages', async () => {
      const a = await api().post(`/api/bookings/${ctx.booking._id}/messages`).set(auth(ctx.customer.token)).send({ text: 'Thanks for the quick fix!' });
      expect(a.status).toBe(201);
      const b = await api().post(`/api/bookings/${ctx.booking._id}/messages`).set(auth(ctx.provider.token)).send({ text: 'Happy to help.' });
      expect(b.status).toBe(201);

      const list = await api().get(`/api/bookings/${ctx.booking._id}/messages`).set(auth(ctx.customer.token));
      expect(list.body.messages.map((m) => m.text)).toEqual(['Thanks for the quick fix!', 'Happy to help.']);
      expect(list.body.messages[0].sender.name).toBe('Cathy Customer');
    });

    test('polling with ?after= returns only newer messages', async () => {
      const list = await api().get(`/api/bookings/${ctx.booking._id}/messages`).set(auth(ctx.customer.token));
      const last = list.body.messages[list.body.messages.length - 1].createdAt;
      const none = await api().get(`/api/bookings/${ctx.booking._id}/messages?after=${encodeURIComponent(last)}`).set(auth(ctx.customer.token));
      expect(none.body.messages).toHaveLength(0);
    });

    test('outsiders cannot read or post; empty messages are rejected', async () => {
      expect((await api().get(`/api/bookings/${ctx.booking._id}/messages`).set(auth(ctx.customer2.token))).status).toBe(403);
      expect((await api().post(`/api/bookings/${ctx.booking._id}/messages`).set(auth(ctx.customer2.token)).send({ text: 'hi' })).status).toBe(403);
      expect((await api().post(`/api/bookings/${ctx.booking._id}/messages`).set(auth(ctx.customer.token)).send({ text: '   ' })).status).toBe(400);
    });

    test('a busy chat creates one unread "new message" notification, not one per message', async () => {
      const notes = await api().get('/api/notifications').set(auth(ctx.customer.token));
      expect(notes.body.notifications.filter((n) => n.type === 'message')).toHaveLength(1);
    });
  });

  describe('notifications (FR-12)', () => {
    test('mark one and mark all as read; cannot touch someone else\'s', async () => {
      const mine = await api().get('/api/notifications').set(auth(ctx.provider.token));
      const first = mine.body.notifications[0];

      const stranger = await api().patch(`/api/notifications/${first._id}/read`).set(auth(ctx.customer.token));
      expect(stranger.status).toBe(404);

      const one = await api().patch(`/api/notifications/${first._id}/read`).set(auth(ctx.provider.token));
      expect(one.body.notification.read).toBe(true);

      const all = await api().post('/api/notifications/read-all').set(auth(ctx.provider.token));
      expect(all.body.unread).toBe(0);
      expect((await api().get('/api/notifications/unread-count').set(auth(ctx.provider.token))).body.unread).toBe(0);
    });
  });

  describe('disputes and admin (FR-23 to FR-27)', () => {
    test('a stranger cannot dispute; short reasons are rejected', async () => {
      expect((await api().post('/api/disputes').set(auth(ctx.customer2.token)).send({ bookingId: ctx.booking._id, reason: 'This is not even my booking at all' })).status).toBe(403);
      expect((await api().post('/api/disputes').set(auth(ctx.customer.token)).send({ bookingId: ctx.booking._id, reason: 'bad' })).status).toBe(400);
    });

    test('customer raises a dispute; admin and provider are notified (FR-23, FR-24)', async () => {
      const res = await api().post('/api/disputes').set(auth(ctx.customer.token))
        .send({ bookingId: ctx.booking._id, reason: 'The leak came back two days after the repair.' });
      expect(res.status).toBe(201);
      expect(res.body.dispute.status).toBe('open');
      ctx.dispute = res.body.dispute;

      const adminNotes = await api().get('/api/notifications').set(auth(ctx.admin.token));
      expect(adminNotes.body.notifications.some((n) => n.type === 'dispute')).toBe(true);
      const providerNotes = await api().get('/api/notifications').set(auth(ctx.provider.token));
      expect(providerNotes.body.notifications[0].type).toBe('dispute');

      const flags = await api().get(`/api/bookings/${ctx.booking._id}`).set(auth(ctx.customer.token));
      expect(flags.body.booking.disputeOpen).toBe(true);
    });

    test('only one open dispute per booking', async () => {
      const res = await api().post('/api/disputes').set(auth(ctx.provider.token)).send({ bookingId: ctx.booking._id, reason: 'The customer refused to pay in full.' });
      expect(res.status).toBe(409);
    });

    test('admin routes are admin-only', async () => {
      for (const path of ['/api/admin/stats', '/api/admin/disputes', '/api/admin/providers']) {
        expect((await api().get(path).set(auth(ctx.customer.token))).status).toBe(403);
        expect((await api().get(path)).status).toBe(401);
      }
    });

    test('admin sees the dispute queue and platform stats (FR-27)', async () => {
      const queue = await api().get('/api/admin/disputes?status=open').set(auth(ctx.admin.token));
      expect(queue.body.disputes).toHaveLength(1);
      expect(queue.body.disputes[0].raisedBy.name).toBe('Cathy Customer');

      const stats = await api().get('/api/admin/stats').set(auth(ctx.admin.token));
      expect(stats.body.users).toMatchObject({ customer: 2, provider: 1, admin: 1 });
      expect(stats.body.bookings.completed).toBe(1);
      expect(stats.body.bookings.total).toBe(2);
      expect(stats.body.disputes.open).toBe(1);
      expect(stats.body.reviews).toBe(1);
      expect(stats.body.providers.total).toBe(1);
    });

    test('resolving against the provider lowers their score (FR-26)', async () => {
      const before = (await api().get(`/api/providers/${ctx.profileId}`).set(auth(ctx.customer.token))).body.profile.trust.score;
      const res = await api().patch(`/api/admin/disputes/${ctx.dispute._id}/resolve`).set(auth(ctx.admin.token))
        .send({ outcome: 'provider_at_fault', adminNote: 'Repair was faulty.' });
      expect(res.status).toBe(200);
      expect(res.body.dispute.status).toBe('resolved');

      const after = (await api().get(`/api/providers/${ctx.profileId}`).set(auth(ctx.customer.token))).body.profile.trust;
      expect(after.score).toBeLessThan(before);
      expect(after.breakdown.disputes.value).toBe(0); // 1 fault in 1 completed job

      const again = await api().patch(`/api/admin/disputes/${ctx.dispute._id}/resolve`).set(auth(ctx.admin.token)).send({ outcome: 'no_fault' });
      expect(again.status).toBe(409);

      const customerNotes = await api().get('/api/notifications').set(auth(ctx.customer.token));
      expect(customerNotes.body.notifications[0].message).toMatch(/decided in your favour/);
    });

    test('an invalid outcome is rejected', async () => {
      const res = await api().patch(`/api/admin/disputes/${ctx.dispute._id}/resolve`).set(auth(ctx.admin.token)).send({ outcome: 'banana' });
      expect(res.status).toBe(400);
    });

    test('admin can verify and un-verify a provider; the provider is told (FR-25)', async () => {
      const on = await api().patch(`/api/admin/providers/${ctx.profileId}/verify`).set(auth(ctx.admin.token)).send({ isVerified: true });
      expect(on.body.profile.isVerified).toBe(true);
      expect((await api().get(`/api/providers/${ctx.profileId}`).set(auth(ctx.customer.token))).body.profile.isVerified).toBe(true);

      const off = await api().patch(`/api/admin/providers/${ctx.profileId}/verify`).set(auth(ctx.admin.token)).send({ isVerified: false });
      expect(off.body.profile.isVerified).toBe(false);

      const list = await api().get('/api/admin/providers?verified=false').set(auth(ctx.admin.token));
      expect(list.body.providers[0].user.email).toBe('pat@test.dev'); // admins see contact details
    });
  });

  describe('provider-side cancellation hurts the score', () => {
    test('cancelling an accepted job lowers the completion rate', async () => {
      const book = await api().post('/api/bookings').set(auth(ctx.customer2.token))
        .send({ providerId: ctx.providerUserId, category: 'electrical', scheduledStart: inDays(5, 14) });
      expect(book.status).toBe(201);
      await api().patch(`/api/bookings/${book.body.booking._id}/status`).set(auth(ctx.provider.token)).send({ status: 'accepted' });
      const before = (await api().get(`/api/providers/${ctx.profileId}`).set(auth(ctx.customer.token))).body.profile.trust.breakdown.completion.value;

      const cancel = await api().patch(`/api/bookings/${book.body.booking._id}/status`).set(auth(ctx.provider.token))
        .send({ status: 'cancelled', reason: 'Van broke down' });
      expect(cancel.status).toBe(200);
      expect(cancel.body.booking.cancelReason).toBe('Van broke down'); // FR-16
      expect(cancel.body.booking.cancelledByRole).toBe('provider');

      const after = (await api().get(`/api/providers/${ctx.profileId}`).set(auth(ctx.customer.token))).body.profile.trust.breakdown.completion.value;
      expect(before).toBe(100);
      expect(after).toBe(50); // 1 completed, 1 cancelled by provider
    });
  });

  describe('profile updates and deactivation', () => {
    test('user can update name and phone (FR-5)', async () => {
      const res = await api().patch('/api/auth/me').set(auth(ctx.customer.token)).send({ name: 'Cathy C.', phone: '9999900000' });
      expect(res.body.user.name).toBe('Cathy C.');
      expect(res.body.user.phone).toBe('9999900000');
    });

    test('a deactivated listing disappears from browse and cannot be booked (FR-7)', async () => {
      await api().put('/api/providers/me/profile').set(auth(ctx.provider.token)).send({ isActive: false });
      expect((await api().get('/api/providers').set(auth(ctx.customer.token))).body.total).toBe(0);
      expect((await api().get(`/api/providers/${ctx.profileId}`).set(auth(ctx.customer.token))).status).toBe(404);
      const res = await api().post('/api/bookings').set(auth(ctx.customer.token))
        .send({ providerId: ctx.providerUserId, category: 'plumbing', scheduledStart: inDays(9, 9) });
      expect(res.status).toBe(404);
    });
  });
});
