import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ContainerMovementType,
  ContainerState,
  PaymentStatus,
  Prisma,
  RouteStatus,
} from "@prisma/client";
import { ROUTE_STATUS_LABELS } from "../../common/status-labels.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  ContainerMovementsService,
  lockContainerTypes,
} from "../container-movements/container-movements.service.js";
import { OLDEST_ROUTE_LOAD_FIRST } from "../production-batches/oldest-batch-first.js";
import {
  assertCanAccessRoute,
  assertIsOldestBatchItemWithStock,
  lockRouteAndReadStatus,
} from "../routes/routes.service.js";
import type { RouteActor } from "../routes/routes.service.js";
import type { CreateRoutePitStopDto } from "./dto/create-route-pit-stop.dto.js";
import type {
  RoutePitStopPreviewDto,
  RoutePitStopResponseDto,
} from "./dto/route-pit-stop-response.dto.js";
import type { VoidRoutePitStopDto } from "./dto/void-route-pit-stop.dto.js";

const PIT_STOP_INCLUDE = {
  recordedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  counts: {
    include: { containerType: { select: { id: true, name: true } } },
    orderBy: { containerType: { name: "asc" } },
  },
  loads: {
    include: {
      batchItem: {
        select: {
          id: true,
          containerTypeId: true,
          containerType: { select: { id: true, name: true } },
          batchId: true,
          batch: { select: { id: true, code: true } },
        },
      },
    },
    orderBy: { batchItem: { batch: { code: "asc" } } },
  },
  movements: {
    where: {
      type: { in: [ContainerMovementType.EMPTY_UNLOAD, ContainerMovementType.FULL_RETURN] },
    },
    include: { containerType: { select: { id: true, name: true } } },
    orderBy: { occurredAt: "asc" },
  },
  vehicleAssignments: {
    select: { vehicleId: true, reason: true },
    take: 1,
  },
} satisfies Prisma.RoutePitStopInclude;

type PitStopWithRelations = Prisma.RoutePitStopGetPayload<{ include: typeof PIT_STOP_INCLUDE }>;

function toPitStopResponse(pit: PitStopWithRelations): RoutePitStopResponseDto {
  const assignment = pit.vehicleAssignments?.[0];
  return {
    id: pit.id,
    routeId: pit.routeId,
    recordedById: pit.recordedById,
    recordedBy: pit.recordedBy,
    createdAt: pit.createdAt,
    notes: pit.notes,
    cashExpected: pit.cashExpected?.toFixed(2) ?? null,
    cashDelivered: pit.cashDelivered?.toFixed(2) ?? null,
    cashReason: pit.cashReason,
    voidedAt: pit.voidedAt,
    voidedById: pit.voidedById,
    voidedBy: pit.voidedBy,
    voidReason: pit.voidReason,
    vehicleId: assignment?.vehicleId ?? null,
    vehicleReason: assignment?.reason ?? null,
    counts: pit.counts.map((c) => ({
      id: c.id,
      pitStopId: c.pitStopId,
      containerTypeId: c.containerTypeId,
      containerType: c.containerType,
      expectedFull: c.expectedFull,
      countedFull: c.countedFull,
      expectedEmpty: c.expectedEmpty,
      countedEmpty: c.countedEmpty,
      differenceReason: c.differenceReason,
    })),
    loads: pit.loads.map((l) => ({
      id: l.id,
      batchItemId: l.batchItemId,
      quantity: l.quantity,
      batchItem: {
        id: l.batchItem.id,
        containerTypeId: l.batchItem.containerTypeId,
        containerType: l.batchItem.containerType,
        batchId: l.batchItem.batchId,
        batch: l.batchItem.batch,
      },
    })),
    unloads: pit.movements.map((m) => ({
      type: m.type as "EMPTY_UNLOAD" | "FULL_RETURN",
      containerTypeId: m.containerTypeId,
      containerType: m.containerType,
      quantity: m.quantity,
    })),
  };
}

