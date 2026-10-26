const ProviderProfile = require('../models/ProviderProfile');
const { SERVICES, KEYS, isValidService, normalizeKey } = require('../services/serviceCatalog');
const { setAvailability, getAvailability, ensureLogStarted } = require('../services/availability.service');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cleanArea = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// What customers are allowed to see: active AND switched to "available" by the provider.
const LISTED = { isActive: true, isAvailable: true };

// FR-6 / FR-7: provider creates or edits their own listing
exports.upsertMyProfile = async (req, res) => {
  const allowed = ['headline', 'description', 'categories', 'serviceArea', 'priceMin', 'priceMax', 'slotMinutes', 'isActive'];
  const updates = {};
  for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];

  if (updates.categories) {
    // Only services from the fixed list are accepted, so customers can always find them by the same words.
    const cleaned = [...new Set(updates.categories.map(normalizeKey))];
    const unknown = cleaned.filter((c) => !isValidService(c));
    if (unknown.length > 0) {
      return res.status(400).json({ message: `Choose services from the list. Not recognised: ${unknown.join(', ')}` });
    }
    updates.categories = cleaned;
  }
  if (updates.serviceArea !== undefined) updates.serviceArea = cleanArea(updates.serviceArea);

  // isVerified, isAvailable and trust are NOT in the allow-list:
  // a provider cannot verify themselves, set their own score, or skip the availability log.
  const profile = await ProviderProfile.findOneAndUpdate({ user: req.user._id }, updates, {
    returnDocument: 'after',
    upsert: true,
    runValidators: true,
    setDefaultsOnInsert: true,
  });

  // A listing that no longer meets the minimum cannot stay switched on.
  if (profile.isAvailable && profile.missingForListing().length > 0) {
    await setAvailability(req.user._id, false);
    profile.isAvailable = false;
  }
  res.json({ profile });
};

exports.getMyProfile = async (req, res) => {
  const profile = await ProviderProfile.findOne({ user: req.user._id });
  if (profile) await ensureLogStarted(req.user._id, profile.isAvailable);
  res.json({ profile });
};

// Points 8 and 9: the Available / Not available switch, and how long it has been on each side.
exports.setMyAvailability = async (req, res) => {
  const result = await setAvailability(req.user._id, req.body.available);
  if (result.error === 'no_profile') return res.status(404).json({ message: 'Create your listing first' });
  if (result.error === 'incomplete') {
    return res.status(400).json({ message: `Before you go live, add ${result.missing.join(', ')} in My listing.` });
  }
  res.json({ profile: result.profile, changed: result.changed });
};

exports.getMyAvailability = async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const profile = await ProviderProfile.findOne({ user: req.user._id });
  if (!profile) return res.status(404).json({ message: 'Create your listing first' });
  await ensureLogStarted(req.user._id, profile.isAvailable);
  res.json({ isAvailable: profile.isAvailable, ...(await getAvailability(req.user._id, days)) });
};

// FR-8 / FR-9 / FR-10: browse and filter. Customers (and staff) only, sorted by trust score.
// There is no free-text search: customers pick a service from the fixed list and a city from the cities in use.
exports.listProviders = async (req, res) => {
  const { category, area } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));

  const filter = { ...LISTED };
  if (category !== undefined && category !== '') {
    const key = normalizeKey(category);
    if (!isValidService(key)) {
      return res.status(400).json({ message: 'Choose a service from the list.' });
    }
    filter.categories = key;
  }
  if (area) filter.serviceArea = new RegExp(`^${escapeRegex(cleanArea(area))}$`, 'i');

  const [providers, total] = await Promise.all([
    ProviderProfile.find(filter)
      .sort({ 'trust.score': -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'name'),
    ProviderProfile.countDocuments(filter),
  ]);

  res.json({ providers, page, limit, total, pages: Math.ceil(total / limit) });
};

// The full list of services (every signed-in role: the provider's listing form needs it too)
exports.getCatalog = async (_req, res) => {
  res.json({ services: SERVICES });
};

// Dropdown contents for customers: each service with how many listed providers offer it, plus the cities in use.
exports.getFilters = async (_req, res) => {
  const listed = await ProviderProfile.find(LISTED).select('categories serviceArea');

  const counts = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const areas = new Map(); // lower-case key -> { name, count }
  for (const p of listed) {
    for (const c of p.categories) if (c in counts) counts[c] += 1;
    if (p.serviceArea) {
      const key = p.serviceArea.toLowerCase();
      const entry = areas.get(key) || { name: p.serviceArea, count: 0 };
      entry.count += 1;
      areas.set(key, entry);
    }
  }
  res.json({
    services: SERVICES.map((s) => ({ ...s, count: counts[s.key] })),
    areas: [...areas.values()].sort((a, b) => a.name.localeCompare(b.name)),
  });
};

// One provider's public page. Customers can open it for any active provider (they may follow an old link or
// booking), but booking is only possible while the provider is available (the client shows that state).
exports.getProvider = async (req, res) => {
  const profile = await ProviderProfile.findById(req.params.id).populate('user', 'name');
  if (!profile) return res.status(404).json({ message: 'Provider not found' });

  const isOwner = req.user.role === 'provider' && String(profile.user._id) === String(req.user._id);
  if (req.user.role === 'provider' && !isOwner) {
    return res.status(403).json({ message: 'Providers can only open their own public page.' });
  }
  if (!profile.isActive && !isOwner && req.user.role === 'customer') {
    return res.status(404).json({ message: 'Provider not found' });
  }
  res.json({ profile });
};
