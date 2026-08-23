import { describe, expect, it } from "vitest";
import type { ContainerInventoryItem } from "../api/container-inventory";
import { hasNegativeQuantity, pivotInventory, totalInventory } from "./container-inventory";

function item(overrides: Partial<ContainerInventoryItem> = {}): ContainerInventoryItem {
  return {
    containerTypeId: "bidon-20l",
    containerType: { id: "bidon-20l", name: "Bidón 20L" },
    state: "EMPTY_AT_PLANT",
    quantity: 10,
    ...overrides,
  };
}

describe("pivotInventory", () => {
  it("pivota filas planas de la API en una matriz de una fila por tipo de envase", () => {
    const rows = pivotInventory([
      item({ state: "EMPTY_AT_PLANT", quantity: 30 }),
      item({ state: "FULL_AT_PLANT", quantity: 12 }),
      item({ state: "WITH_CUSTOMER", quantity: 8 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      containerTypeId: "bidon-20l",
      containerTypeName: "Bidón 20L",
      byState: {
        EMPTY_AT_PLANT: 30,
        FULL_AT_PLANT: 12,
        FULL_ON_ROUTE: 0,
        EMPTY_ON_ROUTE: 0,
        WITH_CUSTOMER: 8,
      },
      total: 50,
    });
  });

  it("separa filas por tipo de envase distinto y las ordena por nombre", () => {
    const rows = pivotInventory([
      item({
        containerTypeId: "b-7l",
        containerType: { id: "b-7l", name: "Bidón 7L" },
        state: "EMPTY_AT_PLANT",
        quantity: 5,
      }),
      item({
        containerTypeId: "b-20l",
        containerType: { id: "b-20l", name: "Bidón 20L" },
        state: "EMPTY_AT_PLANT",
        quantity: 5,
      }),
    ]);

    expect(rows.map((row) => row.containerTypeName)).toEqual(["Bidón 20L", "Bidón 7L"]);
  });

  it("un estado que la API no devuelve para un tipo se completa con cero, no queda ausente", () => {
    const rows = pivotInventory([item({ state: "FULL_ON_ROUTE", quantity: 4 })]);

    expect(rows[0]?.byState).toEqual({
      EMPTY_AT_PLANT: 0,
      FULL_AT_PLANT: 0,
      FULL_ON_ROUTE: 4,
      EMPTY_ON_ROUTE: 0,
      WITH_CUSTOMER: 0,
    });
  });

  it("un array vacío pivota a cero filas", () => {
    expect(pivotInventory([])).toEqual([]);
  });

  it("mantiene una cantidad negativa tal cual, sin ponerla en cero ni en valor absoluto", () => {
    const rows = pivotInventory([
      item({ state: "FULL_AT_PLANT", quantity: 15 }),
      item({ state: "EMPTY_AT_PLANT", quantity: -3 }),
    ]);

    expect(rows[0]?.byState.EMPTY_AT_PLANT).toBe(-3);
    expect(rows[0]?.total).toBe(12);
  });
});

describe("totalInventory", () => {
  it("suma el total de cada tipo para el total general", () => {
    const rows = pivotInventory([
      item({
        containerTypeId: "a",
        containerType: { id: "a", name: "Bidón 20L" },
        state: "EMPTY_AT_PLANT",
        quantity: 30,
      }),
      item({
        containerTypeId: "b",
        containerType: { id: "b", name: "Bidón 7L" },
        state: "WITH_CUSTOMER",
        quantity: 10,
      }),
    ]);

    expect(totalInventory(rows)).toBe(40);
  });

  it("suma un total negativo como negativo, no lo ignora", () => {
    const rows = pivotInventory([
      item({
        containerTypeId: "a",
        containerType: { id: "a", name: "Bidón 20L" },
        state: "FULL_AT_PLANT",
        quantity: 20,
      }),
      item({
        containerTypeId: "b",
        containerType: { id: "b", name: "Bidón 7L" },
        state: "EMPTY_AT_PLANT",
        quantity: -6,
      }),
    ]);

    expect(totalInventory(rows)).toBe(14);
  });

  it("un array vacío totaliza cero", () => {
    expect(totalInventory([])).toBe(0);
  });
});

describe("hasNegativeQuantity", () => {
  it("es falso cuando todas las cantidades son cero o positivas", () => {
    const rows = pivotInventory([item({ state: "EMPTY_AT_PLANT", quantity: 10 })]);
    expect(hasNegativeQuantity(rows)).toBe(false);
  });

  it("es verdadero cuando algún estado quedó negativo", () => {
    const rows = pivotInventory([item({ state: "EMPTY_AT_PLANT", quantity: -1 })]);
    expect(hasNegativeQuantity(rows)).toBe(true);
  });
});
