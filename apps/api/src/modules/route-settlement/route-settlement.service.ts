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
  StopStatus,
} from "@prisma/client";
import type { RouteSettlement } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import type { CreateRouteSettlementDto } from "./dto/create-route-settlement.dto.js";
import type {
  ContainerDifferenceLineDto,
  ContainerQuantityLineDto,
  CreateRouteSettlementResponseDto,
  GetRouteSettlementResponseDto,
  RouteSettlementDto,
  RouteSettlementExpectedDto,
} from "./dto/route-settlement-response.dto.js";

interface Expected {
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
  emptiesPickedUp: number;
  emptiesPickedUpByType: ContainerQuantityLineDto[];
  totalSold: Prisma.Decimal;
  totalCollected: Prisma.Decimal;
  totalCashCollected: Prisma.Decimal;
  totalPendingConfirmation: Prisma.Decimal;
  totalOnCredit: Prisma.Decimal;
}

function toExpectedDto(expected: Expected): RouteSettlementExpectedDto {
  return {
    fullOut: expected.fullOut,
    fullDelivered: expected.fullDelivered,
    fullSold: expected.fullSold,
    emptiesPickedUp: expected.emptiesPickedUp,
    emptiesPickedUpByType: expected.emptiesPickedUpByType,
    totalSold: expected.totalSold.toFixed(2),
    totalCollected: expected.totalCollected.toFixed(2),
    totalCashCollected: expected.totalCashCollected.toFixed(2),
    totalPendingConfirmation: expected.totalPendingConfirmation.toFixed(2),
    totalOnCredit: expected.totalOnCredit.toFixed(2),
  };
}

/**
 * `emptiesCollectedByType` no sale de la fila: se reconstruye del ledger y
 * llega como argumento, por eso no hay una versión de un solo parámetro.
 */
function toSettlementDto(
  settlement: RouteSettlement,
  emptiesCollectedByType: ContainerQuantityLineDto[],
): RouteSettlementDto {
  return {
    routeId: settlement.routeId,
    fullOut: settlement.fullOut,
    fullDelivered: settlement.fullDelivered,
    fullSold: settlement.fullSold,
    fullReturned: settlement.fullReturned,
    emptiesCollected: settlement.emptiesCollected,
    emptiesCollectedByType,
    totalSold: settlement.totalSold.toFixed(2),
    totalCollected: settlement.totalCollected.toFixed(2),
    totalCashCollected: settlement.totalCashCollected.toFixed(2),
    totalPendingConfirmation: settlement.totalPendingConfirmation.toFixed(2),
    totalOnCredit: settlement.totalOnCredit.toFixed(2),
    notes: settlement.notes,
    settledById: settlement.settledById,
    settledAt: settlement.settledAt,
  };
}

/**
 * Dos líneas del mismo tipo de envase son un error de quien llama, no algo a
 * sumar en silencio: quien cuenta en la puerta cuenta UNA vez por tipo, y una
 * repetición delata una pantalla o un script mal armados. Mismo idioma que
 * `RoutesService.reorderStops` con los ids repetidos de su lista.
 */
function assertNoRepeatedContainerType(lines: { containerTypeId: string }[]): void {
  const seen = new Set(lines.map((line) => line.containerTypeId));
  if (seen.size !== lines.length) {
    throw new BadRequestException(
      "La lista de vacíos no puede repetir un tipo de envase: cada tipo va en una sola línea",
    );
  }
}

/**
 * La diferencia por tipo, sobre la UNIÓN de lo recogido y lo contado: un tipo
 * que solo aparece de un lado tiene diferencia igual a su propio número, y es
 * justo el caso que hay que ver. Ordenada por nombre, como las dos listas de
 * las que sale.
 */
