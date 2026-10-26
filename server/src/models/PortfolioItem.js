const mongoose = require('mongoose');

// A photo a provider chooses to show on their public page ("previous work").
// Deliberately separate from booking Media: booking files belong to two people and stay private to them,
// while portfolio photos are uploaded by the provider specifically to be seen by customers.
const portfolioItemSchema = new mongoose.Schema(
  {
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    caption: { type: String, trim: true, maxlength: 120, default: '' },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PortfolioItem', portfolioItemSchema);
