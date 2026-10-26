const jwt = require('jsonwebtoken');
const Booking = require('../models/Booking');
const Media = require('../models/Media');
const Dispute = require('../models/Dispute');
const Notification = require('../models/Notification');
const { notify } = require('../services/notify');
const { sniffMedia, cleanFilename, LIMITS, MAX_FILES_PER_BOOKING } = require('../utils/sniffMedia');

// Who may add files, and while the booking is in which states.
const UPLOAD_STATES = {
  customer: ['requested', 'accepted', 'in_progress', 'completed'],
  provider: ['accepted', 'in_progress', 'completed'],
};

const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * <img> and <video> tags cannot send an Authorization header, so each file gets a short-lived signed address.
 * The booking list (which IS protected) hands these out, and they stop working after an hour.
 * The "media" audience means a normal login token can never be used as a file address, or the other way round.
 */
function fileUrl(mediaId, viewerId) {
  const t = jwt.sign({ media: String(mediaId), uid: String(viewerId) }, process.env.JWT_SECRET, {
    expiresIn: '1h',
    audience: 'media',
  });
  return `/api/media/${mediaId}/file?t=${encodeURIComponent(t)}`;
}

function present(media, viewerId) {
  return {
    _id: media._id,
    kind: media.kind,
    mimeType: media.mimeType,
    mediaType: media.mimeType.startsWith('video/') ? 'video' : 'image',
    size: media.size,
    filename: media.filename,
    uploader: media.uploader && media.uploader.name ? { _id: media.uploader._id, name: media.uploader.name } : media.uploader,
    createdAt: media.createdAt,
    url: fileUrl(media._id, viewerId),
  };
}

async function loadBookingForViewer(req, res, { allowAdmin }) {
  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404).json({ message: 'Booking not found' });
    return null;
  }
  const uid = req.user._id.toString();
  const isCustomer = booking.customer.toString() === uid;
  const isProvider = booking.provider.toString() === uid;
  const isAdmin = allowAdmin && req.user.role === 'admin';
  if (!isCustomer && !isProvider && !isAdmin) {
    res.status(403).json({ message: 'You do not have permission to see the files on this booking' });
    return null;
  }
  return { booking, isCustomer, isProvider };
}

exports.list = async (req, res) => {
  const ctx = await loadBookingForViewer(req, res, { allowAdmin: true });
  if (!ctx) return;
  const items = await Media.find({ booking: ctx.booking._id }).sort({ createdAt: 1 }).populate('uploader', 'name');
  res.json({ media: items.map((m) => present(m, req.user._id)), limits: { imageMB: LIMITS.image / 1048576, videoMB: LIMITS.video / 1048576, maxFiles: MAX_FILES_PER_BOOKING } });
};

// The browser sends the file as the raw request body, with its type in Content-Type and its name in X-Filename.
exports.upload = async (req, res) => {
  const ctx = await loadBookingForViewer(req, res, { allowAdmin: false });
  if (!ctx) return;
  const { booking, isCustomer } = ctx;
  const role = isCustomer ? 'customer' : 'provider';

  if (!UPLOAD_STATES[role].includes(booking.status)) {
    return res.status(409).json({ message: `You cannot add files while the booking is "${booking.status}".` });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ message: 'No file was received. Choose a photo or a video.' });
  }

  // 1. What is it really? (Do not trust the declared type on its own.)
  const found = sniffMedia(req.body);
  if (!found) {
    return res.status(415).json({ message: 'Only JPG, PNG, WebP or GIF photos and MP4, MOV or WebM videos can be added.' });
  }
  const declared = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!declared.startsWith(`${found.kind}/`)) {
    return res.status(415).json({ message: 'The file does not match its type. Choose the photo or video again.' });
  }

  // 2. Is it small enough, and is there room on this booking?
  if (req.body.length > LIMITS[found.kind]) {
    return res.status(413).json({
      message: `That ${found.kind} is ${mb(req.body.length)}. ${found.kind === 'image' ? 'Photos' : 'Videos'} can be up to ${mb(LIMITS[found.kind])}.`,
    });
  }
  if ((await Media.countDocuments({ booking: booking._id })) >= MAX_FILES_PER_BOOKING) {
    return res.status(409).json({ message: `A booking can hold up to ${MAX_FILES_PER_BOOKING} files. Delete one to add another.` });
  }

  const media = await Media.create({
    booking: booking._id,
    uploader: req.user._id,
    kind: isCustomer ? 'problem' : 'work',
    mimeType: found.mime,
    size: req.body.length,
    filename: cleanFilename(req.headers['x-filename'], found.kind === 'video' ? 'video' : 'photo'),
    data: req.body,
  });

  // Tell the other person. One unread "files added" notification per booking, so a batch of photos is one alert.
  const recipient = isCustomer ? booking.provider : booking.customer;
  const link = `/bookings/${booking._id}`;
  if (!(await Notification.exists({ user: recipient, type: 'media', link, read: false }))) {
    await notify(recipient, 'media', `${req.user.name} added ${found.kind === 'video' ? 'a video' : 'a photo'} to the ${booking.category} booking`, link);
  }

  const populated = await media.populate('uploader', 'name');
  res.status(201).json({ media: present(populated, req.user._id) });
};

// The file itself. Protected by the signed address, not a login header (see fileUrl).
exports.file = async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET, { audience: 'media' });
  } catch {
    return res.status(401).json({ message: 'This file address has expired. Reload the booking page.' });
  }
  if (payload.media !== req.params.id) return res.status(401).json({ message: 'This file address is not valid for this file.' });

  const media = await Media.findById(req.params.id).select('+data');
  if (!media) return res.status(404).json({ message: 'File not found' });

  const total = media.data.length;
  res.set({
    'Content-Type': media.mimeType,
    'Content-Disposition': 'inline',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    // helmet's default is same-origin, which would stop the website (a different address from the API) showing the file
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });

  // Browsers ask for video in slices ("Range") so the user can skip ahead.
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start;
    let end;
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {
        start = Math.max(0, total - Number(m[2])); // "the last N bytes"
        end = total - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
      }
    }
    if (start === undefined || start > end || start >= total) {
      res.set('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
    return res.end(media.data.subarray(start, end + 1));
  }
  res.set('Content-Length', total);
  return res.end(media.data);
};

// The person who added a file can remove it, unless the booking has an open dispute (the files may be evidence).
exports.remove = async (req, res) => {
  const media = await Media.findById(req.params.id);
  if (!media) return res.status(404).json({ message: 'File not found' });
  if (media.uploader.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'You can only remove files you added' });
  }
  if (await Dispute.exists({ booking: media.booking, status: 'open' })) {
    return res.status(409).json({ message: 'This booking has an open problem report, so files cannot be removed until an admin decides.' });
  }
  await media.deleteOne();
  res.json({ deleted: true });
};
