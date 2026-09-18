import { MAX_ITEM_QUANTITY } from "@yacco/shared";
import type { ContainerType, CreateProductionBatchBody, ProductionBatch } from "@yacco/shared";
import { positiveWhole } from "./quantity";

/** Una línea del lote mientras se arma. `key` es sólo para Vue. */
export interface BatchLineDraft {
  key: number;
  containerTypeId: string;
  producedQty: string;
}

export function blankBatchLine(key: number): BatchLineDraft {
  return { key, containerTypeId: "", producedQty: "" };
}

/** Las reglas de CreateProductionBatchItemDto (el tope es el mismo de un pedido). */
export function checkBatchLine(line: BatchLineDraft): string | undefined {
  if (line.containerTypeId === "") return "Elige un tipo de envase";
  const quantity = positiveWhole(line.producedQty);
  if (quantity === null) return "La cantidad producida debe ser un número entero mayor que 0";
  if (quantity > MAX_ITEM_QUANTITY) {
    return `La cantidad producida no puede superar ${MAX_ITEM_QUANTITY}`;
  }
  return undefined;
}

/**
 * Los tipos que puede elegir una línea: los que no están ya en OTRA línea. La
 * API rechaza una línea repetida; mejor no ofrecerla que dejar fallar el envío.
 */
export function typesForLine(
  catalog: readonly ContainerType[],
  lines: readonly BatchLineDraft[],
  index: number,
): ContainerType[] {
  const takenElsewhere = new Set(
    lines.filter((_, i) => i !== index).map((line) => line.containerTypeId),
  );
  return catalog.filter((type) => !takenElsewhere.has(type.id));
}

export function batchBody(
  code: string,
  date: string,
  notes: string,
  lines: readonly BatchLineDraft[],
): CreateProductionBatchBody {
  return {
    code: code.trim(),
    // "AAAA-MM-DD" tal cual sale del campo de fecha.
    date,
    ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
    items: lines.map((line) => ({
      containerTypeId: line.containerTypeId,
      producedQty: positiveWhole(line.producedQty) ?? 0,
    })),
  };
}

/** "30× Bidón 20L, 12× Botella 7L". */
function summarize(entries: Array<{ quantity: number; name: string }>): string {
  return entries.map((entry) => `${entry.quantity}× ${entry.name}`).join(", ");
}

export function producedSummary(batch: ProductionBatch): string {
  return summarize(
    batch.items.map((item) => ({ quantity: item.producedQty, name: item.containerType.name })),
  );
}

/**
 * Lo que del lote todavía no salió en ninguna ruta. Las rutas consumen los
 * lotes del más viejo al más nuevo; sin este dato no hay forma de ver cuál va a
 * salir primero. Un lote agotado dice «Todo cargado», no un cero suelto.
 */
export function remainingSummary(batch: ProductionBatch): string {
  const remaining = batch.items.filter((item) => item.availableQty > 0);
  if (remaining.length === 0) return "Todo cargado";
  return summarize(
    remaining.map((item) => ({ quantity: item.availableQty, name: item.containerType.name })),
  );
}
