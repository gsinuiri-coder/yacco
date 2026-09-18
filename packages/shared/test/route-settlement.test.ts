import { describe, expect, it } from "vitest";
import { containerDifference, expectedFullReturn } from "../src/route-settlement.js";
import type { RouteSettlement, RouteSettlementExpected } from "../src/route-settlement.js";

const counts = { fullOut: 20, fullDelivered: 10, fullSold: 4 };

describe("fórmulas de la liquidación", () => {
  it("deberían volver los que salieron menos los entregados y los vendidos", () => {
    expect(expectedFullReturn(counts as RouteSettlementExpected)).toBe(6);
  });

  it("la diferencia de llenos conserva el signo: positivo falta, negativo sobra", () => {
    expect(containerDifference({ ...counts, fullReturned: 5 } as RouteSettlement)).toBe(1);
    expect(containerDifference({ ...counts, fullReturned: 8 } as RouteSettlement)).toBe(-2);
    expect(containerDifference({ ...counts, fullReturned: 6 } as RouteSettlement)).toBe(0);
  });
});
