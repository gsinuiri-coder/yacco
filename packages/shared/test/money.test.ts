import { describe, expect, it } from "vitest";
import {
  addAmounts,
  formatSoles,
  isAboveZero,
  isMoneyInput,
  subtractAmounts,
  timesQuantity,
} from "../src/money.js";

describe("formatSoles", () => {
  it("conserva el cero final que Number() se come", () => {
    // La razón de que todo sea texto: la conversión ingenua pierde el
    // céntimo antes de formatear nada.
    expect(String(Number("0.30"))).toBe("0.3");
    expect(formatSoles("0.30")).toBe("S/ 0.30");
  });

  it("no mueve un céntimo en valores que un double altera", () => {
    expect(formatSoles("0.07")).toBe("S/ 0.07");
    expect(formatSoles("1.005")).toBe("S/ 1.00");
    expect(formatSoles("99999999.99")).toBe("S/ 99,999,999.99");
  });

  it("separa miles de a tres desde la derecha", () => {
    expect(formatSoles("999.99")).toBe("S/ 999.99");
    expect(formatSoles("1234.50")).toBe("S/ 1,234.50");
    expect(formatSoles("1234567.89")).toBe("S/ 1,234,567.89");
    expect(formatSoles("123456789012.34")).toBe("S/ 123,456,789,012.34");
  });

  it("completa a dos decimales lo que llega corto o sin parte decimal", () => {
    expect(formatSoles("5")).toBe("S/ 5.00");
    expect(formatSoles("5.4")).toBe("S/ 5.40");
    expect(formatSoles(".5")).toBe("S/ 0.50");
  });

  it("deja el signo negativo adelante", () => {
    expect(formatSoles("-12.50")).toBe("-S/ 12.50");
  });
});

describe("isAboveZero", () => {
  it("distingue una deuda real de cero o de un saldo a favor, sin parsear", () => {
    expect(isAboveZero("0.00")).toBe(false);
    expect(isAboveZero("0.01")).toBe(true);
    expect(isAboveZero("150.00")).toBe(true);
    expect(isAboveZero("10")).toBe(true);
    expect(isAboveZero("-5.00")).toBe(false);
  });
});

describe("isMoneyInput", () => {
  it("acepta lo que acepta NUMERIC(10,2) en la API", () => {
    expect(isMoneyInput("150.00")).toBe(true);
    expect(isMoneyInput("150")).toBe(true);
    expect(isMoneyInput("150.5")).toBe(true);
    expect(isMoneyInput("99999999.99")).toBe(true);
  });

  it("rechaza lo que la API rechazaría", () => {
    expect(isMoneyInput("mucho")).toBe(false);
    expect(isMoneyInput("150.005")).toBe(false);
    expect(isMoneyInput("-150.00")).toBe(false);
    expect(isMoneyInput("999999999.00")).toBe(false);
    expect(isMoneyInput("")).toBe(false);
  });
});

describe("aritmética en céntimos", () => {
  it("0.10 × 3 es 0.30, no 0.30000000000000004", () => {
    expect(timesQuantity("0.10", 3)).toBe("0.30");
    expect(timesQuantity("12.50", 0)).toBe("0.00");
  });

  it("sigue exacta más allá de 2^53 céntimos", () => {
    const maxLine = timesQuantity("99999999.99", 100000);
    expect(maxLine).toBe("9999999999000.00");
    expect(addAmounts(Array<string>(10).fill(maxLine))).toBe("99999999990000.00");
    expect(9999999999000_00n * 10n).toBeGreaterThan(2n ** 53n);
  });

  it("suma sin perder céntimos y una lista vacía es cero", () => {
    expect(addAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(addAmounts([])).toBe("0.00");
  });

  it("resta y conserva el signo de una diferencia negativa", () => {
    expect(subtractAmounts("100.00", "99.99")).toBe("0.01");
    expect(subtractAmounts("50.00", "80.50")).toBe("-30.50");
    expect(subtractAmounts("0.05", "0.10")).toBe("-0.05");
  });
});
