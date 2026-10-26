const mongoose = require('mongoose');

// FR-22: one chat thread per booking. Messages belong to a booking and are only visible to its two parties.
// Point 3: a sender can edit or delete their own messages.
const messageSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // A deleted message keeps its place in the thread ("This message was deleted") but its text is erased.
    text: { type: String, trim: true, maxlength: 1000, required: function needsText() { return !this.deletedAt; } },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.deleted = Boolean(ret.deletedAt);
    if (ret.deleted) ret.text = '';
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Message', messageSchema);
