// Nigeria (Africa/Lagos, UTC+1, no DST) is hardcoded here because this HRIS is single-country.
// The bug this fixes: Date.prototype.getHours()/getMinutes() read the SERVER's local timezone,
// not Nigeria's. Render (and most hosts) run containers in UTC by default. So "5:00pm Lagos"
// was being read by the server as "4:00pm" (UTC), making a perfectly on-time 5pm checkout look
// like an early departure against a 9-5 rule. These helpers always resolve to actual Lagos time,
// regardless of what timezone the Node process itself is running in.

export const TIMEZONE = 'Africa/Lagos';

/**
 * Returns { hours, minutes } representing the current wall-clock time in Nigeria for the
 * given instant, independent of server timezone.
 */
export function nowInLagos(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hours = Number(parts.find((p) => p.type === 'hour').value);
  const minutes = Number(parts.find((p) => p.type === 'minute').value);
  return { hours, minutes };
}

export function minutesSinceMidnightLagos(date = new Date()) {
  const { hours, minutes } = nowInLagos(date);
  return hours * 60 + minutes;
}

/**
 * Returns a Date representing 00:00:00 Lagos time for the calendar day containing `date`,
 * as the correct UTC instant. Use this instead of `date.setHours(0,0,0,0)` (which uses
 * server-local time) whenever "which calendar day is this" needs to match Nigeria's clock —
 * e.g. matching today's attendance record, or building a month's date range for reports.
 */
export function lagosDateBoundary(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  // Lagos has no DST, so its midnight is always a fixed +01:00 offset from UTC.
  return new Date(`${y}-${m}-${d}T00:00:00+01:00`);
}

/**
 * Same as lagosDateBoundary, but offset by N calendar days (Lagos-local), useful for
 * building [start, end] ranges without drifting across the UTC/Lagos boundary.
 */
export function lagosDateBoundaryOffset(date, dayOffset) {
  const boundary = lagosDateBoundary(date);
  boundary.setUTCDate(boundary.getUTCDate() + dayOffset);
  return boundary;
}
