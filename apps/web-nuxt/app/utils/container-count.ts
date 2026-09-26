import type { PlantCount } from "@yacco/shared";

/** Texto de "lo contado": entero, 0 o más. `null` si no lo es. */
export function parseCounted(value: string | number): number | null {
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** "+3" / "-2": el signo es la información. */
export function formatCountDifference(counted: number, expected: number): string {
  const difference = counted - expected;
  return difference > 0 ? `+${difference}` : String(difference);
}

/** Un conteo más viejo que esto dice poco de hoy. */
export const OLD_COUNT_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Días desde un instante real (no una fecha de negocio): `Date` es correcto acá. */
export function daysSince(instant: string, now: number): number {
  return Math.floor((now - new Date(instant).getTime()) / DAY_MS);
}

/**
 * Lo que quedó de un conteo de la planta, en una frase: el tipo, qué se
 * contó, y de qué lotes salieron los llenos que faltaban.
 */
export function describePlantCount(count: PlantCount): string {
  const what = `${count.containerType.name}, ${CONTAINER_STATE_LABEL[count.state].toLowerCase()}`;
  if (count.adjustments.length === 0) {
    return `Conteo registrado: ${what} coincidió con el sistema (${count.countedQuantity}).`;
  }
  const fromBatches = count.adjustments
    .filter((adjustment) => adjustment.batch !== null)
    .map((adjustment) => `${adjustment.quantity} del lote ${adjustment.batch?.code}`);
  const batches = fromBatches.length > 0 ? ` Se descontaron ${fromBatches.join(" y ")}.` : "";
  return `Conteo registrado: ${what} pasó de ${count.expectedQuantity} a ${count.countedQuantity}.${batches}`;
}
