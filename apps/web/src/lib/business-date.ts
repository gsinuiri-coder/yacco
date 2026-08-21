/**
 * `deliveryDate` is a calendar DATE column, not an instant: it arrives as
 * "AAAA-MM-DD" (America/Lima). `new Date("2026-08-25")` parses as UTC
 * midnight, which reads back one day earlier in Lima (UTC-5) — exactly the
 * kind of bug that would misplan a route on the screen the owner uses to
 * plan it. Nothing here converts to Date: every function works on the
 * digits as text, the same way money.ts formats S/ without going through
 * Number.
 */
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-08-25" -> "25/08/2026". Returns the raw value if it doesn't match. */
export function formatBusinessDate(value: string): string {
  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (match === null) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}
