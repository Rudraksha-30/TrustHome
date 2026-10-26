/**
 * Fill the database with demo data so every screen has something to show.
 *
 *   npm run seed:demo                  first run (refuses if demo accounts already exist)
 *   npm run seed:demo -- --reset       delete the demo accounts and their data, then re-create them
 *   npm run seed:demo -- --force       needed when NODE_ENV=production
 *
 * All demo accounts use the email domain @demo.test and the password "Password123".
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const ProviderProfile = require('../src/models/ProviderProfile');
const Booking = require('../src/models/Booking');
const Review = require('../src/models/Review');
const Dispute = require('../src/models/Dispute');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
const AvailabilityLog = require('../src/models/AvailabilityLog');
const Media = require('../src/models/Media');
const { recalculateForProvider } = require('../src/services/trustScore.service');

const PASSWORD = 'Password123';
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const args = new Set(process.argv.slice(2));

const PROVIDERS = [
  { name: 'Ravi Sharma', key: 'ravi', on: true, onPct: 95, cat: 'plumbing', headline: 'Leaks, pipes and bathroom fittings fixed the same day', area: 'Jaipur', min: 300, max: 1500, verified: true,
    completed: 14, ratings: [5, 5, 5, 4, 5, 5, 5, 5, 4, 5, 5, 5, 5, 5], respond: 12, providerCancels: 0 },
  { name: 'Meena Electricals', key: 'meena', on: true, onPct: 90, cat: 'electrical', headline: 'Wiring, fans, switchboards and inverter installs', area: 'Jaipur', min: 250, max: 2000, verified: true,
    completed: 12, ratings: [5, 4, 5, 5, 4, 5, 4, 5, 5, 4, 5, 5], respond: 25, providerCancels: 1 },
  { name: 'Anil Carpentry Works', key: 'anil', on: false, onPct: 40, cat: 'carpentry', headline: 'Custom furniture, repairs and door fittings', area: 'Jaipur', min: 500, max: 5000, verified: false,
    completed: 8, ratings: [5, 3, 4, 2, 5, 3, 4, 3], respond: 240, providerCancels: 3 },
  { name: 'Pooja Home Cleaning', key: 'pooja', on: true, onPct: 85, cat: 'cleaning', headline: 'Deep cleaning for kitchens, bathrooms and whole homes', area: 'Jaipur', min: 400, max: 3000, verified: true,
    completed: 11, ratings: [5, 5, 4, 5, 5, 5, 5, 4, 5, 5, 5], respond: 20, providerCancels: 0 },
  { name: 'Imran AC Repair', key: 'imran', on: true, onPct: 70, cat: 'ac-repair', headline: 'AC servicing, gas refill and installation', area: 'Jaipur', min: 350, max: 3500, verified: false,
    completed: 3, ratings: [5, 4, 5], respond: 45, providerCancels: 0 },
  { name: 'Sunita Maths Tutor', key: 'sunita', on: false, onPct: 15, cat: 'tutoring', headline: 'Maths and science for classes 6 to 10', area: 'Jaipur', min: 300, max: 600, verified: false,
    completed: 0, ratings: [], respond: 0, providerCancels: 0 },
];

const CUSTOMERS = [
  { name: 'Aarav Mehta', key: 'aarav' },
  { name: 'Diya Kapoor', key: 'diya' },
  { name: 'Kabir Singh', key: 'kabir' },
];

const COMMENTS = {
  5: ['Arrived on time and finished quickly.', 'Excellent work, very tidy.', 'Great job, would book again.', 'Professional and fair price.'],
  4: ['Good work overall.', 'Did the job well, slightly late.'],
  3: ['Job done but took longer than promised.', 'Average experience.'],
  2: ['Had to call twice to get a reply.'],
};

const pick = (arr, i) => arr[i % arr.length];

async function wipeDemo() {
  const users = await User.find({ email: /@demo\.test$/i }).select('_id');
  const ids = users.map((u) => u._id);
  if (ids.length === 0) return 0;
  const bookings = await Booking.find({ $or: [{ customer: { $in: ids } }, { provider: { $in: ids } }] }).select('_id');
  const bookingIds = bookings.map((b) => b._id);
  await Promise.all([
    Message.deleteMany({ booking: { $in: bookingIds } }),
    Review.deleteMany({ booking: { $in: bookingIds } }),
    Dispute.deleteMany({ booking: { $in: bookingIds } }),
    Notification.deleteMany({ user: { $in: ids } }),
    ProviderProfile.deleteMany({ user: { $in: ids } }),
    AvailabilityLog.deleteMany({ provider: { $in: ids } }),
    Media.deleteMany({ booking: { $in: bookingIds } }),
  ]);
  await Booking.deleteMany({ _id: { $in: bookingIds } });
  await User.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  if (process.env.NODE_ENV === 'production' && !args.has('--force')) {
    throw new Error('NODE_ENV is production. Re-run with --force if you really want demo data in this database.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  if (await User.exists({ email: /@demo\.test$/i })) {
    if (!args.has('--reset')) throw new Error('Demo accounts already exist. Run with --reset to delete and re-create them.');
    console.log(`Removed ${await wipeDemo()} existing demo accounts.`);
  }

  const customers = [];
  for (const c of CUSTOMERS) {
    customers.push(await User.create({ name: c.name, email: `${c.key}@demo.test`, password: PASSWORD, role: 'customer', phone: '9876500000' }));
  }

  const providers = [];
  for (const p of PROVIDERS) {
    const user = await User.create({ name: p.name, email: `${p.key}@demo.test`, password: PASSWORD, role: 'provider', phone: '9876511111' });
    await ProviderProfile.create({
      user: user._id,
      headline: p.headline,
      description: `${p.name} has served homes across Jaipur. Book a time that suits you and chat with us before the visit.`,
      categories: [p.cat],
      serviceArea: p.area,
      priceMin: p.min,
      priceMax: p.max,
      isVerified: p.verified,
      isAvailable: p.on,
    });
    providers.push({ spec: p, user });
  }

  // Availability history over the last 30 days: alternate on/off blocks so each provider ends up roughly
  // `onPct` percent available, and finishes in the state shown on their listing.
  const START = Date.now() - 30 * DAY;
  for (const { spec, user } of providers) {
    const blocks = 6; // 3 on/off cycles
    const onTotal = (30 * DAY * spec.onPct) / 100;
    const offTotal = 30 * DAY - onTotal;
    let t = START;
    const states = [];
    for (let i = 0; i < blocks; i += 1) states.push(i % 2 === 0 ? 'unavailable' : 'available');
    if (spec.on === false) states.push('unavailable'); else states.push('available');
    // ends on the current state; give each block an even share of its state's total time
    const nOn = states.filter((s) => s === 'available').length || 1;
    const nOff = states.filter((s) => s === 'unavailable').length || 1;
    for (let i = 0; i < states.length; i += 1) {
      const len = states[i] === 'available' ? onTotal / nOn : offTotal / nOff;
      const last = i === states.length - 1;
      await AvailabilityLog.create({ provider: user._id, state: states[i], startedAt: new Date(t), endedAt: last ? null : new Date(t + len) });
      t += len;
    }
  }

  // Past completed jobs with reviews. One booking per review, spaced a day apart so slots never overlap.
  let bookingCount = 0;
  for (const { spec, user } of providers) {
    for (let i = 0; i < spec.completed; i += 1) {
      const customer = pick(customers, i + spec.key.length);
      const daysAgo = 10 + i * 6; // spread over several months so recency weighting has an effect
      const start = new Date(Date.now() - daysAgo * DAY);
      const createdAt = new Date(start.getTime() - 2 * DAY);
      const booking = await Booking.create({
        customer: customer._id, provider: user._id, category: spec.cat,
        scheduledStart: start, durationMinutes: 60, scheduledEnd: new Date(start.getTime() + 60 * MIN),
        address: 'C-Scheme, Jaipur', status: 'completed', createdAt,
        respondedAt: new Date(createdAt.getTime() + spec.respond * MIN),
        statusHistory: [{ status: 'requested', at: createdAt }, { status: 'accepted' }, { status: 'in_progress' }, { status: 'completed' }],
      });
      bookingCount += 1;
      const rating = spec.ratings[i];
      await Review.create({
        booking: booking._id, customer: customer._id, provider: user._id, rating,
        comment: pick(COMMENTS[rating], i), createdAt: new Date(start.getTime() + 3 * 60 * MIN),
      });
    }
    // Jobs the provider accepted and then cancelled (hurts completion rate)
    for (let i = 0; i < spec.providerCancels; i += 1) {
      const start = new Date(Date.now() - (5 + i * 9) * DAY);
      const createdAt = new Date(start.getTime() - 2 * DAY);
      await Booking.create({
        customer: pick(customers, i)._id, provider: user._id, category: spec.cat,
        scheduledStart: start, durationMinutes: 60, scheduledEnd: new Date(start.getTime() + 60 * MIN),
        status: 'cancelled', cancelledByRole: 'provider', cancelReason: 'Provider unavailable', createdAt,
        respondedAt: new Date(createdAt.getTime() + spec.respond * MIN),
        statusHistory: [{ status: 'requested', at: createdAt }, { status: 'accepted' }, { status: 'cancelled' }],
      });
      bookingCount += 1;
    }
  }

  const byKey = (k) => providers.find((p) => p.spec.key === k).user;
  const aarav = customers[0];

  // A dispute an admin already resolved against Anil (this lowers his dispute signal)
  const disputedBooking = await Booking.findOne({ provider: byKey('anil')._id, status: 'completed' });
  await Dispute.create({
    booking: disputedBooking._id, raisedBy: disputedBooking.customer, against: byKey('anil')._id,
    reason: 'The cabinet door was fitted crooked and I was told it could not be redone.',
    status: 'resolved', outcome: 'provider_at_fault', adminNote: 'Photos confirm poor fitting. Provider asked to redo the work.',
    resolvedAt: new Date(Date.now() - 3 * DAY),
  });

  // One open dispute so the admin queue has something to act on
  const openBooking = await Booking.findOne({ provider: byKey('meena')._id, status: 'completed' });
  await Dispute.create({
    booking: openBooking._id, raisedBy: openBooking.customer, against: byKey('meena')._id,
    reason: 'Charged more than the quoted price after the work was finished.',
  });

  // Live bookings for the logged-in customer demo (aarav@demo.test)
  const future = (days, hour) => { const d = new Date(Date.now() + days * DAY); d.setHours(hour, 0, 0, 0); return d; };
  const mk = async (providerKey, cat, start, status, history) => {
    const b = await Booking.create({
      customer: aarav._id, provider: byKey(providerKey)._id, category: cat,
      scheduledStart: start, durationMinutes: 90, scheduledEnd: new Date(start.getTime() + 90 * MIN),
      address: '12 Malviya Nagar, Jaipur', notes: 'Please call before arriving.', status,
      respondedAt: status === 'requested' ? null : new Date(), statusHistory: history,
    });
    bookingCount += 1;
    return b;
  };
  await mk('ravi', 'plumbing', future(2, 11), 'requested', [{ status: 'requested', by: aarav._id }]);
  const accepted = await mk('pooja', 'cleaning', future(3, 10), 'accepted', [{ status: 'requested', by: aarav._id }, { status: 'accepted', by: byKey('pooja')._id }]);
  await Message.create({ booking: accepted._id, sender: aarav._id, text: 'Hi, can you bring your own cleaning supplies?' });
  await Message.create({ booking: accepted._id, sender: byKey('pooja')._id, text: 'Yes, everything is included in the price.' });
  await Notification.create({ user: aarav._id, type: 'booking', message: 'Pooja Home Cleaning accepted your cleaning booking', link: `/bookings/${accepted._id}` });

  for (const { user } of providers) await recalculateForProvider(user._id);

  console.log('\nDemo data created.');
  console.log(`  ${providers.length} providers, ${customers.length} customers, ${bookingCount} bookings, 2 disputes (1 open)`);
  console.log(`  Password for every demo account: ${PASSWORD}`);
  console.log('  Customers: aarav@demo.test, diya@demo.test, kabir@demo.test');
  console.log('  Providers: ' + PROVIDERS.map((p) => `${p.key}@demo.test`).join(', '));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('seed:demo failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
