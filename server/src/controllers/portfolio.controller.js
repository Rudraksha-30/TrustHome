const jwt = require('jsonwebtoken');
const ProviderProfile = require('../models/ProviderProfile');
const PortfolioItem = require('../models/PortfolioItem');
const { sniffMedia, cleanFilename, LIMITS } = require('../utils/sniffMedia');

const MAX_PORTFOLIO_PHOTOS = 12;

// Same idea as booking files: <img> cannot send a login header, so each photo gets a 1-hour signed address.
// A separate "portfolio" audience means a booking-file address can never open a portfolio photo or vice versa.
function photoUrl(id) {
  const t = jwt.sign({ item: String(id) }, process.env.JWT_SECRET, { expiresIn: '1h', audience: 'portfolio' });
  return `/api/portfolio/${id}/file?t=${encodeURIComponent(t)}`;
}

const present = (item) => ({ _id: item._id, caption: item.caption, createdAt: item.createdAt, url: photoUrl(item._id) });

// Public to signed-in viewers, so customers can see a provider's work. Providers may only open their own.
exports.list = async (req, res) => {
  const profile = await ProviderProfile.findById(req.params.profileId).select('user');
  if (!profile) return res.status(404).json({ message: 'Provider not found' });
  if (req.user.role === 'provider' && profile.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'You can only view your own portfolio' });
  }
  const items = await PortfolioItem.find({ provider: profile.user }).sort({ createdAt: -1 });
  res.json({ photos: items.map(present), max: MAX_PORTFOLIO_PHOTOS, maxMB: LIMITS.image / 1048576 });
};

// Raw image as the request body (same approach as booking files).
exports.add = async (req, res) => {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('image/')) {
    return res.status(415).json({ message: 'Only JPG, PNG, WebP or GIF photos can be added to your portfolio.' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ message: 'No photo was received. Choose a photo.' });
  }
  const found = sniffMedia(req.body);
  if (!found || found.kind !== 'image') {
    return res.status(415).json({ message: 'Only JPG, PNG, WebP or GIF photos can be added to your portfolio.' });
  }
  const declared = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!declared.startsWith('image/')) return res.status(415).json({ message: 'The file does not match its type. Choose the photo again.' });
  if (req.body.length > LIMITS.image) {
    return res.status(413).json({ message: `That photo is too large. Photos can be up to ${LIMITS.image / 1048576} MB.` });
  }
  if ((await PortfolioItem.countDocuments({ provider: req.user._id })) >= MAX_PORTFOLIO_PHOTOS) {
    return res.status(409).json({ message: `Your portfolio can hold ${MAX_PORTFOLIO_PHOTOS} photos. Remove one to add another.` });
  }
  const caption = cleanFilename(req.headers['x-caption'], '').slice(0, 120);
  const item = await PortfolioItem.create({ provider: req.user._id, caption, mimeType: found.mime, size: req.body.length, data: req.body });
  res.status(201).json({ photo: present(item) });
};

exports.updateCaption = async (req, res) => {
  const item = await PortfolioItem.findOne({ _id: req.params.itemId, provider: req.user._id });
  if (!item) return res.status(404).json({ message: 'Photo not found' });
  item.caption = req.body.caption;
  await item.save();
  res.json({ photo: present(item) });
};

exports.remove = async (req, res) => {
  const item = await PortfolioItem.findOne({ _id: req.params.itemId, provider: req.user._id }).select('_id');
  if (!item) return res.status(404).json({ message: 'Photo not found' });
  await item.deleteOne();
  res.json({ deleted: true });
};

exports.file = async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET, { audience: 'portfolio' });
  } catch {
    return res.status(401).json({ message: 'This photo address has expired. Reload the page.' });
  }
  if (payload.item !== req.params.id) return res.status(401).json({ message: 'This address is not valid for this photo.' });
  const item = await PortfolioItem.findById(req.params.id).select('+data');
  if (!item) return res.status(404).json({ message: 'Photo not found' });
  res.set({
    'Content-Type': item.mimeType,
    'Content-Length': item.data.length,
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=3600',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.end(item.data);
};
