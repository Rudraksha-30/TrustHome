const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    // unique: true enforces FR-18 at the database level (one review per booking),
    // so even two simultaneous requests cannot create duplicates.
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 500 },
    editedAt: { type: Date, default: null }, // set when the customer changes their review (point 1)
  },
  { timestamps: true }
);

module.exports = mongoose.model('Review', reviewSchema);
