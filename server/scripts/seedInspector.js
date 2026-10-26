/**
 * Create (or promote) a quality inspector account. Inspectors cannot register through the website.
 *
 *   MONGO_URI=... INSPECTOR_EMAIL=qa@example.com INSPECTOR_PASSWORD=a-strong-password npm run seed:inspector
 */
const { seedStaff } = require('./lib/seedStaff');

seedStaff({ role: 'inspector', prefix: 'INSPECTOR', label: 'inspector', defaultName: 'Quality Inspector' });
