const { summarizeAvailability, formatMinutes } = require('../src/services/availability');
const { assessProvider } = require('../src/services/qualityReport');
const { sniffMedia } = require('../src/utils/sniffMedia');
const { isValidService, normalizeKey, labelFor } = require('../src/services/serviceCatalog');

const H = 3600000;
const T0 = new Date('2026-10-01T00:00:00Z');
const at = (h) => new Date(T0.getTime() + h * H);

describe('summarizeAvailability (point 9)', () => {
  test('adds up on and off time inside the window', () => {
    const s = summarizeAvailability(
      [
        { state: 'available', startedAt: at(0), endedAt: at(6) },
        { state: 'unavailable', startedAt: at(6), endedAt: at(8) },
        { state: 'available', startedAt: at(8), endedAt: null },
      ],
      at(0), at(10), at(10)
    );
    expect(s.availableMs).toBe(8 * H);
    expect(s.unavailableMs).toBe(2 * H);
    expect(s.unavailablePct).toBe(20);
    expect(s.switches).toBe(2);
  });

  test('time before the window is ignored; an open session runs up to "now"', () => {
    const s = summarizeAvailability([{ state: 'unavailable', startedAt: at(-100), endedAt: null }], at(0), at(4), at(4));
    expect(s.unavailableMs).toBe(4 * H);
    expect(s.unavailablePct).toBe(100);
  });

  test('a provider with no history has no percentage (not a false 0%)', () => {
    const s = summarizeAvailability([], at(0), at(10), at(10));
    expect(s.trackedMs).toBe(0);
    expect(s.unavailablePct).toBeNull();
  });

  test('formatMinutes reads naturally', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(125)).toBe('2 h 5 min');
    expect(formatMinutes(60 * 26)).toBe('1 d 2 h');
  });
});

describe('assessProvider (quality report)', () => {
  const healthy = {
    trustScore: 85, isNewProvider: false, completedCount: 10, providerCancelledCount: 0, recentRatingAvg: 4.8,
    recentReviewCount: 5, responseTimeScore: 90, disputesUpheld: 0, unavailablePct: 10, trackedHours: 200,
  };

  test('a healthy provider has no flags', () => {
    expect(assessProvider(healthy)).toEqual({ flags: [], riskScore: 0, level: 'low' });
  });

  test('new providers are not flagged for a low starting score', () => {
    expect(assessProvider({ ...healthy, trustScore: 50, isNewProvider: true }).flags).toHaveLength(0);
  });

  test('several problems add up to a high risk level', () => {
    const r = assessProvider({ ...healthy, trustScore: 40, disputesUpheld: 1, providerCancelledCount: 5 });
    expect(r.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['low_trust', 'disputes', 'cancellations']));
    expect(r.level).toBe('high');
  });

  test('"often unavailable" needs enough tracked time to mean anything', () => {
    expect(assessProvider({ ...healthy, unavailablePct: 90, trackedHours: 5 }).flags).toHaveLength(0);
    expect(assessProvider({ ...healthy, unavailablePct: 90, trackedHours: 100 }).flags.map((f) => f.code)).toContain('often_unavailable');
  });
});

describe('sniffMedia (point 13)', () => {
  const pad = Buffer.alloc(40);
  test('recognises jpeg, png, gif, webp, mp4, mov, webm', () => {
    expect(sniffMedia(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad])).mime).toBe('image/jpeg');
    expect(sniffMedia(Buffer.concat([Buffer.from('GIF89a'), pad])).mime).toBe('image/gif');
    expect(sniffMedia(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad])).mime).toBe('image/webp');
    expect(sniffMedia(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypmp42'), pad])).kind).toBe('video');
    expect(sniffMedia(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  '), pad])).mime).toBe('video/quicktime');
    expect(sniffMedia(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), pad])).mime).toBe('video/webm');
  });
  test('rejects html, svg, HEIC and tiny buffers', () => {
    expect(sniffMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffMedia(Buffer.from('<html><body>hello</body></html>'))).toBeNull();
    expect(sniffMedia(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), pad]))).toBeNull();
    expect(sniffMedia(Buffer.from([1, 2, 3]))).toBeNull();
  });
});

describe('service catalog (point 11)', () => {
  test('only listed keywords are valid, and input is tidied first', () => {
    expect(isValidService('plumbing')).toBe(true);
    expect(isValidService('drainage')).toBe(false);
    expect(isValidService(normalizeKey('  Plumbing '))).toBe(true);
    expect(labelFor('ac-repair')).toBe('AC repair');
  });
});
