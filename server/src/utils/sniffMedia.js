/**
 * Work out what a file REALLY is from its first bytes (PURE: no database, no Express).
 *
 * The browser tells us a file's type in a header, but a header can lie: someone could upload a web page
 * and call it "image/png". We read the "magic bytes" at the start of the file instead and only accept
 * the handful of formats a browser can show safely. SVG is deliberately NOT allowed (it can contain scripts).
 *
 * Returns { mime, kind } where kind is 'image' or 'video', or null if the file is not an accepted format.
 */

const LIMITS = Object.freeze({
  image: 5 * 1024 * 1024, // 5 MB: the website shrinks phone photos before uploading, so this is generous
  video: 15 * 1024 * 1024, // 15 MB: roughly a short clip. Stays under MongoDB's 16 MB document limit.
});
const MAX_FILES_PER_BOOKING = 12;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// "ftyp" brands that mean a still image (HEIC and friends), which browsers cannot show: refuse them.
const IMAGE_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis'];

function sniffMedia(buf) {
  if (!buf || buf.length < 12) return null;
  const ascii = (from, to) => buf.toString('latin1', from, to);

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', kind: 'image' };
  if (PNG_SIGNATURE.every((b, i) => buf[i] === b)) return { mime: 'image/png', kind: 'image' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { mime: 'image/gif', kind: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', kind: 'image' };

  // WebM (Matroska/EBML header)
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'video/webm', kind: 'video' };

  // MP4 and QuickTime (.mov) both start with a size, then "ftyp", then a 4-letter brand
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (IMAGE_BRANDS.includes(brand)) return null;
    if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video' };
    return { mime: 'video/mp4', kind: 'video' };
  }
  return null;
}

/** A safe display name: no folders, no odd characters, never empty. */
function cleanFilename(raw, fallback = 'attachment') {
  let name = '';
  try {
    name = decodeURIComponent(String(raw || ''));
  } catch {
    name = String(raw || '');
  }
  name = name.split(/[\\/]/).pop().replace(/[^\w.\- ()]/g, '').trim().slice(0, 100);
  return name || fallback;
}

module.exports = { sniffMedia, cleanFilename, LIMITS, MAX_FILES_PER_BOOKING };
