const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    // password is excluded from query results by default (NFR-8)
    password: { type: String, required: true, minlength: 8, select: false },
    // admin and inspector accounts are never created through sign-up (see scripts/seedAdmin.js, seedInspector.js)
    role: { type: String, enum: ['customer', 'provider', 'admin', 'inspector'], default: 'customer' },
  },
  { timestamps: true }
);

// FR-2 / NFR-5: hash before saving, never store plaintext
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

// NFR-8: never leak the password hash in API responses
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
