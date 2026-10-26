// Small display helpers shared by several pages.

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return fmtDate(iso);
}

export const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

export function priceRange(min, max) {
  if (min == null && max == null) return 'Price on request';
  if (min != null && max != null && min !== max) return `${money(min)} to ${money(max)}`;
  return `From ${money(min ?? max)}`;
}

export const categoryLabel = (c) => c.replace(/-/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase());

export const STATUS_LABEL = {
  requested: 'Requested',
  accepted: 'Accepted',
  in_progress: 'In progress',
  completed: 'Completed',
  rejected: 'Declined',
  cancelled: 'Cancelled',
};

// Plain-language names for the four signals behind the trust score, in formula order.
// Weights mirror server/src/services/trustScore.js (WEIGHTS).
export const SIGNALS = [
  { key: 'completion', label: 'Finishes the jobs they accept', weight: 40, hint: 'Completed jobs compared with jobs the provider cancelled after accepting.' },
  { key: 'rating', label: 'Customer ratings', weight: 30, hint: 'Average of all reviews. Recent reviews count more than old ones.' },
  { key: 'responseTime', label: 'Replies quickly', weight: 20, hint: 'How fast they accept or decline a request. Within 30 minutes is a full score.' },
  { key: 'disputes', label: 'No disputes upheld against them', weight: 10, hint: 'Falls only when an admin rules a dispute against the provider.' },
];

export function scoreTone(score, isNew) {
  if (isNew) return 'new';
  if (score >= 75) return 'good';
  if (score >= 55) return 'ok';
  return 'low';
}

export const toneWord = { good: 'Highly trusted', ok: 'Building trust', low: 'Low trust', new: 'New provider' };

// <input type="datetime-local"> wants local time as YYYY-MM-DDTHH:mm
export function localInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const homeFor = (user) => (user?.role === 'admin' ? '/admin' : user?.role === 'inspector' ? '/inspector' : user?.role === 'provider' ? '/bookings' : '/providers');

/** Shrink big phone photos in the browser before upload (keeps them well under the server's 5 MB limit). */
export async function prepareImage(file, maxSide = 1600) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // cannot decode (e.g. HEIC): let the server explain
  }
}

export const fmtMinutes = (m) => {
  if (m == null) return '-';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mins = m % 60;
  if (h < 24) return mins ? `${h} h ${mins} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
};
