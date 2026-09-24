import { expectedFullReturn } from "@yacco/shared";
import type {
  ContainerType,
  RouteSettlement,
  RouteSettlementDifferences,
  RouteSettlementExpected,
} from "@yacco/shared";

/** "+2" / "-3": el signo ES la información. Un faltante y un sobrante nunca se mezclan. */
export function formatDifference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** "faltan 2" o "sobran 3", respecto del libro; una unidad, en singular. */
export function describeGap(value: number): string {
  const units = Math.abs(value);
  const verb = value > 0 ? "falta" : "sobra";
  return `${units === 1 ? verb : `${verb}n`} ${units}`;
}

/** "+2: faltan 2": el signo sin la palabra se lee al revés («dos de más»). */
export function describeDifference(value: number): string {
  return `${formatDifference(value)}: ${describeGap(value)}`;
}

/** Un conteo entero, 0 o más; `null` si no lo es. */
export function countOrNull(value: string | number): number | null {
  const trimmed = String(value).trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Vacíos contados de un tipo. **Vacío es cero**, a propósito distinto del
 * conteo de envases de un cliente (donde vacío es «no contado»): al volver de
 * ruta el camión se descarga entero, así que un tipo sin escribir es un tipo
 * del que no bajó ninguno. Si esto se «unifica» con el otro formulario,
 * descargar pasaría a exigir un 0 por cada tipo que no volvió.
 */
export function emptiesCountOrNull(value: string | number): number | null {
  return String(value).trim() === "" ? 0 : countOrNull(value);
}

export interface CountableType {
  id: string;
  name: string;
}

/**
 * Los tipos que se pueden contar: el catálogo activo MÁS cualquiera que el
 * libro diga que se recogió. Un tipo retirado que todavía vuelve del camión
 * tiene que poder contarse, y GET /container-types no lo devuelve.
 */
export function countableTypes(
  catalog: readonly ContainerType[],
  expected: RouteSettlementExpected,
): CountableType[] {
  const fromCatalog = catalog.map((type) => ({ id: type.id, name: type.name }));
  const retired = expected.emptiesPickedUpByType
    .filter((line) => !catalog.some((type) => type.id === line.containerTypeId))
    .map((line) => ({ id: line.containerTypeId, name: line.containerTypeName }));
  return [...fromCatalog, ...retired];
}

export function pickedUpOf(expected: RouteSettlementExpected, containerTypeId: string): number {
  return (
    expected.emptiesPickedUpByType.find((line) => line.containerTypeId === containerTypeId)
      ?.quantity ?? 0
  );
}

export type LiveDifference =
  | { kind: "none" }
  | { kind: "squares" }
  | { kind: "gap"; full: number | null; empties: number | null };

/**
 * Las diferencias antes de enviar, para que quien cuenta las vea y escriba la
 * nota que las explica. Nunca bloquean: son un aviso. Con `null` todavía no se
 * escribió ese número.
 */
export function liveDifference(
  expected: RouteSettlementExpected,
  fullReturned: number | null,
  emptiesCollected: number | null,
): LiveDifference {
  if (fullReturned === null && emptiesCollected === null) return { kind: "none" };
  const full = fullReturned === null ? null : expectedFullReturn(expected) - fullReturned;
  const empties = emptiesCollected === null ? null : expected.emptiesPickedUp - emptiesCollected;
  const nonZero = (value: number | null) => (value === null || value === 0 ? null : value);
  if (nonZero(full) === null && nonZero(empties) === null) return { kind: "squares" };
  return { kind: "gap", full: nonZero(full), empties: nonZero(empties) };
}

/**
 * "(+2: faltan 2 respecto del libro)" junto a un tipo, sólo cuando no es cero.
 * Es lo que el total puede esconder cuando dos tipos se compensan.
 */
export function typeDifferenceNote(
  differences: RouteSettlementDifferences,
  containerTypeId: string,
): string {
  const found = differences.emptiesByType.find((row) => row.containerTypeId === containerTypeId);
  if (found === undefined || found.difference === 0) return "";
  return `(${describeDifference(found.difference)} respecto del libro)`;
}

/**
 * Una liquidación congela el dinero del cierre. Si después se resuelve un pago
 * pendiente (o se corrige una parada), el libro cambia y la fila no. La pantalla
 * lo dice en vez de mostrar un número que ya no es cierto sin avisar.
 */
export function moneyDrifted(
  settlement: RouteSettlement,
  expected: RouteSettlementExpected,
): boolean {
  return (
    settlement.totalCollected !== expected.totalCollected ||
    settlement.totalPendingConfirmation !== expected.totalPendingConfirmation
  );
}
