const User = require('../models/User');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const Dispute = require('../models/Dispute');
const ProviderProfile = require('../models/ProviderProfile');
const { recalculateForProvider } = require('../services/trustScore.service');
const { notify } = require('../services/notify');

// FR-27: platform-level statistics
exports.stats = async (_req, res) => {
  const [users, bookingsByStatus, reviewCount, openDisputes, resolvedDisputes, providerCount, trustAgg] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Review.countDocuments(),
    Dispute.countDocuments({ status: 'open' }),
    Dispute.countDocuments({ status: 'resolved' }),
    ProviderProfile.countDocuments(),
    // Sum then divide (instead of $avg / a combined count) so this runs the same on MongoDB-compatible servers
    ProviderProfile.aggregate([{ $group: { _id: null, total: { $sum: '$trust.score' } } }]),
  ]);

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const bookings = toMap(bookingsByStatus);
  res.json({
    users: toMap(users),
    bookings: { ...bookings, total: Object.values(bookings).reduce((a, b) => a + b, 0) },
    reviews: reviewCount,
    disputes: { open: openDisputes, resolved: resolvedDisputes },
    providers: {
      total: providerCount,
      averageTrustScore: providerCount > 0 && trustAgg[0] ? Math.round((trustAgg[0].total / providerCount) * 10) / 10 : null,
    },
  });
};

// FR-25: providers awaiting / holding verification
exports.listProviders = async (req, res) => {
  const filter = {};
  if (req.query.verified === 'true') filter.isVerified = true;
  if (req.query.verified === 'false') filter.isVerified = false;
  const providers = await ProviderProfile.find(filter)
    .sort({ isVerified: 1, createdAt: -1 })
    .limit(200)
    .populate('user', 'name email phone');
  res.json({ providers });
};

exports.setVerified = async (req, res) => {
  const profile = await ProviderProfile.findByIdAndUpdate(
    req.params.id,
    { isVerified: req.body.isVerified },
    { returnDocument: 'after' }
  ).populate('user', 'name email');
  if (!profile) return res.status(404).json({ message: 'Provider not found' });

  await notify(
    profile.user._id,
    'verification',
    profile.isVerified ? 'Your profile is now verified' : 'Your verified badge was removed',
    '/profile'
  );
  res.json({ profile });
};

// FR-26: disputes queue
exports.listDisputes = async (req, res) => {
  const filter = {};
  if (['open', 'resolved'].includes(req.query.status)) filter.status = req.query.status;
  const disputes = await Dispute.find(filter)
    .sort({ status: 1, createdAt: -1 })
    .limit(200)
    .populate('raisedBy', 'name role')
    .populate('against', 'name role')
    .populate({ path: 'booking', select: 'category scheduledStart status customer provider' });
  res.json({ disputes });
};

exports.resolveDispute = async (req, res) => {
  const { outcome, adminNote } = req.body;
  const dispute = await Dispute.findById(req.params.id).populate('booking', 'category provider customer');
  if (!dispute) return res.status(404).json({ message: 'Dispute not found' });
  if (dispute.status === 'resolved') return res.status(409).json({ message: 'This dispute is already resolved' });

  dispute.status = 'resolved';
  dispute.outcome = outcome;
  dispute.adminNote = adminNote;
  dispute.resolvedBy = req.user._id;
  dispute.resolvedAt = new Date();
  await dispute.save();

  // The outcome may change the provider's score (provider_at_fault lowers the dispute signal)
  await recalculateForProvider(dispute.booking.provider);

  // Each side gets wording written for THEM. (Before, both received the same sentence, so a provider read a
  // message that sounded like it was meant for the customer.)
  const cat = dispute.booking.category;
  const link = `/bookings/${dispute.booking._id}`;
  const wording = {
    provider_at_fault: {
      customer: `The ${cat} problem you reported was decided in your favour.`,
      provider: `The ${cat} problem reported against you was decided against you. This lowers your dispute signal.`,
    },
    customer_at_fault: {
      customer: `The ${cat} problem you reported was decided in the provider's favour.`,
      provider: `The ${cat} problem reported against you was decided in your favour.`,
    },
    no_fault: {
      customer: `The ${cat} problem you reported was closed with no fault found.`,
      provider: `The ${cat} problem reported against you was closed with no fault found.`,
    },
  }[outcome];
  await notify(dispute.booking.customer, 'dispute', wording.customer, link);
  await notify(dispute.booking.provider, 'dispute', wording.provider, link);

  res.json({ dispute });
};
