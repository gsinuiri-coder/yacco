import type { Prisma } from "@prisma/client";

/**
 * El orden FIFO de los ítems de lote: fecha y código del lote; dentro de un
 * lote, hora de la llenada (los renglones históricos sin hora primero) e id.
 * Es el mismo orden que expone `GET /production-batches`.
 *
 * Vive acá, y no copiado en cada lugar que consume llenos de la planta, porque
 * la regla es una sola (AGENTS.md: los lotes se consumen estrictamente del más
 * viejo al más nuevo): la carga de una ruta (`RoutesService.addLoad`) y el
 * conteo de la planta (`ContainerCountsService.countPlant`) la leen de acá.
 */
export const OLDEST_BATCH_ITEM_FIRST = [
  { batch: { date: "asc" } },
  { batch: { code: "asc" } },
  { createdAt: { sort: "asc", nulls: "first" } },
  { id: "asc" },
] satisfies Prisma.BatchItemOrderByWithRelationInput[];

/** The same FIFO order when the query starts from route_loads. */
export const OLDEST_ROUTE_LOAD_FIRST = [
  { batchItem: { batch: { date: "asc" } } },
  { batchItem: { batch: { code: "asc" } } },
  { batchItem: { createdAt: { sort: "asc", nulls: "first" } } },
  { batchItem: { id: "asc" } },
] satisfies Prisma.RouteLoadOrderByWithRelationInput[];
