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
   * Lo que esta ruta registró de un tipo de movimiento, NETO de sus
   * anulaciones. Un LOAN_DELIVERY que después se anuló no se entregó: la
   * liquidación tiene que contar 0, no 1 y otra vez 1.
   *
   * Se restan por su propio tipo y no por sus estados porque acá se agrega
   * por `type`: si la anulación se hubiera modelado como un LOAN_DELIVERY al
   * revés, este mismo `aggregate` la sumaría a lo entregado en vez de
   * restarla. Ver container-movement-transitions.ts.
   *
   * Los dos lados filtran por `routeId`, así que quien emita la anulación
   * tiene que etiquetarla con la MISMA ruta que el movimiento que anula. Una
   * anulación sin `routeId` no se resta acá, y la liquidación seguiría
   * contando como hecha una entrega que no pasó.
   */
  private async netSum(
    client: Prisma.TransactionClient | PrismaService,
    routeId: string,
    type: ContainerMovementType,
    voidType: ContainerMovementType,
  ): Promise<number> {
    const [recorded, voided] = await Promise.all([
      client.containerMovement.aggregate({ where: { routeId, type }, _sum: { quantity: true } }),
      client.containerMovement.aggregate({
        where: { routeId, type: voidType },
        _sum: { quantity: true },
      }),
    ]);
    return (recorded._sum.quantity ?? 0) - (voided._sum.quantity ?? 0);
  }

  /**
   * Cuánto suma un tipo de movimiento de esta ruta, abierto por tipo de
   * envase. Parametrizado por tipo porque la liquidación necesita exactamente
   * la misma forma dos veces —lo recogido (`EMPTY_PICKUP`) y lo descargado
   * (`EMPTY_UNLOAD`)— y dos copias de un `groupBy` con su búsqueda de nombres
   * se desfasan en cuanto una de las dos cambie.
   *
   * `voidType` es la versión por tipo de envase de lo que hace `netSum` con el
   * total: cuando se pasa, cada línea sale neta de sus anulaciones. Es
   * opcional porque solo uno de los dos usos lo necesita —lo recogido puede
   * anularse, lo descargado en la puerta no: eso se contó a mano y su
   * corrección es otra cuenta, no una anulación—. Un solo `groupBy` sobre los
   * dos tipos, abierto también por `type`, en vez de dos consultas: la resta
   * se hace acá con el signo.
   *
   * **Una línea que queda en cero se conserva.** Que un tipo de envase se haya
   * recogido y anulado entero es información, y `diffByType` trata la ausencia
   * de una línea como cero — descartarla la haría indistinguible de un tipo
   * que nunca pasó por esta ruta, que es justo lo contrario de lo que pasó.
   *
   * El nombre se busca por los ids que efectivamente aparecieron, no sobre el
   * catálogo entero: así una línea de un tipo retirado —que `GET
   * /container-types` no devuelve— igual llega con su nombre.
   */
  private async sumByContainerType(
    client: Prisma.TransactionClient | PrismaService,
    routeId: string,
    type: ContainerMovementType,
    voidType?: ContainerMovementType,
  ): Promise<ContainerQuantityLineDto[]> {
    const types = voidType === undefined ? [type] : [type, voidType];
    const grouped = await client.containerMovement.groupBy({
      by: ["containerTypeId", "type"],
      where: { routeId, type: { in: types } },
      _sum: { quantity: true },
    });
    if (grouped.length === 0) return [];

    const netByContainerType = new Map<string, number>();
    for (const row of grouped) {
      const signed = (row._sum.quantity ?? 0) * (row.type === voidType ? -1 : 1);
      netByContainerType.set(
        row.containerTypeId,
        (netByContainerType.get(row.containerTypeId) ?? 0) + signed,
      );
    }

    const containerTypes = await client.containerType.findMany({
      where: { id: { in: [...netByContainerType.keys()] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(
      containerTypes.map((containerType) => [containerType.id, containerType.name]),
    );

    return [...netByContainerType]
      .map(([containerTypeId, quantity]) => ({
        containerTypeId,
        containerTypeName: nameById.get(containerTypeId) ?? containerTypeId,
        quantity,
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
   *
   * **Todo lo que se cuenta acá es neto de lo anulado.** Los tres conteos de
   * envases pasan por `netSum`, que resta el tipo de anulación de cada uno, y
   * los cuatro `aggregate` de dinero filtran `voidedAt: null`: una venta o un
   * cobro anulados no son plata que el chofer tenga que rendir, así que
   * contarlos le pediría en la puerta un dinero que nadie le dio.
   *
   * `ContainerMovementsService.getRouteFullStock` y `inventory()` NO aparecen
   * acá y no es un olvido: las dos calculan por `fromState`/`toState`, no por
   * `type`, así que los movimientos de anulación las corrigen solas —un
   * LOAN_DELIVERY_VOID devuelve sus llenos a FULL_ON_ROUTE sin que ninguna de
   * las dos tenga que enterarse de que existe el tipo—. Esa asimetría es la
   * razón entera por la que las anulaciones son tipos propios y no pares
   * nuevos: quien lee por estados no necesita cambiar, quien lee por `type`
   * sí, y este método es el único que lee por `type`.
   */
  private async computeExpected(
    client: Prisma.TransactionClient | PrismaService,
    routeId: string,
  ): Promise<Expected> {
    const [
      fullOutAgg,
      fullDelivered,
      fullSold,
      emptiesPickedUp,
      emptiesPickedUpByType,
      totalSoldAgg,
      collectedAgg,
      cashAgg,
      pendingAgg,
    ] = await Promise.all([
      client.routeLoad.aggregate({ where: { routeId }, _sum: { quantity: true } }),
      this.netSum(
        client,
        routeId,
        ContainerMovementType.LOAN_DELIVERY,
        ContainerMovementType.LOAN_DELIVERY_VOID,
      ),
      this.netSum(
        client,
        routeId,
        ContainerMovementType.FULL_SALE,
        ContainerMovementType.FULL_SALE_VOID,
      ),
      this.netSum(
        client,
        routeId,
        ContainerMovementType.EMPTY_PICKUP,
        ContainerMovementType.EMPTY_PICKUP_VOID,
      ),
      this.sumByContainerType(
        client,
        routeId,
        ContainerMovementType.EMPTY_PICKUP,
        ContainerMovementType.EMPTY_PICKUP_VOID,
      ),
      client.sale.aggregate({
        where: { stop: { routeId }, voidedAt: null },
        _sum: { total: true },
      }),
      client.payment.aggregate({
        where: {
          stop: { routeId },
          voidedAt: null,
          status: { in: [PaymentStatus.CONFIRMED, PaymentStatus.PENDING] },
        },
        _sum: { amount: true },
      }),
      client.payment.aggregate({
        where: {
          stop: { routeId },
          voidedAt: null,
          status: PaymentStatus.CONFIRMED,
          paymentMethod: { requiresConfirmation: false },
        },
        _sum: { amount: true },
      }),
      client.payment.aggregate({
        where: { stop: { routeId }, voidedAt: null, status: PaymentStatus.PENDING },
        _sum: { amount: true },
      }),
    ]);

    const totalSold = totalSoldAgg._sum.total ?? new Prisma.Decimal(0);
    const totalCollected = collectedAgg._sum.amount ?? new Prisma.Decimal(0);

    return {
      fullOut: fullOutAgg._sum.quantity ?? 0,
      fullDelivered,
      fullSold,
      emptiesPickedUp,
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

    const [expected, settlement, unresolvedStops, lastCorrection] = await Promise.all([
      this.computeExpected(this.prisma, routeId),
      this.prisma.routeSettlement.findUnique({ where: { routeId } }),
      this.prisma.routeStop.count({ where: { routeId, status: StopStatus.PENDING } }),
      this.prisma.routeStop.findFirst({
        where: { routeId, correctedAt: { not: null } },
        orderBy: { correctedAt: "desc" },
        select: { correctedAt: true },
      }),
    ]);

    // Solo tiene sentido preguntarlo si la ruta ya se liquidó: antes de eso no
    // hay ningún EMPTY_UNLOAD que reconstruir.
    const emptiesCollectedByType =
      settlement === null
        ? []
        : await this.sumByContainerType(this.prisma, routeId, ContainerMovementType.EMPTY_UNLOAD);

    // Se deriva de `route_stops.corrected_at`, NO del `voided_at` de las
    // ventas, y la diferencia no es de estilo: corregir una parada de FAILED a
    // DELIVERED no anula ninguna venta —no había— pero sí crea una venta nueva
    // que mueve `totalSold` y `totalOnCredit`. Y `Sale` no tiene `createdAt`:
    // esa venta nueva hereda el `soldAt` del día de la ruta, anterior a la
    // liquidación, así que por fechas de venta sería indetectable.
    //
    // Que `corrected_at` guarde sólo la ÚLTIMA corrección no molesta acá: si
    // la última es anterior a `settledAt`, todas lo son.
    //
    // Sin liquidación es `false` y no `null`: no hay nada que pueda estar
    // desactualizado.
    const lastCorrectedAt = lastCorrection?.correctedAt ?? null;
    const settlementOutdated =
      settlement !== null && lastCorrectedAt !== null && lastCorrectedAt > settlement.settledAt;

    return {
      expected: toExpectedDto(expected),
      settlement: settlement === null ? null : toSettlementDto(settlement, emptiesCollectedByType),
      unresolvedStops,
      settlementOutdated,
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
