const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const { signToken } = require('../middleware/auth');
const { ensureLogStarted } = require('../services/availability.service');

// FR-1: register as customer or provider. Admin accounts are never self-registered.
exports.register = async (req, res) => {
  const { name, email, password, phone, role } = req.body;

  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ message: 'An account with this email already exists' });

  const user = await User.create({ name, email, password, phone, role });

  // Providers get an empty profile straight away so the trust score has a home. They start as "not available"
  // (customers do not see them) until they finish their listing and switch availability on.
  if (user.role === 'provider') {
    await ProviderProfile.create({ user: user._id });
    await ensureLogStarted(user._id, false);
  }

  res.status(201).json({ token: signToken(user), user });
};

// FR-3
exports.login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');

  // Same message for "no such user" and "wrong password" so attackers can't probe for emails
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Incorrect email or password' });
  }
  res.json({ token: signToken(user), user });
};

exports.me = async (req, res) => {
  res.json({ user: req.user });
};

// FR-5
exports.updateMe = async (req, res) => {
  const { name, phone } = req.body;
  if (name !== undefined) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  await req.user.save();
  res.json({ user: req.user });
};
