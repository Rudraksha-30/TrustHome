/**
 * The fixed list of services (the "specific keywords").
 *
 * Providers choose their services from this list and customers search by choosing from it, so both sides
 * always use the same words. Before this, a provider could type "drainage" and a customer could type
 * "drain cleaning" and never find each other. A controlled vocabulary fixes that.
 *
 * To offer a new service, add one line here. Nothing else needs to change.
 */

const SERVICES = Object.freeze([
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'carpentry', label: 'Carpentry' },
  { key: 'cleaning', label: 'Home cleaning' },
  { key: 'ac-repair', label: 'AC repair' },
  { key: 'appliance-repair', label: 'Appliance repair' },
  { key: 'painting', label: 'Painting' },
  { key: 'pest-control', label: 'Pest control' },
  { key: 'tutoring', label: 'Tutoring' },
  { key: 'gardening', label: 'Gardening' },
  { key: 'salon-at-home', label: 'Salon at home' },
  { key: 'moving-help', label: 'Moving and packing' },
]);

const KEYS = SERVICES.map((s) => s.key);

const isValidService = (key) => KEYS.includes(key);

/** Lower-case and trim, so " Plumbing " is accepted as "plumbing". */
const normalizeKey = (value) => String(value ?? '').trim().toLowerCase();

const labelFor = (key) => SERVICES.find((s) => s.key === key)?.label ?? key;

module.exports = { SERVICES, KEYS, isValidService, normalizeKey, labelFor };
