/**
 * Money on the wire is a 2-decimal string ("12.50"), never a JSON number
 * (AGENTS.md). Nothing in this module goes through `Number`: `Number("0.30")`
 * is already `0.3` before any formatting runs, and every rounding decision
 * after that happens in binary floating point. The digits are handled as
 * text, and arithmetic happens on integer cents as `bigint`, which has no
 * 2^53 ceiling.
 */

/** Mirrors MONEY_PATTERN in the API's DTOs: NUMERIC(10,2), no sign. */
export const MONEY_INPUT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

export function isMoneyInput(value: string): boolean {
  return MONEY_INPUT_PATTERN.test(value);
}

interface MoneyParts {
  negative: boolean;
  /** Integer digits, never empty. */
  whole: string;
  /** Exactly two digits: extra decimals are truncated, missing ones padded. */
  cents: string;
}

function splitMoney(value: string): MoneyParts {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const dot = unsigned.indexOf(".");
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? "" : unsigned.slice(dot + 1);
  return {
    negative,
    whole: whole.length === 0 ? "0" : whole,
    cents: `${fraction}00`.slice(0, 2),
  };
}

/** "1234567" -> "1,234,567", taking the digits in groups of three from the right. */
function withThousands(digits: string): string {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return groups.join(",");
}

/** "1234.5" -> "S/ 1,234.50"; "-12.5" -> "-S/ 12.50". Byte-faithful to the API value. */
export function formatSoles(value: string): string {
  const { negative, whole, cents } = splitMoney(value);
  return `${negative ? "-" : ""}S/ ${withThousands(whole)}.${cents}`;
}

/**
 * A customer's debt balance as the plant reads it: a negative balance is
 * money in the customer's favour — "-15.00" -> "A favor S/ 15.00" — not a
 * debt with a sign. The one place that wording lives: every screen showing
 * `debtBalance` goes through here (MoneyAmount with `debt` included).
 */
export function formatDebtBalance(value: string): string {
  const { negative, whole, cents } = splitMoney(value);
  const unsigned = `S/ ${withThousands(whole)}.${cents}`;
  return negative && /[1-9]/.test(whole + cents) ? `A favor ${unsigned}` : unsigned;
}

/** True when the amount is above zero — a real debt, a real payment — read from the digits. */
export function isAboveZero(value: string): boolean {
  const { negative, whole, cents } = splitMoney(value);
  return !negative && /[1-9]/.test(whole + cents);
}

function toCents(value: string): bigint {
  const { negative, whole, cents } = splitMoney(value);
  const magnitude = BigInt(whole + cents);
  return negative ? -magnitude : magnitude;
}

function fromCents(total: bigint): string {
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Line subtotal: unit price × quantity, exact. */
export function timesQuantity(unitPrice: string, quantity: number): string {
  return fromCents(toCents(unitPrice) * BigInt(quantity));
}

/** Sum of several amounts, exact. An empty list is "0.00". */
export function addAmounts(amounts: readonly string[]): string {
  let total = 0n;
  for (const amount of amounts) {
    total += toCents(amount);
  }
  return fromCents(total);
}

/** a − b, exact: the difference a settlement records between expected and counted. */
export function subtractAmounts(minuend: string, subtrahend: string): string {
  return fromCents(toCents(minuend) - toCents(subtrahend));
}
