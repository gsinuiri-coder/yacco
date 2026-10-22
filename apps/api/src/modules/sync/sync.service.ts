import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, SyncOperationStatus } from "@prisma/client";
import type { SyncOperation } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { formatBusinessDate } from "../orders/orders.service.js";
import { RoutesService } from "../routes/routes.service.js";
import type { RouteActor } from "../routes/routes.service.js";
import type { SyncBatchDto, SyncOperationEnvelopeDto } from "./dto/sync-batch.dto.js";
import type {
  ResolveSyncOperationDto,
  SyncBatchResultDto,
  SyncOperationInReviewDto,
  SyncOperationResolutionDto,
  SyncOperationResultDto,
  SyncOperationStopContextDto,
} from "./dto/sync-response.dto.js";
import { SYNC_OPERATION_TYPES, readSyncOperation } from "./sync-operation-types.js";
import type { NormalizedSyncOperation } from "./sync-operation-types.js";

/**
 * Una operación que falla validación dos veces va a cuarentena
 * (sync-protocol, D-08). La primera vez vuelve como REJECTED sin cuarentena y
 * el celular la reintenta en el próximo envío.
 */
export const MAX_SYNC_ATTEMPTS = 2;

/**
 * Rechazos que dicen que el SERVIDOR cambió mientras el chofer no tenía señal
 * —la oficina marcó o corrigió la parada, terminó la ruta, la parada ya no
 * está— o que el chofer no puede tocar eso. Reintentar no cambia nada: gana
 * el servidor y la operación va a cuarentena en el primer intento, sin
 * perderse, para que la oficina la resuelva a mano.
 */
const SERVER_STATE_STATUSES = new Set<number>([
  HttpStatus.CONFLICT,
  HttpStatus.FORBIDDEN,
  HttpStatus.NOT_FOUND,
]);

