/**
 * Quality checks for one provider (PURE: no database). Used by the quality inspector's report (point 2).
 *
 * The inspector's question is "which providers need a closer look?". Each rule below raises a FLAG with a
 * weight; the weights add up to a risk score, and the score decides the risk level shown on the dashboard.
 * Every threshold is a named constant so it can be justified (and changed) in one place.
 *
 * Rules are about the provider's behaviour. They never change the Trust Score and never act on a provider:
 * the inspector only reads (that was the agreed scope).
 */

const THRESHOLDS = Object.freeze({
  LOW_TRUST_SCORE: 60, // below this (once they have a track record) is a concern
  LOW_RECENT_RATING: 3.5, // average of recent reviews out of 5
  MIN_RECENT_REVIEWS: 3, // do not judge a rating from fewer reviews than this
  HIGH_CANCELLATION_RATE: 0.2, // 20% of accepted jobs cancelled by the provider
  MIN_JOBS_FOR_RATE: 3, // do not judge a rate from fewer jobs than this
  SLOW_RESPONSE_SCORE: 40, // response-time signal (0 to 100) below this means slow replies
  OFTEN_UNAVAILABLE_PCT: 50, // switched off for more than half the tracked time
  MIN_TRACKED_HOURS: 72, // ...but only once we have at least 3 days of record
  HIGH_RISK_FROM: 5,
  MEDIUM_RISK_FROM: 2,
});

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * m = {
 *   trustScore, isNewProvider, completedCount, providerCancelledCount,
 *   recentRatingAvg (number|null), recentReviewCount,
 *   responseTimeScore (number|null), disputesUpheld, unavailablePct (number|null), trackedHours
 * }
 * Returns { flags: [{ code, label, detail, weight }], riskScore, level }
 */
function assessProvider(m) {
  const T = THRESHOLDS;
  const flags = [];

  if (!m.isNewProvider && m.trustScore < T.LOW_TRUST_SCORE) {
    flags.push({ code: 'low_trust', label: 'Low trust score', detail: `Score is ${m.trustScore}, below ${T.LOW_TRUST_SCORE}.`, weight: 3 });
  }

  if (m.recentReviewCount >= T.MIN_RECENT_REVIEWS && m.recentRatingAvg !== null && m.recentRatingAvg < T.LOW_RECENT_RATING) {
    flags.push({
      code: 'low_rating',
      label: 'Low recent ratings',
      detail: `Recent reviews average ${m.recentRatingAvg} out of 5 (${m.recentReviewCount} reviews).`,
      weight: 3,
    });
  }

  const accepted = m.completedCount + m.providerCancelledCount;
  if (accepted >= T.MIN_JOBS_FOR_RATE) {
    const rate = m.providerCancelledCount / accepted;
    if (rate >= T.HIGH_CANCELLATION_RATE) {
      flags.push({
        code: 'cancellations',
        label: 'Frequent cancellations',
        detail: `Cancelled ${m.providerCancelledCount} of ${accepted} accepted jobs (${pct(rate)}).`,
        weight: 2,
      });
    }
  }

  if (m.disputesUpheld >= 1) {
    flags.push({
      code: 'disputes',
      label: 'Disputes upheld',
      detail: `${m.disputesUpheld} ${m.disputesUpheld === 1 ? 'dispute was' : 'disputes were'} ruled against this provider.`,
      weight: 3,
    });
  }

  if (m.responseTimeScore !== null && m.responseTimeScore < T.SLOW_RESPONSE_SCORE) {
    flags.push({ code: 'slow_replies', label: 'Slow to respond', detail: `Response-time signal is ${m.responseTimeScore} out of 100.`, weight: 1 });
  }

  if (m.trackedHours >= T.MIN_TRACKED_HOURS && m.unavailablePct !== null && m.unavailablePct > T.OFTEN_UNAVAILABLE_PCT) {
    flags.push({ code: 'often_unavailable', label: 'Often unavailable', detail: `Switched off ${m.unavailablePct}% of the tracked time.`, weight: 1 });
  }

  const riskScore = flags.reduce((sum, f) => sum + f.weight, 0);
  const level = riskScore >= T.HIGH_RISK_FROM ? 'high' : riskScore >= T.MEDIUM_RISK_FROM ? 'medium' : 'low';
  return { flags, riskScore, level };
}

module.exports = { THRESHOLDS, assessProvider };
