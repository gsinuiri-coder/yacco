import type { EffectivePrice, Product } from "@yacco/shared";
import { describe, expect, it } from "vitest";
import {
  blankOrderLine,
  checkOrderLine,
  lineSubtotal,
  lineToBody,
  linesTotal,
  prefillPrice,
  repriceLines,
} from "../../app/utils/order-lines";
import type { OrderLineDraft } from "../../app/utils/order-lines";

const RECARGA: Product = {
  id: "p-recarga",
  name: "Recarga 20L",
  type: "REFILL",
  containerType: { id: "ct", name: "Bidón" },
  listPrice: "12.50",
  active: true,
};
const BIDON: Product = { ...RECARGA, id: "p-bidon", name: "Bidón 20L", listPrice: "35.00" };

function line(overrides: Partial<OrderLineDraft>): OrderLineDraft {
  return { ...blankOrderLine(0), ...overrides };
}

describe("prefillPrice", () => {
  const effective: EffectivePrice[] = [
    { product: { id: "p-recarga", name: "Recarga 20L" }, price: "9.90", source: "CUSTOMER" },
  ];

  it("prefiere el precio efectivo del cliente al de lista", () => {
    expect(prefillPrice("p-recarga", [RECARGA], effective, true)).toEqual({
      unitPrice: "9.90",
      priceOrigin: "CUSTOMER",
    });
  });

  it("sin precio efectivo, o si la consulta falló, usa el de lista", () => {
    expect(prefillPrice("p-bidon", [RECARGA, BIDON], effective, true)).toEqual({
      unitPrice: "35.00",
      priceOrigin: "LIST",
    });
    expect(prefillPrice("p-recarga", [RECARGA], effective, false)).toEqual({
      unitPrice: "12.50",
      priceOrigin: "LIST",
    });
  });

  it("un producto que no está en el catálogo no prellena nada", () => {
    expect(prefillPrice("p-otro", [RECARGA], effective, true)).toEqual({
      unitPrice: "",
      priceOrigin: null,
    });
  });
});

describe("repriceLines", () => {
  it("vuelve a prellenar lo prellenado, y respeta lo escrito a mano y las líneas vacías", () => {
    const next: EffectivePrice[] = [
      { product: { id: "p-recarga", name: "Recarga 20L" }, price: "7.00", source: "CUSTOMER" },
    ];
    const lines = [
      line({ key: 1, productId: "p-recarga", unitPrice: "9.90", priceOrigin: "CUSTOMER" }),
      line({ key: 2, productId: "p-bidon", unitPrice: "20.00", priceOrigin: null }),
      line({ key: 3 }),
    ];

    const repriced = repriceLines(lines, [RECARGA, BIDON], next, true);

    expect(repriced.map((item) => item.unitPrice)).toEqual(["7.00", "20.00", ""]);
  });
});

describe("checkOrderLine", () => {
  it("pide producto, cantidad entera entre 1 y el tope, y un precio válido", () => {
    expect(checkOrderLine(line({}))).toBe("Elige un producto");
    const base = { productId: "p-recarga", unitPrice: "12.50" };
    expect(checkOrderLine(line({ ...base, quantity: "0" }))).toMatch(/entero mayor que 0/);
    expect(checkOrderLine(line({ ...base, quantity: "1.5" }))).toMatch(/entero mayor que 0/);
    expect(checkOrderLine(line({ ...base, quantity: "100001" }))).toBe(
      "La cantidad no puede superar 100000",
    );
    expect(checkOrderLine(line({ ...base, quantity: "2", unitPrice: "12,50" }))).toMatch(
      /precio unitario/,
    );
    expect(checkOrderLine(line({ ...base, quantity: " 2 " }))).toBeUndefined();
  });
});

describe("subtotales y total", () => {
  it("calcula en céntimos exactos y suma sólo lo que ya se puede calcular", () => {
    const lines = [
      line({ productId: "a", quantity: "3", unitPrice: "0.10" }),
      line({ productId: "b", quantity: "2", unitPrice: "12.50" }),
      line({ productId: "c", quantity: "", unitPrice: "5.00" }),
    ];
    expect(lineSubtotal(lines[0]!)).toBe("0.30");
    expect(lineSubtotal(lines[2]!)).toBeNull();
    expect(linesTotal(lines)).toBe("25.30");
    expect(linesTotal([])).toBe("0.00");
  });

  it("el cuerpo manda la cantidad como número y el precio como string", () => {
    expect(lineToBody(line({ productId: "a", quantity: " 4 ", unitPrice: " 12.50 " }))).toEqual({
      productId: "a",
      quantity: 4,
      unitPrice: "12.50",
    });
  });
});