function diffByType(
  pickedUp: ContainerQuantityLineDto[],
  collected: ContainerQuantityLineDto[],
): ContainerDifferenceLineDto[] {
  const pickedUpById = new Map(pickedUp.map((line) => [line.containerTypeId, line.quantity]));
  const collectedById = new Map(collected.map((line) => [line.containerTypeId, line.quantity]));
  const nameById = new Map(
    [...pickedUp, ...collected].map((line) => [line.containerTypeId, line.containerTypeName]),
  );

  return [...nameById]
    .map(([containerTypeId, containerTypeName]) => ({
      containerTypeId,
      containerTypeName,
      difference:
        (pickedUpById.get(containerTypeId) ?? 0) - (collectedById.get(containerTypeId) ?? 0),
    }))
    .sort((a, b) => a.containerTypeName.localeCompare(b.containerTypeName));
}

@Injectable()
export class RouteSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containerMovementsService: ContainerMovementsService,
  ) {}

  /**
   * Cuánto suma un tipo de movimiento de esta ruta, abierto por tipo de
   * envase. Parametrizado por tipo porque la liquidación necesita exactamente
   * la misma forma dos veces —lo recogido (`EMPTY_PICKUP`) y lo descargado
   * (`EMPTY_UNLOAD`)— y dos copias de un `groupBy` con su búsqueda de nombres
   * se desfasan en cuanto una de las dos cambie.
   *
   * El nombre se busca por los ids que efectivamente aparecieron, no sobre el
   * catálogo entero: así una línea de un tipo retirado —que `GET
   * /container-types` no devuelve— igual llega con su nombre.
   */
  private async sumByContainerType(
    client: Prisma.TransactionClient | PrismaService,
    routeId: string,
    type: ContainerMovementType,
  ): Promise<ContainerQuantityLineDto[]> {
    const grouped = await client.containerMovement.groupBy({
      by: ["containerTypeId"],
      where: { routeId, type },
      _sum: { quantity: true },
    });
    if (grouped.length === 0) return [];

    const containerTypes = await client.containerType.findMany({
      where: { id: { in: grouped.map((row) => row.containerTypeId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(
      containerTypes.map((containerType) => [containerType.id, containerType.name]),
    );

    return grouped
      .map((row) => ({
        containerTypeId: row.containerTypeId,
        containerTypeName: nameById.get(row.containerTypeId) ?? row.containerTypeId,
        quantity: row._sum.quantity ?? 0,
      }))
      .sort((a, b) => a.containerTypeName.localeCompare(b.containerTypeName));
  }

  /**
   * Everything a settlement needs that comes straight from the ledger, no
   * physical count involved — shared by the GET preview and the POST that
   * persists it, so the two can never disagree about what the books say.
   * `totalCollected` sums CONFIRMED and PENDING alike (a REJECTED payment
   * never arrived, so it never counts); `totalCashCollected` narrows that to
   * CONFIRMED rows on a method with `requiresConfirmation: false` — see
   * docs/backlog-tecnico.md for why that's a proxy, not a real `isCash` flag.
   * Sale/Payment have no routeId column, only `stopId`, so both join through
   * `stop: { routeId }` — the same relation-filter idiom already used
   * elsewhere in this codebase (e.g. SalesService.assertNoOpeningBalanceExists,
   * which joins `location: { customerId }` for the same reason: Sale has no
   * customerId column of its own either).
   */
  private async computeExpected(
    client: Prisma.TransactionClient | PrismaService,
    routeId: string,
  ): Promise<Expected> {
    const [
      fullOutAgg,
      fullDeliveredAgg,
      fullSoldAgg,
      emptiesPickedUpAgg,
      emptiesPickedUpByType,
      totalSoldAgg,
      collectedAgg,
      cashAgg,
      pendingAgg,
    ] = await Promise.all([
      client.routeLoad.aggregate({ where: { routeId }, _sum: { quantity: true } }),
      client.containerMovement.aggregate({
        where: { routeId, type: ContainerMovementType.LOAN_DELIVERY },
        _sum: { quantity: true },
      }),
      client.containerMovement.aggregate({
        where: { routeId, type: ContainerMovementType.FULL_SALE },
        _sum: { quantity: true },
      }),
      client.containerMovement.aggregate({
        where: { routeId, type: ContainerMovementType.EMPTY_PICKUP },
        _sum: { quantity: true },
      }),
      this.sumByContainerType(client, routeId, ContainerMovementType.EMPTY_PICKUP),
      client.sale.aggregate({ where: { stop: { routeId } }, _sum: { total: true } }),
      client.payment.aggregate({
        where: {
          stop: { routeId },
          status: { in: [PaymentStatus.CONFIRMED, PaymentStatus.PENDING] },
        },
        _sum: { amount: true },
      }),
      client.payment.aggregate({
        where: {
          stop: { routeId },
          status: PaymentStatus.CONFIRMED,
          paymentMethod: { requiresConfirmation: false },
        },
        _sum: { amount: true },
      }),
      client.payment.aggregate({
        where: { stop: { routeId }, status: PaymentStatus.PENDING },
        _sum: { amount: true },
      }),
    ]);

    const totalSold = totalSoldAgg._sum.total ?? new Prisma.Decimal(0);
    const totalCollected = collectedAgg._sum.amount ?? new Prisma.Decimal(0);

    return {
      fullOut: fullOutAgg._sum.quantity ?? 0,
      fullDelivered: fullDeliveredAgg._sum.quantity ?? 0,
      fullSold: fullSoldAgg._sum.quantity ?? 0,
      emptiesPickedUp: emptiesPickedUpAgg._sum.quantity ?? 0,
      emptiesPickedUpByType,
      totalSold,
      totalCollected,
      totalCashCollected: cashAgg._sum.amount ?? new Prisma.Decimal(0),
      totalPendingConfirmation: pendingAgg._sum.amount ?? new Prisma.Decimal(0),
      totalOnCredit: totalSold.minus(totalCollected),
    };
  }

  /**
   * Served whether the route is settled or not — this is the screen the
   * owner counts containers against at the door, so it has to work BEFORE
   * settling, not just after.
   */
  async getSettlementView(routeId: string): Promise<GetRouteSettlementResponseDto> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }

    const [expected, settlement, unresolvedStops] = await Promise.all([
      this.computeExpected(this.prisma, routeId),
      this.prisma.routeSettlement.findUnique({ where: { routeId } }),
      this.prisma.routeStop.count({ where: { routeId, status: StopStatus.PENDING } }),
    ]);

    // Solo tiene sentido preguntarlo si la ruta ya se liquidó: antes de eso no
    // hay ningún EMPTY_UNLOAD que reconstruir.
    const emptiesCollectedByType =
      settlement === null
        ? []
        : await this.sumByContainerType(this.prisma, routeId, ContainerMovementType.EMPTY_UNLOAD);

    return {
      expected: toExpectedDto(expected),
      settlement: settlement === null ? null : toSettlementDto(settlement, emptiesCollectedByType),
      unresolvedStops,
    };
  }

  /**
   * FINISHED -> SETTLED, and nothing else — same idiom as RoutesService's
   * start()/finish(): the status guard lives in the WHERE clause of the
   * UPDATE itself, so two simultaneous settlements of the same route have
   * exactly one succeed, and the loser's `count === 0` aborts before any
   * RouteSettlement row is written.
   *
   * Never blocks on a mismatch (HU-17: a difference is registered, not
   * prevented — same philosophy as a route settlement in the spec and as
   * `creditLimitExceeded` elsewhere) and never blocks on a payment still
   * PENDING (it's counted in totalPendingConfirmation and resolved later in
   * the confirmation tray, #66). `differences` is computed here and returned
   * but never stored: everything it's built from (fullOut/fullDelivered/
   * fullSold/fullReturned already persisted, EMPTY_PICKUP always
   * reconstructible from the ledger) already exists, so storing it again
   * would be a fact that could drift from its own source.
   *
   * **Liquidar es lo que devuelve los vacíos al galpón.** Cada línea contada
   * emite su `EMPTY_UNLOAD` (EMPTY_ON_ROUTE -> EMPTY_AT_PLANT), en esta misma
   * transacción: hasta que existió este productor, todo lo que el chofer
   * recogía se quedaba en `EMPTY_ON_ROUTE` para siempre, aunque en la planta
   * esos envases vuelven al galpón el mismo día.
   *
   * Se emite desde **lo contado en la puerta**, no desde lo que dice el libro,
   * y eso tiene una consecuencia que se acepta a conciencia: no hay ninguna
   * guarda de stock sobre `EMPTY_ON_ROUTE` —las que existen son sobre llenos
   * (`getRouteFullStock`, `availableQty`)—, así que si el chofer devuelve 40
   * de un tipo y el libro registró 34, el parque queda en −6 para ese tipo.
   * **Ese negativo es la información**: dice que hay seis recogidas que nadie
   * registró. Es exactamente el mismo razonamiento que el saldo negativo de
   * un cliente en `ContainerMovementsService.createWithinTransaction`.
   * Bloquearlo, redondearlo a cero o validarlo solo conseguiría que la
   * descarga no se registre, y entonces se pierden las dos cosas.
   *
   * El orden importa: `computeExpected` corre ANTES de emitir. Los números que
   * se devuelven y se persisten son los del libro previo a la descarga, que es
   * contra lo que la diferencia significa algo.
   *
   * Nada que agregar para la idempotencia: el `updateMany` de FINISHED ->
   * SETTLED ya hace que solo una liquidación simultánea gane, y la perdedora
   * aborta la transacción antes de emitir un solo movimiento.
   */
  async settle(
    routeId: string,
    dto: CreateRouteSettlementDto,
    actorId: string,
  ): Promise<CreateRouteSettlementResponseDto> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, status: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }

    assertNoRepeatedContainerType(dto.emptiesCollected);
    const emptiesCollectedTotal = dto.emptiesCollected.reduce(
      (sum, line) => sum + line.quantity,
      0,
    );

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.route.updateMany({
        where: { id: routeId, status: RouteStatus.FINISHED },
        data: { status: RouteStatus.SETTLED },
      });
      if (count === 0) {
        throw new ConflictException(
          `Solo se puede liquidar una ruta terminada; esta está en ${route.status}`,
        );
      }

      const expected = await this.computeExpected(tx, routeId);

      // Una línea en cero es válida y no emite nada: contar cero de un tipo es
      // un hecho, pero no es un movimiento de envases.
      for (const line of dto.emptiesCollected) {
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
          actorId,
          // Sin `locationId`: EMPTY_UNLOAD no toca "en cliente" por ningún
          // lado, así que no exige ubicación ni mueve ningún saldo de cliente.
          // Sin `stopId`: la descarga es de la ruta entera, no de una parada.
          { routeId },
        );
      }

      const settlement = await tx.routeSettlement.create({
        data: {
          routeId,
          fullOut: expected.fullOut,
          fullDelivered: expected.fullDelivered,
          fullSold: expected.fullSold,
          fullReturned: dto.fullReturned,
          emptiesCollected: emptiesCollectedTotal,
          totalSold: expected.totalSold,
          totalCollected: expected.totalCollected,
          totalCashCollected: expected.totalCashCollected,
          totalPendingConfirmation: expected.totalPendingConfirmation,
          totalOnCredit: expected.totalOnCredit,
          notes: dto.notes ?? null,
          settledById: actorId,
          settledAt: new Date(),
        },
      });

      // Releído del ledger, ya con los movimientos de arriba escritos, y no
      // armado del DTO: lo que se devuelve es lo que quedó registrado.
      const emptiesCollectedByType = await this.sumByContainerType(
        tx,
        routeId,
        ContainerMovementType.EMPTY_UNLOAD,
      );

      return {
        settlement: toSettlementDto(settlement, emptiesCollectedByType),
        differences: {
          containers:
            expected.fullOut - (expected.fullDelivered + expected.fullSold + dto.fullReturned),
          empties: expected.emptiesPickedUp - emptiesCollectedTotal,
          emptiesByType: diffByType(expected.emptiesPickedUpByType, emptiesCollectedByType),
        },
      };
    });
  }
}
