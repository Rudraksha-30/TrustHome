const mongoose = require('mongoose');

const providerProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    headline: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    categories: { type: [String], default: [], index: true }, // keys from services/serviceCatalog.js
    serviceArea: { type: String, trim: true, index: true }, // city / pincode for the MVP
    priceMin: { type: Number, min: 0 },
    priceMax: { type: Number, min: 0 },

    // Two separate switches on purpose:
    //   isActive    - the listing exists and has not been switched off (kept from the first version)
    //   isAvailable - the provider's own "I am taking bookings right now" toggle (default OFF).
    //                 Customers see a provider only while BOTH are true.
    isActive: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: false, index: true },

    // The customer does not choose how long a job takes (they cannot know). The provider decides how much
    // time each booking blocks in their calendar, and that is what the double-booking check uses.
    slotMinutes: { type: Number, default: 60, min: 30, max: 480 },

    isVerified: { type: Boolean, default: false }, // FR-25: set by admin

    // Denormalised trust score snapshot. It is recalculated by the trust score
    // service whenever a review/booking changes (FR-19) and stored here so that
    // listing/search pages can sort by it cheaply (NFR-2).
    trust: {
      score: { type: Number, default: 50 },
      isNewProvider: { type: Boolean, default: true },
      reviewCount: { type: Number, default: 0 },
      breakdown: { type: mongoose.Schema.Types.Mixed, default: null },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

/** True when a customer is allowed to see and book this provider. */
providerProfileSchema.methods.isListed = function isListed() {
  return this.isActive !== false && this.isAvailable === true;
};

/** What a provider must fill in before they can switch availability on. Returns the missing items. */
providerProfileSchema.methods.missingForListing = function missingForListing() {
  const missing = [];
  if (!this.headline) missing.push('a headline');
  if (!this.categories || this.categories.length === 0) missing.push('at least one service');
  if (!this.serviceArea) missing.push('your city or area');
  return missing;
};

module.exports = mongoose.model('ProviderProfile', providerProfileSchema);
