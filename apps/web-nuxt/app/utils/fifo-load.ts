import type { ProductionBatch } from "@yacco/shared";

/**
 * Reparto FIFO de una carga de ruta entre los lotes con stock.
 *
 * La invariante la sostiene la API: POST /routes/:id/loads rechaza un
 * `batchItemId` que no sea el del lote más antiguo con unidades de ese tipo.
 * Esto es la comodidad que evita adivinarla: la oficina dice "50 bidones" y
 * acá se decide de qué lotes salen, en el mismo orden que la API va a exigir,
 * sin pedirle a nadie un identificador que no tiene forma de conocer.
 *
 * El orden no se inventa: los lotes llegan ya ordenados de GET
 * /production-batches (fecha y código ascendentes, el mismo criterio con que
 * la API busca la cabeza del FIFO). Se respetan en el orden recibido.
 */
export interface LoadPlanLine {
  batchItemId: string;
  batchCode: string;
  batchDate: string;
  quantity: number;
}

export interface LoadPlan {
  lines: LoadPlanLine[];
  /** Todo lo disponible de ese tipo, entre todos los lotes. */
  available: number;
  /** Lo que falta para llegar a lo pedido; 0 cuando alcanza. */
  shortfall: number;
}

export function planFifoLoad(
  batches: readonly ProductionBatch[],
  containerTypeId: string,
  quantity: number,
): LoadPlan {
  const lines: LoadPlanLine[] = [];
  let available = 0;
  let pending = quantity;

  for (const batch of batches) {
    for (const item of batch.items) {
      if (item.containerTypeId !== containerTypeId || item.availableQty <= 0) continue;
      available += item.availableQty;
      if (pending === 0) continue;
      const taken = Math.min(pending, item.availableQty);
      lines.push({
        batchItemId: item.id,
        batchCode: batch.code,
        batchDate: batch.date,
        quantity: taken,
      });
      pending -= taken;
    }
  }

  return { lines, available, shortfall: pending };
}
