const mongoose = require('mongoose');

// One row per stretch of time a provider spent "available" or "not available".
// The row with endedAt = null is the current one. The maths lives in services/availability.js.
const availabilityLogSchema = new mongoose.Schema(
  {
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    state: { type: String, enum: ['available', 'unavailable'], required: true },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: false }
);

availabilityLogSchema.index({ provider: 1, startedAt: -1 });

module.exports = mongoose.model('AvailabilityLog', availabilityLogSchema);
