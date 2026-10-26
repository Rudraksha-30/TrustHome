const ProviderProfile = require('../models/ProviderProfile');
const Booking = require('../models/Booking');
const Review = require('../models/Review');
const Dispute = require('../models/Dispute');
const { summariesForProviders } = require('../services/availability.service');
const { assessProvider, THRESHOLDS } = require('../services/qualityReport');

const DAY = 24 * 60 * 60 * 1000;
const round1 = (x) => Math.round(x * 10) / 10;

// Point 2: the quality inspector's report. Read-only: it never changes anything about a provider.
//
// It reads the records with simple queries and totals them in code. That is fine for the size of this project
// and runs the same on any MongoDB-compatible database; a large platform would use database aggregations.
exports.report = async (req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);

  const profiles = await ProviderProfile.find().populate('user', 'name');
  const ids = profiles.map((p) => p.user && p.user._id).filter(Boolean);

  const [bookings, reviews, disputes, availability] = await Promise.all([
    Booking.find({ provider: { $in: ids }, status: { $in: ['completed', 'cancelled'] } })
      .select('provider status cancelledByRole respondedAt')
      .lean(),
    Review.find({ provider: { $in: ids } }).select('provider rating createdAt').lean(),
    Dispute.find({ against: { $in: ids } }).select('against status outcome').lean(),
    summariesForProviders(ids, days, now),
  ]);

  const byProvider = (rows, key) => {
    const map = new Map();
    for (const r of rows) {
      const k = String(r[key]);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return map;
  };
  const bookingsBy = byProvider(bookings, 'provider');
  const reviewsBy = byProvider(reviews, 'provider');
  const disputesBy = byProvider(disputes, 'against');

  const rows = profiles
    .filter((p) => p.user)
    .map((p) => {
      const id = String(p.user._id);
      const myBookings = bookingsBy.get(id) || [];
      const myReviews = reviewsBy.get(id) || [];
      const myDisputes = disputesBy.get(id) || [];
      const avail = availability.get(id);

      const completedCount = myBookings.filter((b) => b.status === 'completed').length;
      // Same definition as the trust score: only a cancellation AFTER the provider accepted counts against them.
      const providerCancelledCount = myBookings.filter(
        (b) => b.status === 'cancelled' && b.cancelledByRole === 'provider' && b.respondedAt
      ).length;

      const recent = myReviews.filter((r) => new Date(r.createdAt) >= since);
      const avg = (list) => (list.length ? round1(list.reduce((s, r) => s + r.rating, 0) / list.length) : null);

      const disputesUpheld = myDisputes.filter((d) => d.status === 'resolved' && d.outcome === 'provider_at_fault').length;
      const openDisputes = myDisputes.filter((d) => d.status === 'open').length;

      const trust = p.trust || {};
      const responseTimeScore = trust.breakdown?.responseTime?.value ?? null;
      const trackedHours = Math.round(avail.trackedMs / 3600000);

      const assessment = assessProvider({
        trustScore: trust.score ?? 50,
        isNewProvider: trust.isNewProvider !== false,
        completedCount,
        providerCancelledCount,
        recentRatingAvg: avg(recent),
        recentReviewCount: recent.length,
        responseTimeScore,
        disputesUpheld,
        unavailablePct: avail.unavailablePct,
        trackedHours,
      });

      const accepted = completedCount + providerCancelledCount;
      return {
        profileId: p._id,
        name: p.user.name,
        serviceArea: p.serviceArea || '',
        categories: p.categories,
        isVerified: p.isVerified,
        isAvailable: p.isAvailable === true,
        isListed: p.isActive !== false && p.isAvailable === true,
        trust: { score: trust.score ?? 50, isNewProvider: trust.isNewProvider !== false, reviewCount: trust.reviewCount ?? 0 },
        completedCount,
        providerCancelledCount,
        cancellationRate: accepted > 0 ? round1((providerCancelledCount / accepted) * 100) : null,
        averageRating: avg(myReviews),
        recentRating: { average: avg(recent), count: recent.length },
        disputes: { upheld: disputesUpheld, open: openDisputes },
        availability: {
          availablePct: avail.availablePct,
          unavailablePct: avail.unavailablePct,
          unavailableMinutes: avail.unavailableMinutes,
          trackedMinutes: Math.round(avail.trackedMs / 60000),
        },
        flags: assessment.flags,
        riskScore: assessment.riskScore,
        level: assessment.level,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore || a.trust.score - b.trust.score);

  res.json({
    days,
    generatedAt: now,
    thresholds: THRESHOLDS,
    totals: {
      providers: rows.length,
      high: rows.filter((r) => r.level === 'high').length,
      medium: rows.filter((r) => r.level === 'medium').length,
      low: rows.filter((r) => r.level === 'low').length,
    },
    providers: rows,
  });
};
