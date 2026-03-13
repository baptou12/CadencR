/**
 * Parse a UTC datetime string from SQLite.
 *
 * SQLite's `datetime('now')` produces `YYYY-MM-DD HH:MM:SS` in UTC
 * but without a timezone suffix, so `new Date()` would misinterpret
 * it as local time. This helper appends `Z` when needed.
 */
export function parseUTCDateTime(value: string): Date {
  if (/[Z+-]/.test(value.slice(-6))) return new Date(value);
  return new Date(value.replace(" ", "T") + "Z");
}
