import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { ContainerMovementType, ContainerState, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  ContainerMovementsService,
  lockLocation,
} from "../container-movements/container-movements.service.js";
import {
  assertContainerTypeExists,
  assertLocationExists,
} from "../container-movements/container-reference-guards.js";
import { OLDEST_BATCH_ITEM_FIRST } from "../production-batches/oldest-batch-first.js";
import type { CreateContainerCountDto } from "./dto/create-container-count.dto.js";
import type { ContainerCountResponseDto } from "./dto/container-count-response.dto.js";
import type { CreatePlantCountDto } from "./dto/create-plant-count.dto.js";
import type {
  PlantCountAdjustmentDto,
  PlantCountResponseDto,
} from "./dto/plant-count-response.dto.js";

/** Everything the wire shape needs, and nothing else. */
const COUNT_INCLUDE = {
  location: { select: { id: true, name: true } },
  containerType: { select: { id: true, name: true } },
} satisfies Prisma.ContainerCountInclude;

type CountWithRelations = Prisma.ContainerCountGetPayload<{ include: typeof COUNT_INCLUDE }>;

function toCountResponse(count: CountWithRelations): ContainerCountResponseDto {
  return {
    id: count.id,
    locationId: count.locationId,
    location: count.location,
    containerTypeId: count.containerTypeId,
    containerType: count.containerType,
    countedAt: count.countedAt,
    countedQuantity: count.countedQuantity,
    expectedQuantity: count.expectedQuantity,
    adjustmentId: count.adjustmentId,
    countedById: count.countedById,
  };
}

