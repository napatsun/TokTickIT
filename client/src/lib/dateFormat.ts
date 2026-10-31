/**
 * Shared deterministic date and date-time formatters.
 *
 * Uses a canonical 3-letter month table ("Jan"…"Dec") everywhere so CLDR
 * locale variations (such as en-GB emitting "Sept" for September while other
 * months are 3 letters) never produce inconsistent date labels across screens.
 */

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format an ISO date string (or Date) as "D Mon YYYY" (e.g. "2 Sep 2026").
 */
export function formatDate(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return String(input);
  }
  const day = date.getDate();
  const month = MONTHS_SHORT[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Format an ISO date-time string (or Date) as "D Mon YYYY, HH:mm"
 * (e.g. "2 Sep 2026, 09:05").
 */
export function formatDateTime(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return String(input);
  }
  const day = date.getDate();
  const month = MONTHS_SHORT[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}
