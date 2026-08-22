/**
 * Money arrives from the API as a 2-decimal string ("150.00"), never as a
 * JSON number, because a JSON number is an IEEE-754 double (CLAUDE.md).
 *
 * Nothing here converts to Number. That is not caution for its own sake:
 * `Number("0.30")` is `0.3`, so the trailing zero is already gone before any
 * formatting runs, and every rounding decision would then happen in binary
 * floating point. All of these functions work on the digits as text.
 */

/** Mirrors MONEY_PATTERN in the API's create-customer.dto.ts: NUMERIC(10,2). */
export const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

export function isValidMoney(value: string): boolean {
  return MONEY_PATTERN.test(value);
}

/**
 * Groups thousands by slicing the digit string — no arithmetic involved.
 * Walks right to left inserting a separator every 3 digits, so the cost is
 * linear in the input length however long the string is (no regex
 * backtracking, unlike the lookahead-based version this replaced).
 */
function groupThousands(digits: string): string {
  let grouped = "";
  let sinceSeparator = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    grouped = digits[i] + grouped;
    sinceSeparator++;
    if (sinceSeparator === 3 && i !== 0) {
      grouped = `,${grouped}`;
      sinceSeparator = 0;
    }
  }
  return grouped;
}

/**
 * "1234.5" -> "S/ 1,234.50". Pads or trims the fraction to exactly two
 * digits textually, so a value the API sent stays byte-for-byte faithful.
 */
export function formatMoney(value: string): string {
  const isNegative = value.startsWith("-");
  const unsigned = isNegative ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
  const decimals = fractionPart.padEnd(2, "0").slice(0, 2);
  const grouped = groupThousands(integerPart === "" ? "0" : integerPart);
  return `${isNegative ? "-" : ""}S/ ${grouped}.${decimals}`;
}

/** An absent credit limit is a real state ("no limit set"), not zero. */
export function formatOptionalMoney(value: string | null): string {
  return value === null ? "Sin límite" : formatMoney(value);
}

/** True when the customer owes something — again by text, not by parsing. */
export function isPositiveMoney(value: string): boolean {
  return !value.startsWith("-") && /[1-9]/.test(value);
}

/**
 * Splits a money string into cents as a BigInt, by text — never through
 * Number. A single order line can already reach 10 integer-cent digits
 * (MONEY_PATTERN's 8 integer digits), and MAX_ITEM_QUANTITY (100000) pushes
 * a line total past that; an order total then sums many such lines. BigInt
 * has no double's 2^53 boundary, so it stays exact the whole way.
 */
function toCents(value: string): bigint {
  const isNegative = value.startsWith("-");
  const unsigned = isNegative ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
  const cents = fractionPart.padEnd(2, "0").slice(0, 2);
  const magnitude = BigInt(`${integerPart === "" ? "0" : integerPart}${cents}`);
  return isNegative ? -magnitude : magnitude;
}

/** Inverse of toCents: BigInt cents back to a 2-decimal money string, by text. */
function fromCents(cents: bigint): string {
  const isNegative = cents < 0n;
  const digits = (isNegative ? -cents : cents).toString().padStart(3, "0");
  const integerPart = digits.slice(0, -2);
  const fractionPart = digits.slice(-2);
  return `${isNegative ? "-" : ""}${integerPart}.${fractionPart}`;
}

/** Live line subtotal while a seller assembles an order: quantity × unit price. */
export function multiplyMoney(price: string, quantity: number): string {
  return fromCents(toCents(price) * BigInt(quantity));
}

/** Live order total: the sum of every line subtotal. */
export function sumMoney(values: string[]): string {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0n));
}
