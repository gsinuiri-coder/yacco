/**
 * Reparto FIFO de una carga de ruta entre los lotes disponibles.
 *
 * La regla es del dominio, no de la pantalla: "Route loading consumes batches
 * strictly FIFO (oldest batch date first)" (CLAUDE.md). `POST
 * /routes/:id/loads` acepta el `batchItemId` que le manden y no verifica el
 * orden, así que ofrecer un selector de lotes sería ofrecer una forma de
 * romper la regla con un clic — y además le pediría al usuario un
 * identificador que no tiene forma de conocer. En su lugar, la oficina dice
 * "50 bidones" y esto decide de qué lotes salen.
 *
 * Nada de esto adivina el orden: los lotes llegan ya ordenados por fecha
 * ascendente y código ascendente desde `GET /production-batches`
 * (`orderBy: [{ date: "asc" }, { code: "asc" }]`), que es exactamente el
 * orden FIFO. Esta función respeta el orden en que los recibe.
 */
import type { ProductionBatch } from "../api/production-batches";

/** Una línea del reparto: cuántas unidades salen de qué línea de lote. */
export interface LoadPlanLine {
  batchItemId: string;
  batchCode: string;
  batchDate: string;
  quantity: number;
}

export interface LoadPlan {
  lines: LoadPlanLine[];
  /** Total disponible de ese tipo de envase entre todos los lotes. */
  available: number;
  /** Lo que falta para llegar a lo pedido; 0 cuando alcanza. */
  shortfall: number;
}

export function planFifoLoad(
  batches: ProductionBatch[],
  containerTypeId: string,
  quantity: number,
): LoadPlan {
  const lines: LoadPlanLine[] = [];
  let available = 0;
  let remaining = quantity;

  for (const batch of batches) {
    for (const item of batch.items) {
      if (item.containerTypeId !== containerTypeId || item.availableQty <= 0) continue;
      available += item.availableQty;
      if (remaining <= 0) continue;
      const taken = Math.min(remaining, item.availableQty);
      lines.push({
        batchItemId: item.id,
        batchCode: batch.code,
        batchDate: batch.date,
        quantity: taken,
      });
      remaining -= taken;
    }
  }

  return { lines, available, shortfall: Math.max(0, remaining) };
}
