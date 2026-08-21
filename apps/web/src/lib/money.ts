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

/** Groups thousands by slicing the digit string — no arithmetic involved. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
