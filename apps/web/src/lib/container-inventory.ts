import type { ContainerInventoryItem, ContainerState } from "../api/container-inventory";

/** Fixed display order for the five states — plant, then route, then customer. */
export const CONTAINER_STATE_ORDER: ContainerState[] = [
  "EMPTY_AT_PLANT",
  "FULL_AT_PLANT",
  "FULL_ON_ROUTE",
  "EMPTY_ON_ROUTE",
  "WITH_CUSTOMER",
];

/** Plant-floor language, not the enum: the owner reads this without knowing the model. */
export const CONTAINER_STATE_LABELS: Record<ContainerState, string> = {
  EMPTY_AT_PLANT: "Vacíos en planta",
  FULL_AT_PLANT: "Llenos en planta",
  FULL_ON_ROUTE: "Llenos en camión",
  EMPTY_ON_ROUTE: "Vacíos en camión",
  WITH_CUSTOMER: "En poder del cliente",
};

/** One pivoted row: a container type with a quantity for every state, plus its total. */
export interface InventoryRow {
  containerTypeId: string;
  containerTypeName: string;
  byState: Record<ContainerState, number>;
  total: number;
}

function zeroByState(): Record<ContainerState, number> {
  const byState = {} as Record<ContainerState, number>;
  for (const state of CONTAINER_STATE_ORDER) {
    byState[state] = 0;
  }
  return byState;
}

/**
 * Pivots the ledger's flat (container type, state) rows into one row per
 * container type. A state the API doesn't return for a type means zero
 * stock in that state, not "unknown" — every row is filled in for all five
 * states, never left sparse.
 */
export function pivotInventory(items: ContainerInventoryItem[]): InventoryRow[] {
  const rowsByType = new Map<string, InventoryRow>();

  for (const item of items) {
    let row = rowsByType.get(item.containerTypeId);
    if (!row) {
      row = {
        containerTypeId: item.containerTypeId,
        containerTypeName: item.containerType.name,
        byState: zeroByState(),
        total: 0,
      };
      rowsByType.set(item.containerTypeId, row);
    }
    row.byState[item.state] += item.quantity;
    row.total += item.quantity;
  }

  return [...rowsByType.values()].sort((a, b) =>
    a.containerTypeName.localeCompare(b.containerTypeName, "es"),
  );
}

/** Total general del parque: the sum across every row, negatives included. */
export function totalInventory(rows: InventoryRow[]): number {
  return rows.reduce((sum, row) => sum + row.total, 0);
}

export function hasNegativeQuantity(rows: InventoryRow[]): boolean {
  return rows.some(
    (row) => row.total < 0 || CONTAINER_STATE_ORDER.some((state) => row.byState[state] < 0),
  );
}
