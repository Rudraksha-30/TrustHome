const mongoose = require('mongoose');

// Point 13: photos and videos attached to a booking.
//   kind 'problem' = added by the customer (what needs fixing)
//   kind 'work'    = added by the provider (the work done)
// The file bytes live in `data`. They are stored in MongoDB (not on the server's disk) because hosts such as
// Render's free tier erase the disk on every restart. `select: false` keeps the bytes out of normal queries.
const mediaSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['problem', 'work'], required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    filename: { type: String, default: 'attachment' },
    data: { type: Buffer, required: true, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Media', mediaSchema);