/** Cuánto puede durar un lote: un día sin señal son decenas de entregas. */
const BATCH_TIMEOUT_MS = 60_000;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routesService: RoutesService,
  ) {}

  /**
   * El lote entero es UNA transacción (D-07): o se confirma con todo lo que
   * se aplicó y todo lo que se rechazó anotado, o no queda nada. Cada
   * operación corre dentro de su propio SAVEPOINT: si la rechaza una regla de
   * negocio se deshace solo ella, se anota el rechazo y el lote sigue (D-08).
   * Un error que no es de negocio —la base se cae, un bug— deshace el lote
   * entero y el celular lo vuelve a mandar igual: nunca queda aplicado a
   * medias en silencio.
   *
   * Se aplican en el orden en que el chofer las hizo (`clientTimestamp`), no
   * en el que llegaron.
   */
  async applyBatch(dto: SyncBatchDto, actor: RouteActor): Promise<SyncBatchResultDto> {
    assertUniqueIds(dto.operations);
    const operations = [...dto.operations].sort(
      (left, right) => Date.parse(left.clientTimestamp) - Date.parse(right.clientTimestamp),
    );
    const receivedAt = new Date();

    const results = await this.prisma.$transaction(
      async (tx) => {
        const batchResults: SyncOperationResultDto[] = [];
        for (const operation of operations) {
          batchResults.push(await this.applyOne(tx, operation, actor, receivedAt));
        }
        return batchResults;
      },
      { timeout: BATCH_TIMEOUT_MS },
    );

    for (const result of results.filter((candidate) => candidate.quarantined)) {
      // La alerta de hoy es la bandeja «Operaciones en revisión» y este log;
      // el correo del diseño (D-08) necesita un proveedor que no existe.
      this.logger.warn(
        `Operación ${result.id} del usuario ${actor.id} en cuarentena: ${result.reason ?? ""}`,
      );
    }
    return { results };
  }

  private async applyOne(
    tx: Prisma.TransactionClient,
    envelope: SyncOperationEnvelopeDto,
    actor: RouteActor,
    receivedAt: Date,
  ): Promise<SyncOperationResultDto> {
    // El id se reserva ANTES de leerlo: el celular reintenta cuando se le
    // corta la respuesta, y el reintento puede llegar con el primer lote
    // todavía en curso. Sin este candado los dos ven "no existe", el segundo
    // choca con lo que aplicó el primero y pisa su fila APPLIED con un
    // rechazo. Con él, el segundo espera al commit del primero y contesta
    // DUPLICATE. Una colisión de `hashtext` solo serializa dos ids distintos.
    // `$executeRaw` y no `$queryRaw`: la función devuelve `void`, que Prisma
    // no sabe deserializar como columna.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${envelope.id}))`;
    const existing = await tx.syncOperation.findUnique({ where: { id: envelope.id } });
    if (existing !== null) {
      const settled = settledResult(existing, actor);
      if (settled !== null) return settled;
    }

    const attempts = (existing?.attempts ?? 0) + 1;
    await tx.$executeRaw`SAVEPOINT sync_operation`;
    try {
      const operation = await readSyncOperation(envelope.type, envelope.version, envelope.payload);
      await this.dispatch(tx, operation, actor, operationInstant(envelope, receivedAt));
      await tx.$executeRaw`RELEASE SAVEPOINT sync_operation`;
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        throw error;
      }
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT sync_operation`;
      await tx.$executeRaw`RELEASE SAVEPOINT sync_operation`;
      const reason = messageOf(error);
      const quarantined =
        attempts >= MAX_SYNC_ATTEMPTS || SERVER_STATE_STATUSES.has(error.getStatus());
      await this.record(tx, envelope, actor, receivedAt, {
        status: SyncOperationStatus.REJECTED,
        attempts,
        rejectionReason: reason,
        quarantinedAt: quarantined ? receivedAt : null,
      });
      return { id: envelope.id, status: "REJECTED", quarantined, reason };
    }

    // Si antes la rechazó una vez, el motivo de ese rechazo se conserva junto
    // con `attempts`: es la historia de la operación, no un error vigente.
    await this.record(tx, envelope, actor, receivedAt, {
      status: SyncOperationStatus.APPLIED,
      attempts,
      appliedAt: receivedAt,
    });
    return { id: envelope.id, status: "APPLIED", quarantined: false };
  }

  /**
   * Por los MISMOS servicios que la web, nunca escribiendo directo: la regla
   * que vale en el PATCH de la oficina vale igual en el celular.
   */
  private async dispatch(
    tx: Prisma.TransactionClient,
    operation: NormalizedSyncOperation,
    actor: RouteActor,
    occurredAt: Date,
  ): Promise<void> {
    switch (operation.type) {
      case SYNC_OPERATION_TYPES.STOP_MARK: {
        const { routeId, stopId, ...mark } = operation.payload;
        await this.routesService.markStopWithinTransaction(
          tx,
          routeId,
          stopId,
          mark,
          actor,
          occurredAt,
        );
        return;
      }
      case SYNC_OPERATION_TYPES.STOP_ADD_VAN_SALE: {
        const { routeId, locationId, ...sale } = operation.payload;
        await this.routesService.addVanSaleStopWithinTransaction(
          tx,
          routeId,
          locationId,
          sale,
          actor,
          occurredAt,
        );
        return;
      }
    }
  }

  private async record(
    tx: Prisma.TransactionClient,
    envelope: SyncOperationEnvelopeDto,
    actor: RouteActor,
    receivedAt: Date,
    outcome: Pick<
      Prisma.SyncOperationUncheckedCreateInput,
      "status" | "attempts" | "rejectionReason" | "quarantinedAt" | "appliedAt"
    >,
  ): Promise<void> {
    // Lo que se guarda es lo que se intentó ESTA vez: si el segundo intento
    // trae otro contenido, la fila tiene que decir qué se aplicó o rechazó.
    const sent = {
      operationType: envelope.type,
      envelopeVersion: envelope.version,
      payload: envelope.payload as Prisma.InputJsonObject,
      clientTimestamp: new Date(envelope.clientTimestamp),
    };
    await tx.syncOperation.upsert({
      where: { id: envelope.id },
      create: { id: envelope.id, userId: actor.id, receivedAt, ...sent, ...outcome },
      update: { ...sent, ...outcome },
    });
  }

  /** La bandeja «Operaciones en revisión»: en cuarentena y sin resolver. */
  async listInReview(): Promise<SyncOperationInReviewDto[]> {
    const operations = await this.prisma.syncOperation.findMany({
      where: { quarantinedAt: { not: null }, resolvedAt: null },
      orderBy: { quarantinedAt: "asc" },
      include: { user: { select: { name: true } } },
    });
    const stops = await this.stopContexts(operations);

    return operations.map((operation) => {
      const stop = stops.get(stopIdOf(operation) ?? "");
      return {
        id: operation.id,
        type: operation.operationType,
        version: operation.envelopeVersion ?? 1,
        payload: operation.payload,
        driverName: operation.user.name,
        clientTimestamp: operation.clientTimestamp,
        receivedAt: operation.receivedAt ?? operation.appliedAt,
        quarantinedAt: operation.quarantinedAt as Date,
        attempts: operation.attempts ?? 1,
        rejectionReason: operation.rejectionReason ?? "",
        ...(stop !== undefined ? { stop } : {}),
      };
    });
  }

  /**
   * La oficina ya hizo lo que había que hacer —por lo general, corregir la
   * parada con la herramienta que existe— y la saca de la bandeja. No toca
   * nada más: la operación sigue REJECTED y su payload queda como llegó.
   */
  async resolve(
    id: string,
    dto: ResolveSyncOperationDto,
    actorId: string,
  ): Promise<SyncOperationResolutionDto> {
    const note = dto.note.trim();
    if (note.length === 0) {
      throw new BadRequestException("La nota de la revisión no puede estar vacía");
    }
    const resolvedAt = new Date();
    const { count } = await this.prisma.syncOperation.updateMany({
      where: { id, quarantinedAt: { not: null }, resolvedAt: null },
      data: { resolvedAt, resolvedById: actorId, resolutionNote: note },
    });
    if (count === 0) {
      const existing = await this.prisma.syncOperation.findUnique({
        where: { id },
        select: { quarantinedAt: true },
      });
      if (existing === null || existing.quarantinedAt === null) {
        throw new NotFoundException("Esa operación no está en revisión");
      }
      throw new ConflictException("Esa operación ya fue revisada");
    }
    return { id, resolvedAt, resolutionNote: note };
  }

  private async stopContexts(
    operations: SyncOperation[],
  ): Promise<Map<string, SyncOperationStopContextDto>> {
    const stopIds = operations
      .map((operation) => stopIdOf(operation))
      .filter((stopId): stopId is string => stopId !== null);
    if (stopIds.length === 0) return new Map();

    const stops = await this.prisma.routeStop.findMany({
      where: { id: { in: stopIds } },
      select: {
        id: true,
        status: true,
        route: { select: { id: true, date: true } },
        location: { select: { name: true, customer: { select: { name: true } } } },
      },
    });
    return new Map(
      stops.map((stop) => [
        stop.id,
        {
          routeId: stop.route.id,
          routeDate: formatBusinessDate(stop.route.date),
          stopId: stop.id,
          customerName: stop.location.customer.name,
          locationName: stop.location.name,
          stopStatus: stop.status,
        },
      ]),
    );
  }
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El payload llegó como vino: puede no tener `stopId`, o tener basura. */
function stopIdOf(operation: SyncOperation): string | null {
  if (operation.operationType !== SYNC_OPERATION_TYPES.STOP_MARK) return null;
  const payload = operation.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const stopId = (payload as Record<string, unknown>).stopId;
  return typeof stopId === "string" && UUID_TEXT.test(stopId) ? stopId : null;
}

/**
 * Una operación que ya pasó por acá: aplicada se contesta DUPLICATE y no se
 * vuelve a aplicar NUNCA (HU-16); en cuarentena se contesta igual que la vez
 * que entró. `null` = rechazada una vez, le toca su segundo intento.
 */
function settledResult(existing: SyncOperation, actor: RouteActor): SyncOperationResultDto | null {
  if (existing.userId !== actor.id) {
    // Un UUID repetido entre dos celulares no pasa por azar. Sin escribir
    // nada: la fila es de quien la mandó primero. En cuarentena para el
    // celular, que así deja de reintentarla.
    return {
      id: existing.id,
      status: "REJECTED",
      quarantined: true,
      reason: "Esa operación la mandó otro usuario",
    };
  }
  if (existing.status !== SyncOperationStatus.REJECTED) {
    return { id: existing.id, status: "DUPLICATE", quarantined: false };
  }
  if (existing.quarantinedAt !== null) {
    return {
      id: existing.id,
      status: "REJECTED",
      quarantined: true,
      reason: existing.rejectionReason ?? "",
    };
  }
  return null;
}

/**
 * La hora del celular, salvo que diga que es el futuro: un reloj adelantado
 * no puede fechar una venta después de que llegó.
 */
function operationInstant(envelope: SyncOperationEnvelopeDto, receivedAt: Date): Date {
  const clientInstant = new Date(envelope.clientTimestamp);
  return clientInstant.getTime() > receivedAt.getTime() ? receivedAt : clientInstant;
}

function messageOf(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === "string") return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(" | ");
  return typeof message === "string" ? message : error.message;
}

function assertUniqueIds(operations: SyncOperationEnvelopeDto[]): void {
  const ids = new Set(operations.map((operation) => operation.id.toLowerCase()));
  if (ids.size !== operations.length) {
    throw new BadRequestException("El lote trae dos operaciones con el mismo id");
  }
}
