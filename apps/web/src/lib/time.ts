import { formatDistanceToNowStrict, format, isValid, parseISO } from 'date-fns';

/**
 * Time helpers. The API stores + sends UTC ISO-8601 strings; the browser renders
 * in the user's local timezone. Relative time is used in lists; absolute (with
 * the zone) is surfaced as a tooltip / in the detail header.
 */

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return isValid(value) ? value : null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

/** "3 minutes ago" / "in 2 days". Falls back to the raw string if unparseable. */
export function relativeTime(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** Local absolute timestamp, e.g. "Jun 20, 2026, 14:05". */
export function absoluteTime(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return format(d, 'MMM d, yyyy, HH:mm');
}

/** Local absolute timestamp including the timezone, for tooltips. */
export function absoluteTimeWithZone(value: string | Date): string {
  const d = toDate(value);
  if (!d) return String(value);
  return format(d, "MMM d, yyyy, HH:mm:ss 'GMT'XXX");
}

/** True when a string parses as an ISO-8601 timestamp (used for chart labels). */
export function isIsoTimestamp(value: string): boolean {
  // Cheap guard before the heavier parse: must look date-ish.
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) return false;
  return isValid(parseISO(value));
}

/** Format an axis/category label: ISO timestamps → short local, else as-is. */
export function formatLabel(value: string): string {
  if (isIsoTimestamp(value)) {
    const d = parseISO(value);
    if (isValid(d)) return format(d, 'MMM d HH:mm');
  }
  return value;
}
