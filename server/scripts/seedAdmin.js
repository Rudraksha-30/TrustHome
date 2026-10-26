/**
 * Create (or promote) the admin account. Admins cannot register through the website.
 *
 *   MONGO_URI=... ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=a-strong-password npm run seed:admin
 */
const { seedStaff } = require('./lib/seedStaff');

seedStaff({ role: 'admin', prefix: 'ADMIN', label: 'admin', defaultName: 'Admin' });
