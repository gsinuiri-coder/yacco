import { describe, expect, it } from "vitest";
import { formatMoney, formatOptionalMoney, isPositiveMoney, isValidMoney } from "./money";

describe("formatMoney", () => {
  it("keeps the trailing zero that Number() would silently drop", () => {
    // This is the whole reason the formatter is string-based: the naive
    // conversion loses the cent before any formatting even runs.
    expect(String(Number("0.30"))).toBe("0.3");
    expect(formatMoney("0.30")).toBe("S/ 0.30");
  });

  it("preserves cents exactly for values a float would perturb", () => {
    expect(formatMoney("0.07")).toBe("S/ 0.07");
    expect(formatMoney("0.10")).toBe("S/ 0.10");
    expect(formatMoney("1.005")).toBe("S/ 1.00");
    expect(formatMoney("99999999.99")).toBe("S/ 99,999,999.99");
  });

  it("groups thousands without arithmetic", () => {
    expect(formatMoney("1234.50")).toBe("S/ 1,234.50");
    expect(formatMoney("1234567.89")).toBe("S/ 1,234,567.89");
    expect(formatMoney("999.99")).toBe("S/ 999.99");
  });

  it("groups an integer far beyond NUMERIC(10,2) without exponential blowup", () => {
    // Regression for typescript:S8786: the old lookahead regex
    // (/\B(?=(\d{3})+(?!\d))/g) had super-linear backtracking on long digit
    // runs. Money is capped at 8 integer digits end to end, but this helper
    // is a reusable string formatter, so it must stay flat even if reused
    // with unbounded input.
    expect(formatMoney("123456789012.34")).toBe("S/ 123,456,789,012.34");
  });

  it("pads a short or missing fraction to two digits", () => {
    expect(formatMoney("5")).toBe("S/ 5.00");
    expect(formatMoney("5.4")).toBe("S/ 5.40");
  });

  it("keeps a negative sign in front", () => {
    expect(formatMoney("-12.50")).toBe("-S/ 12.50");
  });
});

describe("formatOptionalMoney", () => {
  it("distinguishes no limit set from a limit of zero", () => {
    expect(formatOptionalMoney(null)).toBe("Sin límite");
    expect(formatOptionalMoney("0.00")).toBe("S/ 0.00");
  });
});

describe("isPositiveMoney", () => {
  it("detects a real debt without parsing the string", () => {
    expect(isPositiveMoney("0.00")).toBe(false);
    expect(isPositiveMoney("0.01")).toBe(true);
    expect(isPositiveMoney("150.00")).toBe(true);
    expect(isPositiveMoney("-5.00")).toBe(false);
  });
});

describe("isValidMoney", () => {
  it("mirrors the API's NUMERIC(10,2) pattern", () => {
    expect(isValidMoney("150.00")).toBe(true);
    expect(isValidMoney("150")).toBe(true);
    expect(isValidMoney("150.5")).toBe(true);
    expect(isValidMoney("99999999.99")).toBe(true);
  });

  it("rejects what the API would reject", () => {
    expect(isValidMoney("mucho")).toBe(false);
    expect(isValidMoney("150.005")).toBe(false);
    expect(isValidMoney("-150.00")).toBe(false);
    expect(isValidMoney("999999999.00")).toBe(false);
    expect(isValidMoney("")).toBe(false);
  });
});
