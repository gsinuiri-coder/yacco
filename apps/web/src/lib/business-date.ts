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

/**
 * Today's calendar day in America/Lima, as "AAAA-MM-DD" — the default for a
 * new order's deliveryDate. This does not parse a date string (the thing the
 * rule above forbids); it reads the current instant in an explicit timezone,
 * which is the opposite operation. The "en-CA" locale is a formatting trick:
 * it happens to produce ISO order (year-month-day) directly, so the result
 * needs no further text manipulation.
 */
export function todayInLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}
