/**
 * Brings data created by an older version of the app up to date. Runs every time the server starts and is
 * safe to run again and again (it only touches records that are missing the new fields).
 *
 * Why it is needed: providers saved before the availability switch existed have no `isAvailable` field, so the
 * customer list (which now filters on it) would suddenly show nobody. We keep them listed exactly as before.
 */

const ProviderProfile = require('../models/ProviderProfile');
const { ensureLogStarted } = require('./availability.service');

async function migrate() {
  // Providers who were visible before stay visible; hidden ones stay hidden.
  const shown = await ProviderProfile.updateMany({ isAvailable: { $exists: false }, isActive: { $ne: false } }, { $set: { isAvailable: true } });
  const hidden = await ProviderProfile.updateMany({ isAvailable: { $exists: false }, isActive: false }, { $set: { isAvailable: false } });

  // Start the availability record for every provider that has none (tracking begins now, not in the past).
  const profiles = await ProviderProfile.find().select('user isAvailable');
  for (const p of profiles) await ensureLogStarted(p.user, p.isAvailable === true);

  const changed = (shown.modifiedCount || 0) + (hidden.modifiedCount || 0);
  if (changed > 0) console.log(`Migration: added the availability switch to ${changed} existing provider(s).`);
}

module.exports = { migrate };
