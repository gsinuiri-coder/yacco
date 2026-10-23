import { describe, expect, it } from "vitest";
import { compareDelivery, isDeliveredDifferently } from "../src/delivery-comparison.js";
import type { DeliveryLine } from "../src/delivery-comparison.js";

function line(productId: string, name: string, quantity: number): DeliveryLine {
  return { productId, product: { id: productId, name }, quantity };
}

const REFILL = (quantity: number) => line("p-refill", "Recarga 20L", quantity);
const NO_TAP = (quantity: number) => line("p-no-tap", "Recarga 20L sin caño", quantity);

describe("isDeliveredDifferently", () => {
  it("igual: lo mismo que se pidió no es entregar distinto", () => {
    expect(isDeliveredDifferently([REFILL(3)], [REFILL(3)])).toBe(false);
  });

  it("más: se entregó más de lo pedido", () => {
    expect(isDeliveredDifferently([REFILL(3)], [REFILL(5)])).toBe(true);
  });

  it("menos: se entregó menos de lo pedido", () => {
    expect(isDeliveredDifferently([REFILL(3)], [REFILL(2)])).toBe(true);
  });

  it("otro producto: misma cantidad de otra cosa", () => {
    expect(isDeliveredDifferently([REFILL(3)], [NO_TAP(3)])).toBe(true);
  });

  it("el orden de las líneas no cuenta, y un producto partido en dos líneas suma", () => {
    expect(isDeliveredDifferently([REFILL(3), NO_TAP(2)], [NO_TAP(2), REFILL(1), REFILL(2)])).toBe(
      false,
    );
  });
});

describe("compareDelivery", () => {
  it("pone pedido y entregado lado a lado: primero lo del pedido, después lo que no se pidió", () => {
    expect(compareDelivery([REFILL(3)], [NO_TAP(5)])).toEqual([
      { productId: "p-refill", productName: "Recarga 20L", ordered: 3, delivered: 0 },
      { productId: "p-no-tap", productName: "Recarga 20L sin caño", ordered: 0, delivered: 5 },
    ]);
  });
});
