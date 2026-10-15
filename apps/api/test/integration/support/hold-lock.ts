import type { PrismaService } from "../../../src/prisma/prisma.service.js";
import { lockContainerTypes } from "../../../src/modules/container-movements/container-movements.service.js";

/** Cuánto se espera para afirmar que una petición sigue frenada. */
export const BLOCKED_FOR_MS = 1000;

/**
 * Abre una transacción que toma el bloqueo del tipo de envase, como un conteo
 * de la planta a mitad de camino, y lo sostiene hasta `release()`.
 */
export async function holdContainerTypeLock(
  prisma: PrismaService,
  containerTypeId: string,
): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      await lockContainerTypes(tx, [containerTypeId]);
      markLocked();
      await released;
    },
    { timeout: 30_000 },
  );
  await locked;
  return {
    release: async () => {
      release();
      await transaction;
    },
  };
}

/**
 * Sostiene el renglón de un ítem de lote mientras una corrección de carga
 * intenta reponerlo. Permite observar si la operación conserva bloqueada la
 * ruta hasta terminar, sin insertar esperas artificiales en producción.
 */
export async function holdBatchItemLock(
  prisma: PrismaService,
  batchItemId: string,
): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM batch_items WHERE id = ${batchItemId}::uuid FOR UPDATE`;
      markLocked();
      await released;
    },
    { timeout: 30_000 },
  );
  await locked;
  return {
    release: async () => {
      release();
      await transaction;
    },
  };
}

/** Sostiene una venta para ordenar de forma determinista altas y anulaciones concurrentes. */
export async function holdSaleLock(
  prisma: PrismaService,
  saleId: string,
): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
      markLocked();
      await released;
    },
    { timeout: 30_000 },
  );
  await locked;
  return {
    release: async () => {
      release();
      await transaction;
    },
  };
}

/**
 * Arranca `work` y dice si terminó dentro de `BLOCKED_FOR_MS`. Lo usa cada
 * test para afirmar que una escritura espera al bloqueo en vez de leer el
 * libro de un momento antes.
 */
export async function startAndCheckBlocked<T>(
  work: () => PromiseLike<T>,
): Promise<{ finishedWhileLocked: boolean; result: Promise<T> }> {
  let finished = false;
  const result = Promise.resolve(work()).then((value) => {
    finished = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, BLOCKED_FOR_MS));
  return { finishedWhileLocked: finished, result };
}
