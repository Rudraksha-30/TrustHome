/**
 * Database-facing half of the availability feature (the pure maths is in availability.js).
 *
 *   setAvailability()  flips the provider's switch and records the change in the log
 *   getAvailability()  reads the log back and summarises it for a dashboard
 */

const ProviderProfile = require('../models/ProviderProfile');
const AvailabilityLog = require('../models/AvailabilityLog');
const { summarizeAvailability } = require('./availability');

const DAY = 24 * 60 * 60 * 1000;

/** Open a new session of `state` for this provider (and make sure no other session is left open). */
async function openSession(providerUserId, state, at = new Date()) {
  await AvailabilityLog.updateMany({ provider: providerUserId, endedAt: null }, { endedAt: at });
  return AvailabilityLog.create({ provider: providerUserId, state, startedAt: at });
}

/** Make sure a provider has at least one session (new accounts, and old accounts from before this feature). */
async function ensureLogStarted(providerUserId, isAvailable, at = new Date()) {
  const exists = await AvailabilityLog.exists({ provider: providerUserId });
  if (!exists) await openSession(providerUserId, isAvailable ? 'available' : 'unavailable', at);
}

/**
 * Turn availability on or off.
 * Returns { changed, profile } or { error, missing } when the listing is not complete enough to go live.
 */
async function setAvailability(providerUserId, wantAvailable) {
  const profile = await ProviderProfile.findOne({ user: providerUserId });
  if (!profile) return { error: 'no_profile' };

  if (wantAvailable) {
    const missing = profile.missingForListing();
    if (missing.length > 0) return { error: 'incomplete', missing };
  }

  // Already in the requested state: nothing to record (stops double-clicks from creating empty sessions).
  if (profile.isAvailable === wantAvailable) {
    await ensureLogStarted(providerUserId, profile.isAvailable);
    return { changed: false, profile };
  }

  profile.isAvailable = wantAvailable;
  await profile.save();
  await openSession(providerUserId, wantAvailable ? 'available' : 'unavailable');
  return { changed: true, profile };
}

/** Summary for the last `days` days plus the most recent sessions, for one provider. */
async function getAvailability(providerUserId, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * DAY);
  const sessions = await AvailabilityLog.find({ provider: providerUserId }).sort({ startedAt: -1 }).limit(500);
  const plain = sessions.map((s) => ({ state: s.state, startedAt: s.startedAt, endedAt: s.endedAt }));

  const current = plain.find((s) => s.endedAt === null) || null;
  return {
    days,
    current: current ? { state: current.state, since: current.startedAt } : null,
    summary: summarizeAvailability(plain, from, now, now),
    recent: plain.slice(0, 10),
  };
}

/** Same summary for many providers at once (used by the quality report). Returns Map<userId, summary>. */
async function summariesForProviders(providerUserIds, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * DAY);
  const logs = await AvailabilityLog.find({
    provider: { $in: providerUserIds },
    $or: [{ endedAt: null }, { endedAt: { $gte: from } }],
  });
  const byProvider = new Map();
  for (const l of logs) {
    const key = String(l.provider);
    if (!byProvider.has(key)) byProvider.set(key, []);
    byProvider.get(key).push({ state: l.state, startedAt: l.startedAt, endedAt: l.endedAt });
  }
  const out = new Map();
  for (const id of providerUserIds) {
    out.set(String(id), summarizeAvailability(byProvider.get(String(id)) || [], from, now, now));
  }
  return out;
}

module.exports = { setAvailability, getAvailability, summariesForProviders, ensureLogStarted, openSession };
