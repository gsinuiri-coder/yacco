import type { Prisma } from "@prisma/client";

/**
 * El orden FIFO de los ítems de lote: fecha del lote y, entre dos lotes del
 * mismo día, su código (único, así que el "más antiguo" nunca es ambiguo). Es
 * el mismo orden de `GET /production-batches`.
 *
 * Vive acá, y no copiado en cada lugar que consume llenos de la planta, porque
 * la regla es una sola (AGENTS.md: los lotes se consumen estrictamente del más
 * viejo al más nuevo): la carga de una ruta (`RoutesService.addLoad`) y el
 * conteo de la planta (`ContainerCountsService.countPlant`) la leen de acá.
 */
export const OLDEST_BATCH_ITEM_FIRST = [
  { batch: { date: "asc" } },
  { batch: { code: "asc" } },
] satisfies Prisma.BatchItemOrderByWithRelationInput[];
