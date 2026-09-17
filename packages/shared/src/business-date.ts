/**
 * Two different kinds of date travel on the wire, and they must never be
 * confused (AGENTS.md):
 *
 * - A BUSINESS DAY (`deliveryDate`, `routes.date`) is "AAAA-MM-DD": a calendar
 *   day in America/Lima, not an instant. `new Date("2026-08-25")` parses it as
 *   UTC midnight, which reads back as the 24th in Lima (UTC-5). So it is
 *   formatted by splitting the text, never through `Date` or a date library.
 * - An INSTANT (`createdAt`, `voidedAt`) is an ISO timestamp in UTC. There
 *   `Date` is the right tool, as long as it is rendered in an explicit
 *   America/Lima zone rather than whatever zone the browser is in.
 */

export const LIMA_TIME_ZONE = "America/Lima";

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-08-25" -> "25/08/2026". Anything that isn't AAAA-MM-DD comes back untouched. */
export function formatCalendarDay(day: string): string {
  const parts = CALENDAR_DAY.exec(day);
  if (parts === null) return day;
  const [, year, month, dayOfMonth] = parts;
  return `${dayOfMonth}/${month}/${year}`;
}

/**
 * The current calendar day in Lima, as "AAAA-MM-DD". This reads the present
 * instant in an explicit zone — the opposite of parsing a day string. The
 * "en-CA" locale happens to print ISO order, so no rearranging is needed.
 */
export function limaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LIMA_TIME_ZONE }).format(now);
}

const INSTANT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: LIMA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-08-25T15:04:00.000Z" -> "25/08/2026 10:04", Lima wall clock. Unparseable input comes back untouched. */
export function formatInstantInLima(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  const byType = new Map(
    INSTANT_FORMAT.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const pick = (type: Intl.DateTimeFormatPartTypes) => byType.get(type) ?? "";
  return `${pick("day")}/${pick("month")}/${pick("year")} ${pick("hour")}:${pick("minute")}`;
}