@Injectable()
export class ContainerCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containerMovementsService: ContainerMovementsService,
  ) {}

  /**
   * Registers one physical count — append-only, same rule as
   * ContainerMovement: there is deliberately no update()/remove() here or on
   * the controller. A single write method, in a single transaction:
   *
   * 1. Reads CustomerContainerBalance (0 if the pair has no row yet) as
   *    `expectedQuantity` — what the system believed a moment before this
   *    count.
   * 2. `delta = countedQuantity - expectedQuantity`. A positive delta means
   *    the customer has more than the books say (COUNT_ADJUSTMENT from
   *    outside the fleet into WITH_CUSTOMER); negative means fewer
   *    (WITH_CUSTOMER out). `expectedQuantity` may be negative (a return
   *    larger than the books said — a delivery nobody recorded), so a
   *    count of 0 yields a positive delta larger than what was counted:
   *    that adjustment is the unrecorded delivery finally entering the
   *    ledger. Zero means the count matched — the ledger's own
   *    CHECK requires a positive quantity, and a zero-quantity entry
   *    wouldn't say anything a movement can say anyway, so none is emitted.
   *    The count row is still written either way: a count that matches is
   *    proof of match, not a non-event.
   * 3. The movement, when there is one, is emitted through
   *    `ContainerMovementsService.createWithinTransaction` with this same
   *    transaction's client, so the ledger row and this count row commit or
   *    roll back together.
   *
   * `options.occurredAt` is not on `CreateContainerCountDto` for the same
   * reason `occurredAt`/`batchId` are not on `CreateContainerMovementDto`:
   * it is internal linkage only a trusted caller may set — here, the
   * customer-roster loader backdating a count taken before the system
   * existed. It becomes both this row's `countedAt` and the emitted
   * movement's `occurredAt`, so the ledger and this count agree on when it
   * happened. Defaults to now otherwise.
   *
   * `countedAt` is NOT reconstructible from container_movements: a matched
   * count (delta === 0) leaves no ledger trace at all, so the verification
   * date lives only here. The reconciliation routine (next PR) compares
   * quantities against the ledger, never dates, for exactly this reason.
   */
  async create(
    dto: CreateContainerCountDto,
    countedById: string,
    options?: { occurredAt?: Date },
  ): Promise<ContainerCountResponseDto> {
    const countedAt = options?.occurredAt ?? new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      // Existence only — deliberately NOT `active`. A physical count is an
      // observation: if the customer has three containers of a withdrawn
      // type, they have three, and the office withdrawing the type does not
      // take them off the counter. The COUNT_ADJUSTMENT this emits crosses
      // the fleet boundary (from null) and is therefore a record, not a
      // delivery, so ContainerMovementsService lets it through as well. Do
      // not "complete" this with an active check: it would make a withdrawn
      // type impossible to count, and therefore impossible to ever settle.
      await assertContainerTypeExists(tx, dto.containerTypeId);
      await assertLocationExists(tx, dto.locationId);
      // El mismo lock que toma todo movimiento sobre el saldo de esta
      // ubicación: dos conteos a la vez, o un conteo y una entrega, ya no
      // calculan su diferencia contra el mismo saldo.
      await lockLocation(tx, dto.locationId);

      const balance = await tx.customerContainerBalance.findUnique({
        where: {
          locationId_containerTypeId: {
            locationId: dto.locationId,
            containerTypeId: dto.containerTypeId,
          },
        },
      });
      const expectedQuantity = balance?.quantity ?? 0;
      const delta = dto.countedQuantity - expectedQuantity;

      let adjustmentId: string | null = null;
      if (delta !== 0) {
        const movement = await this.containerMovementsService.createWithinTransaction(
          tx,
          {
            type: ContainerMovementType.COUNT_ADJUSTMENT,
            containerTypeId: dto.containerTypeId,
            quantity: Math.abs(delta),
            locationId: dto.locationId,
            ...(delta > 0
              ? { toState: ContainerState.WITH_CUSTOMER }
              : { fromState: ContainerState.WITH_CUSTOMER }),
          },
          countedById,
          { occurredAt: countedAt },
        );
        adjustmentId = movement.id;
      }

      return tx.containerCount.create({
        data: {
          locationId: dto.locationId,
          containerTypeId: dto.containerTypeId,
          countedAt,
          countedQuantity: dto.countedQuantity,
          expectedQuantity,
          adjustmentId,
          countedById,
        },
        include: COUNT_INCLUDE,
      });
    });

    return toCountResponse(created);
  }

  /**
   * «Conteo de la planta»: el administrador cuenta los vacíos o los llenos de
   * un tipo de envase en el galpón y el libro pasa a decir lo contado. Lo
   * esperado es el saldo del libro en ese estado —puede ser negativo, si se
   * llenaron más bidones de los vacíos que figuraban (HU-01 E2)—.
   *
   * - Diferencia 0: no se escribe nada. A diferencia del conteo de un cliente
   *   no queda fila de conteo: `container_counts.location_id` es NOT NULL y
   *   la planta no es una ubicación. Lo que queda son los ajustes del libro.
   * - Vacíos: un COUNT_ADJUSTMENT por la diferencia, entrando al galpón desde
   *   afuera o saliendo de él.
   * - Llenos de menos: se descuentan del `available_qty` de los lotes en orden
   *   FIFO (`OLDEST_BATCH_ITEM_FIRST`, el mismo de la carga de una ruta), un
   *   ajuste por lote con su `batchId`, para que el libro y los lotes sigan
   *   diciendo lo mismo.
   * - Llenos de más: 400. Un lleno sin lote rompe el FIFO; se anota como lote
   *   en Producción.
   *
   * Todo en una transacción. La fila del tipo de envase se bloquea al
   * empezar, así dos conteos del mismo tipo enviados a la vez (un doble clic)
   * no descuentan dos veces: el segundo lee el libro que dejó el primero. Ese
   * bloqueo NO frena una carga de ruta, un lote o una liquidación que se
   * anote en el mismo instante: esas no lo toman, y lo contado se compara
   * contra el libro de un momento antes. Se acepta porque el conteo se hace
   * con el galpón quieto («El conteo de la planta no bloquea contra cargas,
   * lotes ni liquidaciones», backlog).
   *
   * Lo esperado de los llenos sale del libro, no de los lotes. Hoy pueden no
   * coincidir: una baja por daño de un lleno en planta baja el libro y no el
   * lote («Una baja de llenos en planta no descuenta el lote», backlog).
   */
  async countPlant(dto: CreatePlantCountDto, countedById: string): Promise<PlantCountResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const containerType = await assertContainerTypeExists(tx, dto.containerTypeId);
      await tx.$queryRaw`SELECT id FROM container_types WHERE id = ${dto.containerTypeId}::uuid FOR UPDATE`;

      const expectedQuantity = await this.containerMovementsService.getStateBalance(
        tx,
        dto.containerTypeId,
        dto.state,
      );
      const delta = dto.countedQuantity - expectedQuantity;
      const response = {
        containerType: { id: containerType.id, name: containerType.name },
        state: dto.state,
        expectedQuantity,
        countedQuantity: dto.countedQuantity,
      };
      if (delta === 0) {
        return { ...response, adjustments: [] };
      }

      if (dto.state === ContainerState.EMPTY_AT_PLANT) {
        const movement = await this.containerMovementsService.createWithinTransaction(
          tx,
          {
            type: ContainerMovementType.COUNT_ADJUSTMENT,
            containerTypeId: dto.containerTypeId,
            quantity: Math.abs(delta),
            ...(delta > 0
              ? { toState: ContainerState.EMPTY_AT_PLANT }
              : { fromState: ContainerState.EMPTY_AT_PLANT }),
          },
          countedById,
        );
        return {
          ...response,
          adjustments: [{ id: movement.id, quantity: movement.quantity, batch: null }],
        };
      }

      if (delta > 0) {
        throw new BadRequestException(
          `Se contaron ${dto.countedQuantity} llenos y el sistema tiene ${expectedQuantity}. Los llenos que faltan se anotan como lote en Producción.`,
        );
      }
      const adjustments = await this.consumeFullsOldestFirst(
        tx,
        dto.containerTypeId,
        -delta,
        countedById,
      );
      return { ...response, adjustments };
    });
  }

  /**
   * Saca `quantity` llenos de la planta lote por lote, del más viejo al más
   * nuevo. Cada descuento es un UPDATE guardado por `available_qty >= n`, igual
   * que la carga de una ruta: si una carga se llevó ese lote entre la lectura
   * y la escritura, el conteo se cancela entero en vez de dejar un lote en
   * negativo.
   */
  private async consumeFullsOldestFirst(
    tx: Prisma.TransactionClient,
    containerTypeId: string,
    quantity: number,
    countedById: string,
  ): Promise<PlantCountAdjustmentDto[]> {
    const items = await tx.batchItem.findMany({
      where: { containerTypeId, availableQty: { gt: 0 } },
      orderBy: OLDEST_BATCH_ITEM_FIRST,
      select: { id: true, availableQty: true, batch: { select: { id: true, code: true } } },
    });

    const adjustments: PlantCountAdjustmentDto[] = [];
    let remaining = quantity;
    for (const item of items) {
      if (remaining === 0) break;
      const taken = Math.min(item.availableQty, remaining);
      const { count } = await tx.batchItem.updateMany({
        where: { id: item.id, availableQty: { gte: taken } },
        data: { availableQty: { decrement: taken } },
      });
      if (count === 0) {
        throw new ConflictException(
          "Mientras se anotaba el conteo cambiaron los llenos de la planta. Vuelva a abrir el inventario y cuente de nuevo.",
        );
      }
      const movement = await this.containerMovementsService.createWithinTransaction(
        tx,
        {
          type: ContainerMovementType.COUNT_ADJUSTMENT,
          containerTypeId,
          quantity: taken,
          fromState: ContainerState.FULL_AT_PLANT,
        },
        countedById,
        { batchId: item.batch.id },
      );
      adjustments.push({ id: movement.id, quantity: taken, batch: item.batch });
      remaining -= taken;
    }

    if (remaining > 0) {
      // El libro dice más llenos en planta que los que quedan en los lotes:
      // no hay de dónde descontarlos sin inventar un lote. No debería pasar
      // (todo lleno entra por un lote), así que se frena en vez de adivinar.
      throw new ConflictException(
        "Los lotes no tienen tantos llenos disponibles como dice el inventario. Revise los lotes en Producción antes de contar.",
      );
    }
    return adjustments;
  }
}
