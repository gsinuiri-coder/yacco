import { describe, expect, it } from "vitest";
import { validateCustomerDocument } from "../src/customers.js";

describe("validateCustomerDocument", () => {
  it("returns null when both type and number are empty or null", () => {
    expect(validateCustomerDocument(null, null)).toBeNull();
    expect(validateCustomerDocument(undefined, undefined)).toBeNull();
    expect(validateCustomerDocument("", "")).toBeNull();
    expect(validateCustomerDocument("  ", "  ")).toBeNull();
  });

  it("fails when type is provided but number is missing", () => {
    expect(validateCustomerDocument("RUC", null)).toBe(
      "El número de documento es obligatorio si se indica el tipo",
    );
    expect(validateCustomerDocument("DNI", "")).toBe(
      "El número de documento es obligatorio si se indica el tipo",
    );
  });

  it("fails when number is provided but type is missing", () => {
    expect(validateCustomerDocument(null, "12345678")).toBe(
      "El tipo de documento es obligatorio si se indica el número",
    );
    expect(validateCustomerDocument("", "20123456789")).toBe(
      "El tipo de documento es obligatorio si se indica el número",
    );
  });

  describe("RUC validation", () => {
    it("accepts exactly 11 digits", () => {
      expect(validateCustomerDocument("RUC", "20601234567")).toBeNull();
      expect(validateCustomerDocument("RUC", "10456789012")).toBeNull();
    });

    it("rejects non-11 digits or non-numeric", () => {
      expect(validateCustomerDocument("RUC", "1234567890")).toBe(
        "El RUC debe tener exactamente 11 dígitos",
      );
      expect(validateCustomerDocument("RUC", "123456789012")).toBe(
        "El RUC debe tener exactamente 11 dígitos",
      );
      expect(validateCustomerDocument("RUC", "2060123456A")).toBe(
        "El RUC debe tener exactamente 11 dígitos",
      );
    });
  });

  describe("DNI validation", () => {
    it("accepts exactly 8 digits", () => {
      expect(validateCustomerDocument("DNI", "12345678")).toBeNull();
      expect(validateCustomerDocument("DNI", "87654321")).toBeNull();
    });

    it("rejects non-8 digits or non-numeric", () => {
      expect(validateCustomerDocument("DNI", "1234567")).toBe(
        "El DNI debe tener exactamente 8 dígitos",
      );
      expect(validateCustomerDocument("DNI", "123456789")).toBe(
        "El DNI debe tener exactamente 8 dígitos",
      );
      expect(validateCustomerDocument("DNI", "1234567A")).toBe(
        "El DNI debe tener exactamente 8 dígitos",
      );
    });
  });

  describe("Carné de extranjería (CE) validation", () => {
    it("accepts valid alphanumeric length between 4 and 20", () => {
      expect(validateCustomerDocument("CE", "001234567")).toBeNull();
      expect(validateCustomerDocument("CE", "A123456")).toBeNull();
    });

    it("rejects invalid CE strings", () => {
      expect(validateCustomerDocument("CE", "12")).toBe(
        "El carné de extranjería debe tener entre 4 y 20 caracteres alfanuméricos",
      );
      expect(validateCustomerDocument("CE", "AB-123456")).toBe(
        "El carné de extranjería debe tener entre 4 y 20 caracteres alfanuméricos",
      );
    });
  });
});
