const Booking = require('../models/Booking');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const { notify } = require('../services/notify');

/** Chat is private to the two parties of a booking. */
async function loadBookingForParty(req, res) {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404).json({ message: 'Booking not found' });
    return null;
  }
  const uid = req.user._id.toString();
  if (![booking.customer, booking.provider].some((id) => id.toString() === uid)) {
    res.status(403).json({ message: 'This chat is only for the customer and provider of this booking' });
    return null;
  }
  return booking;
}

// FR-22
// `after` is compared with updatedAt (not createdAt), so a message that was edited or deleted after the
// other person last looked is sent again, and their screen updates to match.
exports.list = async (req, res) => {
  const booking = await loadBookingForParty(req, res);
  if (!booking) return;
  const filter = { booking: booking._id };
  if (req.query.after) {
    const after = new Date(req.query.after);
    if (!Number.isNaN(after.getTime())) filter.updatedAt = { $gt: after };
  }
  const messages = await Message.find(filter).sort({ createdAt: 1 }).limit(300).populate('sender', 'name');
  res.json({ messages });
};

exports.send = async (req, res) => {
  const booking = await loadBookingForParty(req, res);
  if (!booking) return;

  const message = await Message.create({ booking: booking._id, sender: req.user._id, text: req.body.text });
  const populated = await message.populate('sender', 'name');

  // One unread "new message" notification per thread, so a busy chat doesn't flood the bell
  const recipient = booking.customer.toString() === req.user._id.toString() ? booking.provider : booking.customer;
  const link = `/bookings/${booking._id}`;
  const alreadyUnread = await Notification.exists({ user: recipient, type: 'message', link, read: false });
  if (!alreadyUnread) await notify(recipient, 'message', `New message from ${req.user.name}`, link);

  res.status(201).json({ message: populated });
};

/** Only the person who wrote a message may change it. */
async function loadOwnMessage(req, res) {
  const booking = await loadBookingForParty(req, res);
  if (!booking) return null;
  const message = await Message.findOne({ _id: req.params.messageId, booking: booking._id });
  if (!message) {
    res.status(404).json({ message: 'Message not found' });
    return null;
  }
  if (message.sender.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: 'You can only change your own messages' });
    return null;
  }
  return message;
}

// Point 3: edit a message you sent
exports.edit = async (req, res) => {
  const message = await loadOwnMessage(req, res);
  if (!message) return;
  if (message.deletedAt) return res.status(409).json({ message: 'A deleted message cannot be edited' });

  message.text = req.body.text;
  message.editedAt = new Date();
  await message.save();
  res.json({ message: await message.populate('sender', 'name') });
};

// Point 3: delete a message you sent. The text is erased; a placeholder stays so the conversation still reads correctly.
exports.remove = async (req, res) => {
  const message = await loadOwnMessage(req, res);
  if (!message) return;
  if (!message.deletedAt) {
    message.text = undefined;
    message.deletedAt = new Date();
    await message.save();
  }
  res.json({ message: await message.populate('sender', 'name') });
};
