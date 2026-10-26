/**
 * Shared by seedAdmin.js and seedInspector.js: create a staff account, or promote/reset an existing one.
 * Staff accounts cannot be created through the website, so this is how they come into being.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../../src/models/User');

async function seedStaff({ role, prefix, label, defaultName }) {
  const { MONGO_URI } = process.env;
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  const name = process.env[`${prefix}_NAME`] || defaultName;

  try {
    if (!MONGO_URI) throw new Error('MONGO_URI is not set');
    if (!email || !password) throw new Error(`Set ${prefix}_EMAIL and ${prefix}_PASSWORD`);
    if (password.length < 8) throw new Error(`${prefix}_PASSWORD must be at least 8 characters`);

    await mongoose.connect(MONGO_URI);
    const clean = email.toLowerCase().trim();

    const existing = await User.findOne({ email: clean }).select('+password');
    if (existing) {
      existing.role = role;
      existing.password = password; // re-hashed by the model's pre-save hook
      await existing.save();
      console.log(`Updated ${clean}: role is now ${label} and the password was reset.`);
    } else {
      await User.create({ name, email: clean, password, role });
      console.log(`Created ${label} account ${clean}.`);
    }
    await mongoose.disconnect();
  } catch (err) {
    console.error(`seed:${label} failed:`, err.message);
    process.exit(1);
  }
}

module.exports = { seedStaff };
