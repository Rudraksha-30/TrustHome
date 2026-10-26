/**
 * How long a provider was "available" and "not available" (PURE: no database).
 *
 * The provider's switch is recorded as a list of SESSIONS:
 *
 *   { state: 'available' | 'unavailable', startedAt, endedAt }      endedAt = null while it is still going
 *
 * Only the part of each session that falls inside the window we are asked about is counted, so
 * "the last 7 days" works even when a session started three weeks ago.
 *
 * Time before the provider's first session is NOT counted as either state (we simply have no record of it),
 * so a provider who joined yesterday is not shown as "unavailable for 29 days".
 */

const MS_PER_MINUTE = 60 * 1000;

/** Milliseconds that [start, end) shares with [from, to). Never negative. */
function overlapMs(start, end, from, to) {
  const s = Math.max(new Date(start).getTime(), new Date(from).getTime());
  const e = Math.min(new Date(end).getTime(), new Date(to).getTime());
  return Math.max(0, e - s);
}

/**
 * @param sessions  [{ state, startedAt, endedAt|null }]
 * @param from, to  the window to measure
 * @param now       used as the end of a session that is still open
 */
function summarizeAvailability(sessions, from, to, now = new Date()) {
  let availableMs = 0;
  let unavailableMs = 0;
  let firstStart = null;

  for (const s of sessions || []) {
    const start = new Date(s.startedAt);
    const end = s.endedAt ? new Date(s.endedAt) : new Date(now);
    if (firstStart === null || start < firstStart) firstStart = start;

    const ms = overlapMs(start, end, from, to);
    if (s.state === 'available') availableMs += ms;
    else if (s.state === 'unavailable') unavailableMs += ms;
  }

  // A "switch" is the provider flipping the toggle: any session that begins inside the window,
  // except the very first one ever recorded (that one is the starting state, not a flip).
  const switches = (sessions || []).filter((s) => {
    const start = new Date(s.startedAt);
    return start >= new Date(from) && start <= new Date(to) && start.getTime() !== firstStart.getTime();
  }).length;

  const trackedMs = availableMs + unavailableMs;
  const pct = (ms) => (trackedMs === 0 ? null : Math.round((ms / trackedMs) * 1000) / 10);

  return {
    availableMs,
    unavailableMs,
    trackedMs,
    availableMinutes: Math.round(availableMs / MS_PER_MINUTE),
    unavailableMinutes: Math.round(unavailableMs / MS_PER_MINUTE),
    availablePct: pct(availableMs),
    unavailablePct: pct(unavailableMs),
    switches,
    trackingStartedAt: firstStart,
  };
}

/** "2 h 15 min", "45 min", "3 d 4 h". Used by the dashboards. */
function formatMinutes(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m} min`;
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}

module.exports = { overlapMs, summarizeAvailability, formatMinutes };
