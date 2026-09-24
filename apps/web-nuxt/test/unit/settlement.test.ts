import { containerDifference, expectedFullReturn } from "@yacco/shared";
import type { RouteSettlement, RouteSettlementExpected } from "@yacco/shared";
import { describe, expect, it } from "vitest";
import {
  countOrNull,
  countableTypes,
  describeDifference,
  describeGap,
  emptiesCountOrNull,
  formatDifference,
  liveDifference,
  moneyDrifted,
  pickedUpOf,
  typeDifferenceNote,
} from "../../app/utils/settlement";

/** fullOut 20, entregados 10, vendidos 4 → deberían volver 6. */
const EXPECTED: RouteSettlementExpected = {
  fullOut: 20,
  fullDelivered: 10,
  fullSold: 4,
  emptiesPickedUp: 14,
  emptiesPickedUpByType: [
    { containerTypeId: "ct-cano", containerTypeName: "Con caño", quantity: 11 },
    { containerTypeId: "ct-viejo", containerTypeName: "Bidón viejo", quantity: 3 },
  ],
  totalSold: "320.00",
  totalCollected: "280.00",
  totalCashCollected: "150.00",
  totalPendingConfirmation: "130.00",
  totalOnCredit: "40.00",
};

const SETTLEMENT: RouteSettlement = {
  routeId: "r-1",
  fullOut: 20,
  fullDelivered: 10,
  fullSold: 4,
  fullReturned: 5,
  emptiesCollected: 14,
  emptiesCollectedByType: [],
  totalSold: "320.00",
  totalCollected: "280.00",
  totalCashCollected: "150.00",
  totalPendingConfirmation: "130.00",
  totalOnCredit: "40.00",
  notes: null,
  settledById: "u-admin",
  settledAt: "2026-08-28T23:10:00.000Z",
};

describe("fórmulas del libro (packages/shared)", () => {
  it("deberían volver = salieron − entregados − vendidos; la diferencia resta además lo que volvió", () => {
    expect(expectedFullReturn(EXPECTED)).toBe(6);
    expect(containerDifference(SETTLEMENT)).toBe(1);
    expect(containerDifference({ ...SETTLEMENT, fullReturned: 8 })).toBe(-2);
  });
});

describe("conteos", () => {
  it("los llenos piden un entero 0 o más; los vacíos en blanco valen cero", () => {
    expect(countOrNull(" 6 ")).toBe(6);
    expect(countOrNull(0)).toBe(0);
    expect(countOrNull("")).toBeNull();
    expect(countOrNull("2.5")).toBeNull();
    expect(emptiesCountOrNull("")).toBe(0);
    expect(emptiesCountOrNull("  ")).toBe(0);
    expect(emptiesCountOrNull("abc")).toBeNull();
    expect(emptiesCountOrNull(4)).toBe(4);
  });

  it("un tipo retirado que el libro dice que volvió se puede contar igual", () => {
    const catalog = [{ id: "ct-cano", name: "Con caño", active: true }];
    expect(countableTypes(catalog, EXPECTED)).toEqual([
      { id: "ct-cano", name: "Con caño" },
      { id: "ct-viejo", name: "Bidón viejo" },
    ]);
    expect(pickedUpOf(EXPECTED, "ct-viejo")).toBe(3);
    expect(pickedUpOf(EXPECTED, "ct-otro")).toBe(0);
  });
});

describe("liveDifference", () => {
  it("sin nada escrito no dice nada; con todo cuadrando lo dice", () => {
    expect(liveDifference(EXPECTED, null, null)).toEqual({ kind: "none" });
    expect(liveDifference(EXPECTED, 6, 14)).toEqual({ kind: "squares" });
    expect(liveDifference(EXPECTED, 6, null)).toEqual({ kind: "squares" });
  });

  it("una diferencia conserva el signo y deja fuera la parte que cuadra", () => {
    expect(liveDifference(EXPECTED, 4, 14)).toEqual({ kind: "gap", full: 2, empties: null });
    expect(liveDifference(EXPECTED, 6, 16)).toEqual({ kind: "gap", full: null, empties: -2 });
  });
});

describe("textos de diferencia", () => {
  it("el signo es la información", () => {
    expect(formatDifference(2)).toBe("+2");
    expect(formatDifference(-3)).toBe("-3");
    expect(formatDifference(0)).toBe("0");
  });

  it("el verbo concuerda con la cantidad: una unidad va en singular", () => {
    expect(describeGap(1)).toBe("falta 1");
    expect(describeGap(-1)).toBe("sobra 1");
    expect(describeGap(2)).toBe("faltan 2");
    expect(describeGap(-3)).toBe("sobran 3");
  });

  it("la diferencia lleva la palabra al lado del signo", () => {
    expect(describeDifference(2)).toBe("+2: faltan 2");
    expect(describeDifference(-1)).toBe("-1: sobra 1");
  });

  it("la nota por tipo sólo aparece cuando ese tipo no cuadró", () => {
    const differences = {
      containers: 0,
      empties: 0,
      emptiesByType: [
        { containerTypeId: "ct-cano", containerTypeName: "Con caño", difference: 2 },
        { containerTypeId: "ct-viejo", containerTypeName: "Bidón viejo", difference: -2 },
        { containerTypeId: "ct-ok", containerTypeName: "Ok", difference: 0 },
      ],
    };
    expect(typeDifferenceNote(differences, "ct-cano")).toBe("(+2: faltan 2 respecto del libro)");
    expect(typeDifferenceNote(differences, "ct-viejo")).toBe("(-2: sobran 2 respecto del libro)");
    expect(typeDifferenceNote(differences, "ct-ok")).toBe("");
    expect(typeDifferenceNote(differences, "ct-ausente")).toBe("");
  });
});

describe("moneyDrifted", () => {
  it("avisa si lo cobrado o lo por confirmar cambió en el libro después del cierre", () => {
    expect(moneyDrifted(SETTLEMENT, EXPECTED)).toBe(false);
    expect(moneyDrifted(SETTLEMENT, { ...EXPECTED, totalCollected: "150.00" })).toBe(true);
    expect(moneyDrifted(SETTLEMENT, { ...EXPECTED, totalPendingConfirmation: "0.00" })).toBe(true);
  });
});
