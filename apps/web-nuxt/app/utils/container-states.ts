import { CONTAINER_STATE_VALUES } from "@yacco/shared";
import type { ContainerInventoryItem, ContainerState } from "@yacco/shared";

/** Planta, después camión, después cliente: el orden en que se recorre un envase. */
export const CONTAINER_STATES: readonly ContainerState[] = CONTAINER_STATE_VALUES;

/** En palabras de la planta, no del modelo: el dueño lo lee sin conocer el enum. */
export const CONTAINER_STATE_LABEL: Record<ContainerState, string> = {
  EMPTY_AT_PLANT: "Vacíos en planta",
  FULL_AT_PLANT: "Llenos en planta",
  FULL_ON_ROUTE: "Llenos en camión",
  EMPTY_ON_ROUTE: "Vacíos en camión",
  WITH_CUSTOMER: "En poder del cliente",
};

export interface InventoryRow {
  containerTypeId: string;
  containerTypeName: string;
  byState: Record<ContainerState, number>;
  total: number;
}

/**
 * Las filas planas (tipo, estado) del libro, una fila por tipo. Un estado que
 * la API no devuelve para un tipo es CERO, no "desconocido": cada fila tiene
 * los cinco. Los negativos quedan tal cual.
 */
export function pivotInventory(items: readonly ContainerInventoryItem[]): InventoryRow[] {
  const rows = new Map<string, InventoryRow>();
  for (const item of items) {
    const row = rows.get(item.containerTypeId) ?? {
      containerTypeId: item.containerTypeId,
      containerTypeName: item.containerType.name,
      byState: Object.fromEntries(CONTAINER_STATES.map((state) => [state, 0])) as Record<
        ContainerState,
        number
      >,
      total: 0,
    };
    row.byState[item.state] += item.quantity;
    row.total += item.quantity;
    rows.set(item.containerTypeId, row);
  }
  return [...rows.values()].sort((a, b) =>
    a.containerTypeName.localeCompare(b.containerTypeName, "es"),
  );
}

export function hasNegative(rows: readonly InventoryRow[]): boolean {
  return rows.some(
    (row) => row.total < 0 || CONTAINER_STATES.some((state) => row.byState[state] < 0),
  );
}