@Injectable()
export class RoutePitStopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containerMovementsService: ContainerMovementsService,
  ) {}

  /**
   * Vista previa de lo esperado según el libro en este momento para la ruta:
   * llenos y vacíos arriba del camión por tipo de envase, y efectivo cobrado
   * menos lo entregado en paradas anteriores.
   */
  async preview(routeId: string, actor: RouteActor): Promise<RoutePitStopPreviewDto> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, driverId: true, status: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }
    assertCanAccessRoute(actor, route);

    const [containerTypes, fullMap, emptyMap, cashCollectedAgg, previousPitsAgg, previousCounts] =
      await Promise.all([
        this.prisma.containerType.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
        }),
        this.containerMovementsService.getRouteFullStockByType(routeId),
        this.containerMovementsService.getRouteEmptyStockByType(routeId),
        this.prisma.payment.aggregate({
          where: {
            stop: { routeId },
            voidedAt: null,
            status: PaymentStatus.CONFIRMED,
            paymentMethod: { requiresConfirmation: false },
          },
          _sum: { amount: true },
        }),
        this.prisma.routePitStop.aggregate({
          where: { routeId, voidedAt: null },
          _sum: { cashDelivered: true },
        }),
        this.prisma.routePitStopCount.findMany({
          where: { pitStop: { routeId, voidedAt: null } },
          select: {
            containerTypeId: true,
            expectedFull: true,
            countedFull: true,
            expectedEmpty: true,
            countedEmpty: true,
          },
        }),
      ]);

    const previousFullDiffMap = new Map<string, number>();
    const previousEmptyDiffMap = new Map<string, number>();
    for (const pc of previousCounts) {
      const fullDiff = pc.countedFull - pc.expectedFull;
      const emptyDiff = pc.countedEmpty - pc.expectedEmpty;
      previousFullDiffMap.set(
        pc.containerTypeId,
        (previousFullDiffMap.get(pc.containerTypeId) ?? 0) + fullDiff,
      );
      previousEmptyDiffMap.set(
        pc.containerTypeId,
        (previousEmptyDiffMap.get(pc.containerTypeId) ?? 0) + emptyDiff,
      );
    }

    const cashCollected = cashCollectedAgg._sum.amount ?? new Prisma.Decimal(0);
    const cashDeliveredInPreviousPits = previousPitsAgg._sum.cashDelivered ?? new Prisma.Decimal(0);
    const cashExpected = Prisma.Decimal.max(
      new Prisma.Decimal(0),
      cashCollected.minus(cashDeliveredInPreviousPits),
    );

    return {
      containers: containerTypes.map((ct) => ({
        containerTypeId: ct.id,
        containerTypeName: ct.name,
        expectedFull: fullMap.get(ct.id) ?? 0,
        expectedEmpty: emptyMap.get(ct.id) ?? 0,
        previousFullDifferences: previousFullDiffMap.get(ct.id) ?? 0,
        previousEmptyDifferences: previousEmptyDiffMap.get(ct.id) ?? 0,
      })),
      cash: {
        cashCollected: cashCollected.toFixed(2),
        cashDeliveredInPreviousPits: cashDeliveredInPreviousPits.toFixed(2),
        cashExpected: cashExpected.toFixed(2),
      },
    };
  }

  /**
   * Registra una parada en planta (pit stop) completa en una sola transacción:
   * cuadre de bidones (siempre), descarga (opcional), carga FIFO (opcional),
   * y entrega de efectivo (opcional). Solo para rutas en curso.
   */
  async create(
    routeId: string,
    dto: CreateRoutePitStopDto,
    actor: RouteActor,
  ): Promise<RoutePitStopResponseDto> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, driverId: true, status: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }
    assertCanAccessRoute(actor, route);
    if (route.status !== RouteStatus.IN_PROGRESS) {
      throw new ConflictException(
        `Solo se puede registrar una parada en planta en una ruta en curso; esta está ${ROUTE_STATUS_LABELS[route.status]}`,
      );
    }

    // Validar no duplicados en conteo
    const countTypeIds = dto.counts.map((c) => c.containerTypeId);
    if (new Set(countTypeIds).size !== countTypeIds.length) {
      throw new BadRequestException(
        "La lista de cuadre no puede repetir un tipo de envase: cada tipo va en una sola línea",
      );
    }

    if (dto.unloadEmpties !== undefined) {
      const unloadTypeIds = dto.unloadEmpties.map((u) => u.containerTypeId);
      if (new Set(unloadTypeIds).size !== unloadTypeIds.length) {
        throw new BadRequestException(
          "La lista de descarga de vacíos no puede repetir un tipo de envase",
        );
      }
    }

    if (dto.returnFulls !== undefined) {
      const returnTypeIds = dto.returnFulls.map((r) => r.containerTypeId);
      if (new Set(returnTypeIds).size !== returnTypeIds.length) {
        throw new BadRequestException(
          "La lista de retorno de llenos no puede repetir un tipo de envase",
        );
      }
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        const lockedStatus = await lockRouteAndReadStatus(tx, routeId);
        if (lockedStatus !== RouteStatus.IN_PROGRESS) {
          throw new ConflictException(
            `Solo se puede registrar una parada en planta en una ruta en curso; esta está ${ROUTE_STATUS_LABELS[lockedStatus]}`,
          );
        }

        // Bloqueo de tipos de envase tocados
        const touchedContainerTypes = new Set<string>(countTypeIds);
        if (dto.unloadEmpties !== undefined) {
          for (const u of dto.unloadEmpties) touchedContainerTypes.add(u.containerTypeId);
        }
        if (dto.returnFulls !== undefined) {
          for (const r of dto.returnFulls) touchedContainerTypes.add(r.containerTypeId);
        }
        if (dto.loads !== undefined && dto.loads.length > 0) {
          const loadItems = await tx.batchItem.findMany({
            where: { id: { in: dto.loads.map((l) => l.batchItemId) } },
            select: { containerTypeId: true },
          });
          for (const li of loadItems) touchedContainerTypes.add(li.containerTypeId);
        }
        await lockContainerTypes(tx, Array.from(touchedContainerTypes));

        // 1. Validar cuadre contra lo esperado según el libro
        const [fullMap, emptyMap] = await Promise.all([
          this.containerMovementsService.getRouteFullStockByType(routeId),
          this.containerMovementsService.getRouteEmptyStockByType(routeId, tx),
        ]);

        for (const countItem of dto.counts) {
          const expFull = fullMap.get(countItem.containerTypeId) ?? 0;
          const expEmpty = emptyMap.get(countItem.containerTypeId) ?? 0;
          const hasDiff = countItem.countedFull !== expFull || countItem.countedEmpty !== expEmpty;
          if (hasDiff && (countItem.differenceReason?.trim() ?? "") === "") {
            throw new BadRequestException(
              "Se requiere un motivo para la diferencia en el conteo de envases",
            );
          }
        }

        // 2. Efectivo
        let cashExpected: Prisma.Decimal | null = null;
        let cashDelivered: Prisma.Decimal | null = null;
        let cashReason: string | null = null;

        if (dto.cashDelivered !== undefined) {
          const [cashCollectedAgg, previousPitsAgg] = await Promise.all([
            tx.payment.aggregate({
              where: {
                stop: { routeId },
                voidedAt: null,
                status: PaymentStatus.CONFIRMED,
                paymentMethod: { requiresConfirmation: false },
              },
              _sum: { amount: true },
            }),
            tx.routePitStop.aggregate({
              where: { routeId, voidedAt: null },
              _sum: { cashDelivered: true },
            }),
          ]);

          const totalCollected = cashCollectedAgg._sum.amount ?? new Prisma.Decimal(0);
          const previouslyDelivered = previousPitsAgg._sum.cashDelivered ?? new Prisma.Decimal(0);
          const expectedCash = Prisma.Decimal.max(
            new Prisma.Decimal(0),
            totalCollected.minus(previouslyDelivered),
          );

          cashExpected = expectedCash;
          cashDelivered = new Prisma.Decimal(dto.cashDelivered);

          if (cashDelivered.greaterThan(expectedCash)) {
            if ((dto.cashReason?.trim() ?? "") === "") {
              throw new BadRequestException(
                "Se requiere un motivo si el efectivo entregado supera lo esperado",
              );
            }
            cashReason = dto.cashReason!.trim();
          } else {
            cashReason = dto.cashReason?.trim() ?? null;
          }
        }

        // Crear route_pit_stops
        const pitStop = await tx.routePitStop.create({
          data: {
            routeId,
            recordedById: actor.id,
            notes: dto.notes?.trim() ?? null,
            cashExpected,
            cashDelivered,
            cashReason,
          },
        });

        // Crear route_pit_stop_counts
        for (const countItem of dto.counts) {
          const expFull = fullMap.get(countItem.containerTypeId) ?? 0;
          const expEmpty = emptyMap.get(countItem.containerTypeId) ?? 0;
          await tx.routePitStopCount.create({
            data: {
              pitStopId: pitStop.id,
              containerTypeId: countItem.containerTypeId,
              expectedFull: expFull,
              countedFull: countItem.countedFull,
              expectedEmpty: expEmpty,
              countedEmpty: countItem.countedEmpty,
              differenceReason: countItem.differenceReason?.trim() ?? null,
            },
          });
        }

        // 3. Descarga de vacíos (EMPTY_UNLOAD)
        if (dto.unloadEmpties !== undefined) {
          for (const line of dto.unloadEmpties) {
            if (line.quantity === 0) continue;
            await this.containerMovementsService.createWithinTransaction(
              tx,
              {
                type: ContainerMovementType.EMPTY_UNLOAD,
                containerTypeId: line.containerTypeId,
                quantity: line.quantity,
                fromState: ContainerState.EMPTY_ON_ROUTE,
                toState: ContainerState.EMPTY_AT_PLANT,
              },
              actor.id,
              { routeId, pitStopId: pitStop.id },
            );
          }
        }

        // 4. Descarga de llenos (FULL_RETURN), reponiendo lote FIFO
        if (dto.returnFulls !== undefined && dto.returnFulls.length > 0) {
          const routeLoads = await tx.routeLoad.findMany({
            where: {
              routeId,
              OR: [{ pitStopId: null }, { pitStop: { voidedAt: null } }],
            },
            select: {
              batchItemId: true,
              quantity: true,
              batchItem: { select: { containerTypeId: true, batchId: true } },
            },
            orderBy: OLDEST_ROUTE_LOAD_FIRST,
          });

          for (const line of dto.returnFulls) {
            if (line.quantity === 0) continue;
            const ofType = routeLoads.filter(
              (l) => l.batchItem.containerTypeId === line.containerTypeId,
            );
            const totalLoaded = ofType.reduce((sum, l) => sum + l.quantity, 0);
            if (line.quantity > totalLoaded) {
              throw new BadRequestException(
                `Se devolvieron ${line.quantity} llenos de un tipo de envase del que la ruta cargó ${totalLoaded}: no pueden volver más de los que salieron en el camión`,
              );
            }

            let pending = line.quantity;
            for (const load of ofType) {
              if (pending === 0) break;
              const back = Math.min(pending, load.quantity);
              pending -= back;
              await tx.batchItem.update({
                where: { id: load.batchItemId },
                data: { availableQty: { increment: back } },
              });
              await this.containerMovementsService.createWithinTransaction(
                tx,
                {
                  type: ContainerMovementType.FULL_RETURN,
                  containerTypeId: line.containerTypeId,
                  quantity: back,
                  fromState: ContainerState.FULL_ON_ROUTE,
                  toState: ContainerState.FULL_AT_PLANT,
                },
                actor.id,
                { batchId: load.batchItem.batchId, routeId, pitStopId: pitStop.id },
              );
            }
          }
        }

        // 5. Carga FIFO (ROUTE_LOAD)
        if (dto.loads !== undefined) {
          for (const loadDto of dto.loads) {
            if (loadDto.quantity === 0) continue;
            const batchItem = await tx.batchItem.findUnique({
              where: { id: loadDto.batchItemId },
              select: { id: true, batchId: true, containerTypeId: true },
            });
            if (batchItem === null) {
              throw new BadRequestException(`El ítem de lote "${loadDto.batchItemId}" no existe`);
            }

            await assertIsOldestBatchItemWithStock(tx, batchItem);

            const { count } = await tx.batchItem.updateMany({
              where: { id: loadDto.batchItemId, availableQty: { gte: loadDto.quantity } },
              data: { availableQty: { decrement: loadDto.quantity } },
            });
            if (count === 0) {
              throw new BadRequestException(
                `Stock insuficiente en el ítem de lote "${loadDto.batchItemId}" para cargar ${loadDto.quantity} unidades`,
              );
            }

            await this.containerMovementsService.createWithinTransaction(
              tx,
              {
                type: ContainerMovementType.ROUTE_LOAD,
                containerTypeId: batchItem.containerTypeId,
                quantity: loadDto.quantity,
                fromState: ContainerState.FULL_AT_PLANT,
                toState: ContainerState.FULL_ON_ROUTE,
              },
              actor.id,
              { batchId: batchItem.batchId, routeId, pitStopId: pitStop.id },
            );

            await tx.routeLoad.create({
              data: {
                routeId,
                batchItemId: loadDto.batchItemId,
                quantity: loadDto.quantity,
                pitStopId: pitStop.id,
              },
            });
          }
        }

        // 6. Cambio de vehículo en el pit (opcional)
        if (dto.vehicleId !== undefined && dto.vehicleId !== null) {
          const vehicle = await tx.vehicle.findUnique({
            where: { id: dto.vehicleId },
            select: { id: true, plate: true, active: true },
          });
          if (vehicle === null) {
            throw new BadRequestException(`El vehículo "${dto.vehicleId}" no existe`);
          }
          if (!vehicle.active) {
            throw new BadRequestException(`El vehículo "${vehicle.plate}" está desactivado`);
          }

          await tx.routeVehicleAssignment.create({
            data: {
              routeId,
              vehicleId: dto.vehicleId,
              assignedById: actor.id,
              reason: dto.vehicleReason?.trim() || null,
              pitStopId: pitStop.id,
            },
          });
          await tx.route.update({
            where: { id: routeId },
            data: { vehicleId: dto.vehicleId },
          });
        }

        return tx.routePitStop.findUniqueOrThrow({
          where: { id: pitStop.id },
          include: PIT_STOP_INCLUDE,
        });
      },
      { timeout: 15_000 },
    );

    return toPitStopResponse(created);
  }

  /**
   * Lista las paradas en planta de la ruta, ordenadas cronológicamente.
   */
  async findAll(routeId: string, actor: RouteActor): Promise<RoutePitStopResponseDto[]> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, driverId: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }
    assertCanAccessRoute(actor, route);

    const pitStops = await this.prisma.routePitStop.findMany({
      where: { routeId },
      include: PIT_STOP_INCLUDE,
      orderBy: { createdAt: "asc" },
    });

    return pitStops.map(toPitStopResponse);
  }

  /**
   * Anula el último pit stop no anulado de la ruta (ADMIN only con motivo obligatorio).
   * Emite movimientos inversos para su carga y su descarga, y deja de contar su efectivo.
   */
  async voidPitStop(
    routeId: string,
    pitStopId: string,
    dto: VoidRoutePitStopDto,
    actor: RouteActor,
  ): Promise<RoutePitStopResponseDto> {
    const voidReason = dto.voidReason?.trim();
    if (!voidReason) {
      throw new BadRequestException("El motivo de anulación es obligatorio");
    }

    const updated = await this.prisma.$transaction(
      async (tx) => {
        const lockedStatus = await lockRouteAndReadStatus(tx, routeId);
        if (lockedStatus === RouteStatus.SETTLED) {
          throw new ConflictException(
            "No se puede anular una parada en planta de una ruta ya liquidada",
          );
        }

        const pitStop = await tx.routePitStop.findFirst({
          where: { id: pitStopId, routeId },
        });
        if (pitStop === null) {
          throw new NotFoundException(`La parada en planta "${pitStopId}" no existe en esta ruta`);
        }
        if (pitStop.voidedAt !== null) {
          throw new ConflictException("Esta parada en planta ya fue anulada");
        }

        // Validar que sea la ÚLTIMA parada en planta no anulada
        const newerActivePit = await tx.routePitStop.findFirst({
          where: {
            routeId,
            createdAt: { gt: pitStop.createdAt },
            voidedAt: null,
          },
        });
        if (newerActivePit !== null) {
          throw new ConflictException(
            "Solo se puede anular la última parada en planta no anulada de la ruta",
          );
        }

        // Marcar la anulación
        await tx.routePitStop.update({
          where: { id: pitStopId },
          data: {
            voidedAt: new Date(),
            voidedById: actor.id,
            voidReason,
          },
        });

        // 1. Invertir cargas del pit stop
        const loads = await tx.routeLoad.findMany({
          where: { pitStopId },
          include: { batchItem: true },
        });
        for (const load of loads) {
          await tx.batchItem.update({
            where: { id: load.batchItemId },
            data: { availableQty: { increment: load.quantity } },
          });
          await this.containerMovementsService.createWithinTransaction(
            tx,
            {
              type: ContainerMovementType.ROUTE_LOAD_VOID,
              containerTypeId: load.batchItem.containerTypeId,
              quantity: load.quantity,
              fromState: ContainerState.FULL_ON_ROUTE,
              toState: ContainerState.FULL_AT_PLANT,
            },
            actor.id,
            { batchId: load.batchItem.batchId, routeId, pitStopId },
          );
        }

        // 2. Invertir descargas del pit stop (EMPTY_UNLOAD y FULL_RETURN)
        const unloads = await tx.containerMovement.findMany({
          where: {
            pitStopId,
            type: { in: [ContainerMovementType.EMPTY_UNLOAD, ContainerMovementType.FULL_RETURN] },
          },
        });
        for (const unload of unloads) {
          if (unload.type === ContainerMovementType.EMPTY_UNLOAD) {
            await this.containerMovementsService.createWithinTransaction(
              tx,
              {
                type: ContainerMovementType.EMPTY_UNLOAD_VOID,
                containerTypeId: unload.containerTypeId,
                quantity: unload.quantity,
                fromState: ContainerState.EMPTY_AT_PLANT,
                toState: ContainerState.EMPTY_ON_ROUTE,
              },
              actor.id,
              { routeId, pitStopId },
            );
          } else if (unload.type === ContainerMovementType.FULL_RETURN) {
            if (unload.batchId !== null) {
              const item = await tx.batchItem.findFirst({
                where: { batchId: unload.batchId, containerTypeId: unload.containerTypeId },
              });
              if (item !== null && item.availableQty > 0) {
                const dec = Math.min(item.availableQty, unload.quantity);
                await tx.batchItem.update({
                  where: { id: item.id },
                  data: { availableQty: { decrement: dec } },
                });
              }
            }
            await this.containerMovementsService.createWithinTransaction(
              tx,
              {
                type: ContainerMovementType.FULL_RETURN_VOID,
                containerTypeId: unload.containerTypeId,
                quantity: unload.quantity,
                fromState: ContainerState.FULL_AT_PLANT,
                toState: ContainerState.FULL_ON_ROUTE,
              },
              actor.id,
              {
                ...(unload.batchId !== null ? { batchId: unload.batchId } : {}),
                routeId,
                pitStopId,
              },
            );
          }
        }

        // 3. Revertir vehículo si este pit stop cambió el vehículo
        const pitAssignment = await tx.routeVehicleAssignment.findFirst({
          where: { pitStopId },
        });
        if (pitAssignment !== null) {
          const previousAssignment = await tx.routeVehicleAssignment.findFirst({
            where: {
              routeId,
              id: { not: pitAssignment.id },
              OR: [{ pitStopId: null }, { pitStop: { voidedAt: null, id: { not: pitStopId } } }],
            },
            orderBy: { createdAt: "desc" },
          });
          await tx.route.update({
            where: { id: routeId },
            data: { vehicleId: previousAssignment ? previousAssignment.vehicleId : null },
          });
        }

        return tx.routePitStop.findUniqueOrThrow({
          where: { id: pitStopId },
          include: PIT_STOP_INCLUDE,
        });
      },
      { timeout: 15_000 },
    );

    return toPitStopResponse(updated);
  }
}
