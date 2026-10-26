const Booking = require('../models/Booking');
const User = require('../models/User');
const Review = require('../models/Review');
const Dispute = require('../models/Dispute');
const ProviderProfile = require('../models/ProviderProfile');
const { STATUS, canTransition, isValidTransition, SLOT_BLOCKING_STATUSES } = require('../services/bookingStateMachine');
const { addMinutes } = require('../utils/timeSlots');
const { recalculateForProvider } = require('../services/trustScore.service');
const { notify } = require('../services/notify');

/**
 * Is the provider free for [start, end)?
 * Overlap in SQL-ish terms:  existing.start < end  AND  existing.end > start
 */
async function providerHasConflict(providerId, start, end, excludeBookingId = null) {
  const query = {
    provider: providerId,
    status: { $in: SLOT_BLOCKING_STATUSES },
    scheduledStart: { $lt: end },
    scheduledEnd: { $gt: start },
  };
  if (excludeBookingId) query._id = { $ne: excludeBookingId };
  return Boolean(await Booking.exists(query));
}

/** Adds `reviewed` and `disputeOpen` flags so the client knows which buttons to show. */
async function withFlags(bookings) {
  const ids = bookings.map((b) => b._id);
  const [reviews, disputes] = await Promise.all([
    Review.find({ booking: { $in: ids } }).select('booking'),
    Dispute.find({ booking: { $in: ids }, status: 'open' }).select('booking'),
  ]);
  const reviewed = new Set(reviews.map((r) => String(r.booking)));
  const disputed = new Set(disputes.map((d) => String(d.booking)));
  return bookings.map((b) => ({
    ...b.toJSON(),
    reviewed: reviewed.has(String(b._id)),
    disputeOpen: disputed.has(String(b._id)),
  }));
}

const STATUS_LABEL = {
  accepted: 'accepted',
  rejected: 'declined',
  in_progress: 'started',
  completed: 'marked as completed',
  cancelled: 'cancelled',
};

// FR-11
exports.createBooking = async (req, res) => {
  // Note: there is no duration in the request. A customer cannot know how long a job will take,
  // so the time blocked in the provider's calendar is the provider's own setting (slotMinutes).
  const { providerId, category, scheduledStart, notes, address } = req.body;

  const providerUser = await User.findOne({ _id: providerId, role: 'provider' });
  const profile = providerUser && (await ProviderProfile.findOne({ user: providerUser._id }));
  if (!profile || !profile.isActive) return res.status(404).json({ message: 'Provider not found' });

  // Point 8: a provider who switched to "Not available" cannot receive new requests.
  if (!profile.isAvailable) {
    return res.status(409).json({ message: `${providerUser.name} is not taking bookings right now. Please choose another provider.` });
  }

  const cat = String(category).trim().toLowerCase();
  if (!profile.categories.includes(cat)) {
    return res.status(400).json({ message: `This provider does not offer "${cat}"` });
  }

  const start = new Date(scheduledStart);
  if (start <= new Date()) {
    return res.status(400).json({ message: 'Please choose a time in the future' });
  }
  const durationMinutes = profile.slotMinutes || 60;
  const end = addMinutes(start, durationMinutes);

  // FR-15: friendly early check. The authoritative check runs again at accept time.
  if (await providerHasConflict(providerUser._id, start, end)) {
    return res.status(409).json({ message: 'This time slot is already booked' }); // NFR-10
  }

  const booking = await Booking.create({
    customer: req.user._id,
    provider: providerUser._id,
    category: cat,
    scheduledStart: start,
    durationMinutes,
    scheduledEnd: end,
    notes,
    address,
    statusHistory: [{ status: STATUS.REQUESTED, by: req.user._id }],
  });

  // FR-12: tell the provider
  await notify(
    providerUser._id,
    'booking',
    `New ${cat} booking request from ${req.user.name}`,
    `/bookings/${booking._id}`
  );

  res.status(201).json({ booking });
};

// Customers see their bookings, providers see theirs
exports.listMyBookings = async (req, res) => {
  const filter = req.user.role === 'provider' ? { provider: req.user._id } : { customer: req.user._id };
  if (req.query.status) filter.status = String(req.query.status);

  const bookings = await Booking.find(filter)
    .sort({ scheduledStart: -1 })
    .limit(200)
    .populate('customer', 'name phone')
    .populate('provider', 'name');
  res.json({ bookings: await withFlags(bookings) });
};

exports.getBooking = async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate('customer', 'name phone')
    .populate('provider', 'name');
  if (!booking) return res.status(404).json({ message: 'Booking not found' });

  const uid = req.user._id.toString();
  const isParty = [booking.customer._id, booking.provider._id].some((id) => id.toString() === uid);
  if (!isParty && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'You do not have permission to view this booking' });
  }
  const [withFlag] = await withFlags([booking]);
  res.json({ booking: withFlag });
};

// FR-13, FR-14, FR-16: every status change goes through the state machine
exports.updateStatus = async (req, res) => {
  const { status: next, reason } = req.body;
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ message: 'Booking not found' });

  const uid = req.user._id.toString();
  const isCustomer = booking.customer.toString() === uid;
  const isProvider = booking.provider.toString() === uid;
  if (!isCustomer && !isProvider) {
    return res.status(403).json({ message: 'This is not your booking' });
  }
  const actorRole = isProvider ? 'provider' : 'customer';

  if (!isValidTransition(booking.status, next)) {
    return res.status(409).json({ message: `A booking that is "${booking.status}" cannot become "${next}"` });
  }
  if (!canTransition(booking.status, next, actorRole)) {
    return res.status(403).json({ message: `A ${actorRole} cannot change a booking to "${next}"` });
  }

  // Authoritative double-booking check (FR-15 / NFR-3) at the moment of acceptance
  if (next === STATUS.ACCEPTED) {
    const conflict = await providerHasConflict(
      booking.provider,
      booking.scheduledStart,
      booking.scheduledEnd,
      booking._id
    );
    if (conflict) {
      return res.status(409).json({ message: 'You already have a booking that overlaps this time slot' });
    }
  }

  if (next === STATUS.ACCEPTED || next === STATUS.REJECTED) booking.respondedAt = new Date();
  if (next === STATUS.CANCELLED) {
    booking.cancelledByRole = actorRole;
    booking.cancelReason = reason; // FR-16: reason is logged
  }

  booking.status = next;
  booking.statusHistory.push({ status: next, by: req.user._id });
  await booking.save();

  // FR-12: tell the other party
  const other = isProvider ? booking.customer : booking.provider;
  await notify(
    other,
    'booking',
    `${req.user.name} ${STATUS_LABEL[next] || next} your ${booking.category} booking`,
    `/bookings/${booking._id}`
  );

  // FR-19: events that change a provider's reliability record trigger a recalculation
  const affectsTrust =
    next === STATUS.COMPLETED ||
    next === STATUS.ACCEPTED ||
    next === STATUS.REJECTED ||
    (next === STATUS.CANCELLED && actorRole === 'provider');
  if (affectsTrust) await recalculateForProvider(booking.provider);

  res.json({ booking });
};
