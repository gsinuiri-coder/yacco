import { BadRequestException, Injectable } from "@nestjs/common";
import {
  ContainerMovementType,
  ContainerState,
  PaymentStatus,
  Prisma,
  ProductType,
  type Payment,
  type Sale,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../customers/dto/create-customer.dto.js";
import type { CreateOpeningChargeDto } from "./dto/create-opening-charge.dto.js";
import type { CreateOpeningCreditDto } from "./dto/create-opening-credit.dto.js";

export interface StopDeliveryItemInput {
  productId: string;
  quantity: number;
  unitPrice?: string;
}

export interface StopDeliveryContainerReturnInput {
  containerTypeId: string;
  quantity: number;
}

export interface StopDeliveryPaymentInput {
  paymentMethodId: string;
  amount: string;
}

export interface RegisterStopDeliveryParams {
  routeId: string;
  stopId: string;
  locationId: string;
  items: StopDeliveryItemInput[];
  containersReturned: StopDeliveryContainerReturnInput[];
  payment?: StopDeliveryPaymentInput;
  priceOverrideAuthorizedById?: string;
  recordedById: string;
  /**
   * El instante de la ENTREGA — `soldAt` de la venta, `paidAt`/`confirmedAt`
   * del cobro y `occurredAt` de todos los movimientos.
   *
   * Obligatorio, y no opcional con `new Date()` por defecto, a propósito. Hay
   * dos llamadores y solo uno entrega hoy: el otro re-registra una parada que
   * ya se había anotado, heredando el instante de la venta que anula.
   * Olvidarse de pasarlo ahí fecharía esa venta hoy sin que nada falle —un bug
   * mudo que corre el día de una entrega vieja— así que el tipo obliga a
   * decidirlo en cada llamada.
   */
  occurredAt: Date;
  /**
   * Deja pasar el faltante de llenos en el camión en vez de bloquear, y lo
   * devuelve en `stockShortfall`. SOLO el camino de corrección lo manda en
   * `true`: ahí el camión ya volvió y lo que se arregla es el libro contra un
   * hecho físico consumado, así que bloquear mandaría al dueño de vuelta al
   * Excel, que es justo lo que esta operación existe para impedir.
   *
   * En el camino normal de entrega el chequeo SIGUE BLOQUEANDO y tiene que
   * seguir haciéndolo: entregar lo que el camión no tiene no es un error de
   * anotación, es imposible.
   */
  allowStockShortfall?: boolean;
}

export interface StopDeliverySaleResult {
  id: string;
  total: string;
  creditLimitExceeded: boolean;
}

export interface StopDeliveryPaymentResult {
  id: string;
  status: PaymentStatus;
  amount: string;
}

export interface StopDeliveryContainerBalanceResult {
  containerTypeId: string;
  containerType: { id: string; name: string };
  quantity: number;
}

/**
 * Un tipo de envase del que se registró más de lo que el camión tenía. Solo
 * aparece con `allowStockShortfall`; en el camino normal el faltante es un 400
 * y esta lista viaja vacía siempre.
 */
export interface StopDeliveryStockShortfallResult {
  containerTypeId: string;
  containerType: { id: string; name: string };
  available: number;
  requested: number;
}

export interface RegisterStopDeliveryResult {
  sale: StopDeliverySaleResult;
  payment: StopDeliveryPaymentResult | null;
  containerBalances: StopDeliveryContainerBalanceResult[];
  /** Vacío en el camino normal de entrega — ver `allowStockShortfall`. */
  stockShortfall: StopDeliveryStockShortfallResult[];
}

export interface VoidStopDeliveryParams {
  stopId: string;
  voidedById: string;
  voidReason: string;
}

export interface VoidStopDeliveryPaymentResult {
  id: string;
  amount: string;
  /** El estado al momento de anular, que es el que decide si devuelve deuda. */
  status: PaymentStatus;
}

export interface VoidStopDeliveryMovementResult {
  type: ContainerMovementType;
  containerTypeId: string;
  quantity: number;
}

export interface VoidStopDeliveryResult {
  /** `null` cuando la parada no tenía ninguna venta vigente: no había nada
   * que anular y no se escribió nada. */
  sale: { id: string; total: string; soldAt: Date } | null;
  payments: VoidStopDeliveryPaymentResult[];
  /** Cuánto se movió `debtBalance`, con signo — negativo cuando la anulación
   * baja la deuda, que es el caso normal. `"0.00"` en el no-op. */
  debtDelta: string;
  voidMovements: VoidStopDeliveryMovementResult[];
}

/**
 * Los tres movimientos que una entrega puede haber escrito, cada uno con el
 * tipo que lo deshace. Una sola lista para las dos direcciones que hace falta
 * leer: de original a anulación, para saber qué emitir, y de anulación a
 * original, para saber contra qué netear lo ya anulado.
 */
const VOIDABLE_MOVEMENT_PAIRS = [
  [ContainerMovementType.LOAN_DELIVERY, ContainerMovementType.LOAN_DELIVERY_VOID],
  [ContainerMovementType.EMPTY_PICKUP, ContainerMovementType.EMPTY_PICKUP_VOID],
  [ContainerMovementType.FULL_SALE, ContainerMovementType.FULL_SALE_VOID],
] as const;

type VoidableMovementType = (typeof VOIDABLE_MOVEMENT_PAIRS)[number][0];
type VoidMovementType = (typeof VOIDABLE_MOVEMENT_PAIRS)[number][1];

const VOID_TYPE_BY_ORIGIN: ReadonlyMap<ContainerMovementType, VoidMovementType> = new Map(
  VOIDABLE_MOVEMENT_PAIRS,
);
const ORIGIN_TYPE_BY_VOID: ReadonlyMap<ContainerMovementType, VoidableMovementType> = new Map(
  VOIDABLE_MOVEMENT_PAIRS.map(([origin, mirror]) => [mirror, origin] as const),
);

/**
 * El par de estados de cada anulación, copiado de
 * CONTAINER_MOVEMENT_TRANSITIONS, que es donde vive la regla. `FULL_SALE_VOID`
 * NO tiene `fromState`: la venta sacó esos bidones de la flota y el libro no
 * dice de cuál de los dos orígenes válidos salieron, así que la anulación
 * entra sin origen. La clave está OMITIDA de esa entrada, no puesta en
 * `undefined` — `exactOptionalPropertyTypes` no acepta lo segundo, y por eso
 * esta tabla se esparce tal cual sobre el DTO en vez de armarse con ifs.
 */
const VOID_TRANSITION: Readonly<
  Record<VoidMovementType, { fromState?: ContainerState; toState: ContainerState }>
> = {
  [ContainerMovementType.LOAN_DELIVERY_VOID]: {
    fromState: ContainerState.WITH_CUSTOMER,
    toState: ContainerState.FULL_ON_ROUTE,
  },
  [ContainerMovementType.EMPTY_PICKUP_VOID]: {
    fromState: ContainerState.EMPTY_ON_ROUTE,
    toState: ContainerState.WITH_CUSTOMER,
  },
  [ContainerMovementType.FULL_SALE_VOID]: { toState: ContainerState.FULL_ON_ROUTE },
};

/** Lo que queda por revertir de un par (tipo, tipo de envase) de una parada. */
interface PendingVoid {
  type: VoidableMovementType;
  containerTypeId: string;
  quantity: number;
  locationId: string | null;
  routeId: string | null;
}

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/**
 * This module has no controller, so the DTOs' `@Matches(MONEY_PATTERN)`
 * decorator never runs through a `ValidationPipe` — it is documentation, not
 * enforcement. This service is the only real boundary the amount crosses, so
 * it re-checks the format here before trusting the string as money, not just
 * its sign:
 *   - "150,00" (comma decimal — what Excel exports under a Spanish locale)
 *     would otherwise reach `new Prisma.Decimal(...)` and blow up with a raw,
 *     unfriendly parse error instead of a clear Spanish message.
 *   - "150.005" would otherwise parse fine and silently get rounded by
 *     Postgres against `Decimal(10,2)` on insert — money altered with no
 *     trace of it happening.
 */
function assertPositiveAmount(amount: string): Prisma.Decimal {
  if (!MONEY_PATTERN.test(amount)) {
    throw new BadRequestException(`El monto ${MONEY_MESSAGE}`);
  }
  const parsed = new Prisma.Decimal(amount);
  if (parsed.lte(0)) {
    throw new BadRequestException("El monto debe ser mayor que 0");
  }
  return parsed;
}

function assertNotFuture(date: Date, label: string): void {
  if (date.getTime() > Date.now()) {
    throw new BadRequestException(`${label} no puede ser futura`);
  }
}

async function assertCustomerActive(
  client: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, active: true },
  });
  if (customer === null) {
    throw new BadRequestException(`El cliente "${customerId}" no existe`);
  }
  if (!customer.active) {
    throw new BadRequestException(`El cliente "${customerId}" no está activo`);
  }
}

/**
 * The ledger gives a customer either debt or a balance in their favor, never
 * both — so a charge and a credit exclude each other. The two directions are
 * NOT symmetric, though:
 *   - A customer has as many opening charges as unpaid deliveries in the
 *     paper ledger (each with its own date and outstanding balance — that
 *     age is what "oldest debt first" needs), so creating a charge only
 *     checks that no opening CREDIT exists.
 *   - A customer has at most one opening credit
 *     (payments_opening_balance_customer_key), so creating one checks that
 *     neither a credit nor any charge exists.
 * Sale has no customerId column (it hangs off the location), so finding a
 * charge goes through the location relation; Payment carries customerId.
 */
async function assertNoOpeningCreditExists(
  client: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const existingCredit = await client.payment.findFirst({
    where: { isOpeningBalance: true, customerId },
    select: { id: true },
  });
  if (existingCredit !== null) {
    throw new BadRequestException(
      `El cliente "${customerId}" ya tiene un abono de apertura registrado`,
    );
  }
}

async function assertNoOpeningBalanceExists(
  client: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const existingCharge = await client.sale.findFirst({
    where: { isOpeningBalance: true, location: { customerId } },
    select: { id: true },
  });
  if (existingCharge !== null) {
    throw new BadRequestException(
      `El cliente "${customerId}" ya tiene un cargo de apertura registrado`,
    );
  }
  await assertNoOpeningCreditExists(client, customerId);
}

async function getPrimaryLocationId(
  client: Prisma.TransactionClient,
  customerId: string,
): Promise<string> {
  const location = await client.customerLocation.findFirst({
    where: { customerId, isPrimary: true },
    select: { id: true },
  });
  if (location === null) {
    throw new BadRequestException(`El cliente "${customerId}" no tiene una ubicación principal`);
  }
  return location.id;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containerMovementsService: ContainerMovementsService,
  ) {}

  /**
   * Neither opening method has a controller. Opening money enters only through the
   * customer-roster loader, the same reasoning as OPENING_BALANCE and
   * COUNT_ADJUSTMENT on the container side: if either could be registered by
   * hand, someone could invent debt on a customer or forgive it with no
   * paper behind it. `debtBalance` is a materialized aggregate over
   * sales/payments the same way `customer_container_balances` is over
   * `container_movements` — nothing writes it outside this module, and this
   * PR is the first thing that ever does.
   *
   * `debtBalance` is a single-column-keyed row (`Customer.id`), unlike
   * `CustomerContainerBalance`'s composite key: the S2 bug that upsert's
   * `increment` silently overwrote instead of adding to
   * (`ContainerMovementsService.createWithinTransaction`) was specific to
   * that composite-key upsert path. A plain `update` with `increment` on a
   * single-column-keyed row applies correctly, so both methods below use it
   * without the read-then-write-absolute workaround — copying that pattern
   * here by cargo cult would be needless complexity.
   *
   * One opening charge per unpaid delivery, not per customer: the paper
   * ledger carries the debt with that detail (five unpaid deliveries, each
   * with its own date and balance), and loading the net would lose the age
   * that "oldest debt first" runs on. The only uniqueness a charge carries
   * is `externalId` (sales_external_id_key, partial: nulls never collide).
   * A duplicate there IS caught and translated, unlike the credit's index
   * below, because it is an expected event — the roster loader run a second
   * time — not a race, and the loader needs a message it can show.
   *
   * The amount of an opening charge is the OUTSTANDING BALANCE of that
   * delivery, not its original price: the source has lines with partial
   * payments already applied, where the figure is not quantity times price.
   * Nothing here reconciles it against anything, on purpose.
   */
  async createOpeningCharge(dto: CreateOpeningChargeDto, recordedById: string): Promise<Sale> {
    const total = assertPositiveAmount(dto.amount);
    assertNotFuture(dto.soldAt, "La fecha de la venta");

    try {
      return await this.prisma.$transaction(async (tx) => {
        await assertCustomerActive(tx, dto.customerId);
        await assertNoOpeningCreditExists(tx, dto.customerId);
        const locationId = await getPrimaryLocationId(tx, dto.customerId);

        const sale = await tx.sale.create({
          data: {
            locationId,
            stopId: null,
            soldAt: dto.soldAt,
            total,
            externalId: dto.externalId ?? null,
            // Not a credit-limit decision anyone made — this debt was
            // already there when the system started, so there is no
            // "exceeded the limit" moment to flag.
            creditLimitExceeded: false,
            isOpeningBalance: true,
            recordedById,
          },
        });

        await tx.customer.update({
          where: { id: dto.customerId },
          data: { debtBalance: { increment: total } },
        });

        return sale;
      });
    } catch (error) {
      // P2002: sales_external_id_key is the only unique index a charge can hit.
      if (isPrismaKnownError(error, "P2002")) {
        throw new BadRequestException(
          `Ya existe un cargo de apertura con la referencia externa "${dto.externalId}"`,
        );
      }
      throw error;
    }
  }

  // No P2002 handling on payments_opening_balance_customer_key, and that is
  // deliberate: assertNoOpeningBalanceExists already rejects the duplicate
  // with a translated message, so the index only fires under a race — and
  // the roster loader, this method's only caller, runs sequentially in a
  // single process. If a concurrent caller shows up later, that is where the
  // catch (and its test) belongs.
  async createOpeningCredit(dto: CreateOpeningCreditDto, recordedById: string): Promise<Payment> {
    const amount = assertPositiveAmount(dto.amount);
    assertNotFuture(dto.paidAt, "La fecha del pago");

    try {
      return await this.prisma.$transaction(async (tx) => {
        await assertCustomerActive(tx, dto.customerId);
        await assertNoOpeningBalanceExists(tx, dto.customerId);

        const payment = await tx.payment.create({
          data: {
            customerId: dto.customerId,
            locationId: null,
            saleId: null,
            stopId: null,
            paymentMethodId: dto.paymentMethodId,
            paidAt: dto.paidAt,
            amount,
            // This money moved months before the system existed — there is
            // no confirmation step to wait on, only a fact to record.
            status: PaymentStatus.CONFIRMED,
            confirmedAt: dto.paidAt,
            confirmedById: recordedById,
            isOpeningBalance: true,
            recordedById,
          },
        });

        await tx.customer.update({
          where: { id: dto.customerId },
          data: { debtBalance: { decrement: amount } },
        });

        return payment;
      });
    } catch (error) {
      // P2003: the only FK this method doesn't pre-validate is paymentMethodId.
      if (isPrismaKnownError(error, "P2003")) {
        throw new BadRequestException(`El método de pago "${dto.paymentMethodId}" no existe`);
      }
      throw error;
    }
  }

  /**
   * Marking a route stop DELIVERED is not a status flip: it registers the
   * whole delivery in one transaction — the sale, the container movements in
   * both directions, and the collection if there was one. RoutesService
   * opens the transaction (it owns the idempotent RouteStop status flip,
   * `WHERE status = 'PENDING'` at the very start) and hands it here, so
   * everything commits or rolls back together with that flip: the losing
   * side of a concurrent double-mark leaves no sale, no movement and no
   * payment behind.
   *
   * Price resolution mirrors CustomerPricesService.findEffectivePrices'
   * precedence exactly — location price (for THIS location) > customer-wide
   * price > the product's own listPrice, "the only place this rule lives"
   * per that service's comment. This re-implements it scoped to the handful
   * of products in one delivery (and inside THIS transaction) rather than
   * calling back into that service, which would run outside it.
   *
   * A caller's unitPrice that disagrees with the resolved one is NOT
   * rejected — the sale records what was actually charged — but it DOES
   * require `priceOverrideAuthorizedById`: the fact is recorded, not
   * blocked, same spirit as the credit-limit and stock checks below.
   *
   * Stock: LOAN_DELIVERY (REFILL products) and FULL_SALE (CONTAINER_SALE
   * products) both draw from the same physical FULL_ON_ROUTE pile per
   * container type, so the check is aggregated across both BEFORE any
   * movement is written — delivering part of what the truck doesn't have is
   * not a bookkeeping error, it's impossible, so this one blocks. La única
   * excepción es `allowStockShortfall`, que solo prende el camino de
   * corrección y está documentada en ese parámetro.
   *
   * `occurredAt` es OBLIGATORIO y fecha las cuatro cosas que este método
   * escribe: `sale.soldAt`, `payment.paidAt`, `payment.confirmedAt` y el
   * `occurredAt` de todos los movimientos de envases. Ver su docblock.
   *
   * `debtBalance` moves by the full sale total, then back down by the
   * payment's amount ONLY if it is born CONFIRMED: a PENDING payment (a
   * method with `requiresConfirmation`) has not been verified and must not
   * reduce debt in any balance or report until the office confirms it.
   * `creditLimitExceeded` (HU-09: a sale "al fiado") is checked against that
   * SAME net delta, not the gross total — a sale fully collected on the spot
   * extends no credit at all, however large, and must never be flagged.
   */
  async registerStopDeliveryWithinTransaction(
    tx: Prisma.TransactionClient,
    params: RegisterStopDeliveryParams,
  ): Promise<RegisterStopDeliveryResult> {
    const location = await tx.customerLocation.findUnique({
      where: { id: params.locationId },
      select: {
        id: true,
        customerId: true,
        customer: { select: { id: true, creditLimit: true, debtBalance: true } },
      },
    });
    if (location === null) {
      throw new BadRequestException(`La ubicación "${params.locationId}" no existe`);
    }
    const customer = location.customer;

    const productIds = [...new Set(params.items.map((item) => item.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        active: true,
        type: true,
        containerTypeId: true,
        listPrice: true,
      },
    });
    if (products.length !== productIds.length) {
      const found = new Set(products.map((product) => product.id));
      const missing = productIds.filter((id) => !found.has(id));
      throw new BadRequestException(`No existen los productos: ${missing.join(", ")}`);
    }
    const inactive = products.filter((product) => !product.active);
    if (inactive.length > 0) {
      const names = inactive.map((product) => `"${product.name}"`).join(", ");
      throw new BadRequestException(`Ya no están a la venta los productos: ${names}`);
    }
    const productById = new Map(products.map((product) => [product.id, product] as const));
    function requireProduct(productId: string): (typeof products)[number] {
      const product = productById.get(productId);
      if (product === undefined) {
        throw new BadRequestException(`El producto "${productId}" no existe`);
      }
      return product;
    }

    // Same precedence as CustomerPricesService.findEffectivePrices: a
    // location-specific price for THIS location, else a customer-wide one,
    // else the product's own listPrice.
    const customerPrices = await tx.customerPrice.findMany({
      where: {
        customerId: location.customerId,
        productId: { in: productIds },
        OR: [{ locationId: null }, { locationId: params.locationId }],
      },
    });
    function resolvePrice(productId: string): Prisma.Decimal {
      const locationPrice = customerPrices.find(
        (price) => price.productId === productId && price.locationId === params.locationId,
      );
      if (locationPrice !== undefined) return locationPrice.price;
      const customerPrice = customerPrices.find(
        (price) => price.productId === productId && price.locationId === null,
      );
      if (customerPrice !== undefined) return customerPrice.price;
      return requireProduct(productId).listPrice;
    }

    let hasOverride = false;
    let total = new Prisma.Decimal(0);
    const saleItemsData: { productId: string; quantity: number; unitPrice: Prisma.Decimal }[] = [];
    for (const item of params.items) {
      const resolved = resolvePrice(item.productId);
      let unitPrice = resolved;
      if (item.unitPrice !== undefined) {
        unitPrice = assertPositiveAmount(item.unitPrice);
        if (!unitPrice.equals(resolved)) {
          hasOverride = true;
        }
      }
      saleItemsData.push({ productId: item.productId, quantity: item.quantity, unitPrice });
      total = total.plus(unitPrice.times(item.quantity));
    }

    if (hasOverride && params.priceOverrideAuthorizedById === undefined) {
      throw new BadRequestException(
        "El precio cobrado difiere del precio pactado; falta quién lo autorizó (priceOverrideAuthorizedById)",
      );
    }
    if (params.priceOverrideAuthorizedById !== undefined) {
      const authorizer = await tx.user.findUnique({
        where: { id: params.priceOverrideAuthorizedById },
        select: { id: true },
      });
      if (authorizer === null) {
        throw new BadRequestException(
          `El usuario "${params.priceOverrideAuthorizedById}" no existe`,
        );
      }
    }

    // Stock check, aggregated per container type across REFILL and
    // CONTAINER_SALE items alike (both draw fulls off the same truck) —
    // BEFORE any movement is written.
    const deliveredByContainerType = new Map<string, number>();
    for (const item of params.items) {
      const product = requireProduct(item.productId);
      deliveredByContainerType.set(
        product.containerTypeId,
        (deliveredByContainerType.get(product.containerTypeId) ?? 0) + item.quantity,
      );
    }
    const stockShortfall: StopDeliveryStockShortfallResult[] = [];
    for (const [containerTypeId, requested] of deliveredByContainerType) {
      const available = await this.containerMovementsService.getRouteFullStock(
        tx,
        params.routeId,
        containerTypeId,
      );
      if (available >= requested) continue;
      const containerType = await tx.containerType.findUnique({
        where: { id: containerTypeId },
        select: { id: true, name: true },
      });
      if (params.allowStockShortfall !== true) {
        throw new BadRequestException(
          `Stock insuficiente de "${containerType?.name ?? containerTypeId}" en el camión: hay ${available}, se pidió ${requested}`,
        );
      }
      // Con el flag prendido el faltante se acumula y la entrega sigue — ver
      // `allowStockShortfall`. El saldo del camión queda negativo, que es
      // exactamente lo que pasó: se entregó más de lo que el libro decía que
      // había cargado.
      stockShortfall.push({
        containerTypeId,
        containerType: containerType ?? { id: containerTypeId, name: containerTypeId },
        available,
        requested,
      });
    }

    // Payment, if any: status comes from the method's requiresConfirmation,
    // never from the caller.
    let resolvedPayment: {
      amount: Prisma.Decimal;
      status: PaymentStatus;
      paymentMethodId: string;
    } | null = null;
    if (params.payment !== undefined) {
      const amount = assertPositiveAmount(params.payment.amount);
      const paymentMethod = await tx.paymentMethod.findUnique({
        where: { id: params.payment.paymentMethodId },
        select: { id: true, active: true, requiresConfirmation: true },
      });
      if (paymentMethod === null) {
        throw new BadRequestException(
          `El método de pago "${params.payment.paymentMethodId}" no existe`,
        );
      }
      if (!paymentMethod.active) {
        throw new BadRequestException(
          `El método de pago "${params.payment.paymentMethodId}" no está activo`,
        );
      }
      resolvedPayment = {
        amount,
        status: paymentMethod.requiresConfirmation
          ? PaymentStatus.PENDING
          : PaymentStatus.CONFIRMED,
        paymentMethodId: paymentMethod.id,
      };
    }

    // debtBalance moves by the full sale total, then back down by the
    // payment ONLY if it is born CONFIRMED — see the method doc.
    const debtDelta =
      resolvedPayment !== null && resolvedPayment.status === PaymentStatus.CONFIRMED
        ? total.minus(resolvedPayment.amount)
        : total;

    // Alert, never block (CLAUDE.md). HU-09: the check is about a sale "al
    // fiado" — computed from the NET increase to debtBalance (debtDelta),
    // not the gross sale total: a sale collected in full on the spot (a
    // CONFIRMED payment covering it) extends no credit at all, however big
    // the total, and must not be flagged as exceeding the limit.
    const creditLimitExceeded =
      customer.creditLimit !== null &&
      customer.debtBalance.plus(debtDelta).gt(customer.creditLimit);

    await tx.customer.update({
      where: { id: customer.id },
      data: { debtBalance: { increment: debtDelta } },
    });

    // El instante lo decide siempre quien llama, nunca este método — ver
    // `occurredAt` en RegisterStopDeliveryParams.
    const occurredAt = params.occurredAt;
    const sale = await tx.sale.create({
      data: {
        locationId: params.locationId,
        stopId: params.stopId,
        soldAt: occurredAt,
        total,
        creditLimitExceeded,
        priceOverrideAuthorizedById: params.priceOverrideAuthorizedById ?? null,
        recordedById: params.recordedById,
        items: { create: saleItemsData },
      },
    });

    let paymentResult: StopDeliveryPaymentResult | null = null;
    if (resolvedPayment !== null) {
      const confirmed = resolvedPayment.status === PaymentStatus.CONFIRMED;
      const payment = await tx.payment.create({
        data: {
          customerId: customer.id,
          locationId: params.locationId,
          saleId: sale.id,
          stopId: params.stopId,
          paymentMethodId: resolvedPayment.paymentMethodId,
          paidAt: occurredAt,
          amount: resolvedPayment.amount,
          status: resolvedPayment.status,
          confirmedAt: confirmed ? occurredAt : null,
          confirmedById: confirmed ? params.recordedById : null,
          recordedById: params.recordedById,
        },
      });
      paymentResult = { id: payment.id, status: payment.status, amount: payment.amount.toFixed(2) };
    }

    // Envases entregados: REFILL sells the water and the container stays on
    // loan (LOAN_DELIVERY, adds to the customer's container balance);
    // CONTAINER_SALE sells the container outright (FULL_SALE, leaves the
    // fleet, balance untouched) — see container-movement-transitions.ts and
    // the spec glossary on FULL_SALE.
    const balanceTouchedContainerTypeIds = new Set<string>();
    const deliveryGroups = new Map<string, Map<ContainerMovementType, number>>();
    for (const item of params.items) {
      const product = requireProduct(item.productId);
      const movementType =
        product.type === ProductType.REFILL
          ? ContainerMovementType.LOAN_DELIVERY
          : ContainerMovementType.FULL_SALE;
      const byType =
        deliveryGroups.get(product.containerTypeId) ?? new Map<ContainerMovementType, number>();
      byType.set(movementType, (byType.get(movementType) ?? 0) + item.quantity);
      deliveryGroups.set(product.containerTypeId, byType);
      if (movementType === ContainerMovementType.LOAN_DELIVERY) {
        balanceTouchedContainerTypeIds.add(product.containerTypeId);
      }
    }
    for (const [containerTypeId, byType] of deliveryGroups) {
      for (const [movementType, quantity] of byType) {
        await this.containerMovementsService.createWithinTransaction(
          tx,
          {
            type: movementType,
            containerTypeId,
            quantity,
            fromState: ContainerState.FULL_ON_ROUTE,
            locationId: params.locationId,
            // FULL_SALE has no toState (spec: it leaves the fleet entirely);
            // the key must be OMITTED, not set to undefined, to satisfy
            // exactOptionalPropertyTypes on CreateContainerMovementDto.
            ...(movementType === ContainerMovementType.LOAN_DELIVERY
              ? { toState: ContainerState.WITH_CUSTOMER }
              : {}),
          },
          params.recordedById,
          { routeId: params.routeId, stopId: params.stopId, occurredAt },
        );
      }
    }

    // Envases devueltos: applied in full even on a partial return — the
    // resulting balance is reported below, never validated against
    // anything (CLAUDE.md: alert, don't block).
    for (const item of params.containersReturned) {
      await this.containerMovementsService.createWithinTransaction(
        tx,
        {
          type: ContainerMovementType.EMPTY_PICKUP,
          containerTypeId: item.containerTypeId,
          quantity: item.quantity,
          fromState: ContainerState.WITH_CUSTOMER,
          toState: ContainerState.EMPTY_ON_ROUTE,
          locationId: params.locationId,
        },
        params.recordedById,
        { routeId: params.routeId, stopId: params.stopId, occurredAt },
      );
      balanceTouchedContainerTypeIds.add(item.containerTypeId);
    }

    const balances =
      balanceTouchedContainerTypeIds.size === 0
        ? []
        : await tx.customerContainerBalance.findMany({
            where: {
              locationId: params.locationId,
              containerTypeId: { in: [...balanceTouchedContainerTypeIds] },
            },
            include: { containerType: { select: { id: true, name: true } } },
          });

    return {
      sale: { id: sale.id, total: sale.total.toFixed(2), creditLimitExceeded },
      payment: paymentResult,
      containerBalances: balances.map((balance) => ({
        containerTypeId: balance.containerTypeId,
        containerType: balance.containerType,
        quantity: balance.quantity,
      })),
      stockShortfall,
    };
  }

  /**
   * La mitad "deshacer" de registrar una entrega, y simétrica con ella: anula
   * la venta de la parada, sus cobros, la deuda que movieron y los movimientos
   * de envases que escribió. Recibe un `tx` abierto por quien llama, igual que
   * su hermana, porque las cuatro cosas son UNA corrección y tienen que
   * confirmarse o deshacerse juntas — una anulación a medias deja los bidones
   * de vuelta en el camión con la deuda todavía en pie.
   *
   * Nada se edita ni se borra (CLAUDE.md). La venta y los cobros conservan su
   * monto y solo ganan sus tres columnas de anulación; los envases se corrigen
   * con movimientos inversos, nunca tocando los originales.
   *
   * **Sin venta vigente no hace nada y no falla.** Es deliberado: quien va a
   * llamar a este método también corrige paradas que estaban FAILED, donde no
   * hubo entrega y no hay nada que anular, y eso no es un error del que llama.
   *
   * **Los dos instantes son distintos y es a propósito** — es lo primero que un
   * lector futuro va a creer que es un bug. `voidedAt` de la venta y de los
   * cobros es AHORA, porque es cuándo alguien corrigió. El `occurredAt` de los
   * tres movimientos de anulación es `sale.soldAt`, el instante de la entrega
   * original, porque la reversa pertenece al día del hecho y no al día en que
   * se notó: el libro de envases tiene que poder cerrar un día y quedarse
   * cerrado, y un movimiento fechado hoy contra una entrega de la semana pasada
   * movería un parque que ya se contó.
   *
   * **La deuda se devuelve por el efecto acumulado real, mirando el estado
   * ACTUAL de cada cobro, no el que tuvo al nacer.** Un pago que nació PENDING
   * y la oficina confirmó después ya bajó la deuda en
   * `PaymentsService.confirm`, y no devolverla dejaría al cliente con un
   * crédito fantasma. Un PENDING o un REJECTED se marcan anulados pero no
   * mueven nada, porque nunca movieron nada. Que la misma fórmula sirva para
   * los tres casos no es casualidad: `confirm()` y `reject()` dejan siempre
   * `debtBalance` de acuerdo con el estado actual, así que deshacer "el total
   * menos lo que hoy está CONFIRMED" es exactamente deshacer lo que la deuda
   * avanzó.
   */
  async voidStopDeliveryWithinTransaction(
    tx: Prisma.TransactionClient,
    params: VoidStopDeliveryParams,
  ): Promise<VoidStopDeliveryResult> {
    const sale = await tx.sale.findFirst({
      where: { stopId: params.stopId, voidedAt: null },
      select: {
        id: true,
        total: true,
        soldAt: true,
        location: { select: { customerId: true } },
        payments: {
          where: { voidedAt: null },
          select: { id: true, amount: true, status: true },
          orderBy: { paidAt: "asc" },
        },
      },
    });
    if (sale === null) {
      return { sale: null, payments: [], debtDelta: "0.00", voidMovements: [] };
    }

    // Las tres columnas van juntas o ninguna — hay un CHECK en la base que lo
    // exige, así que se escriben desde un solo objeto en los dos lugares.
    const voidColumns = {
      voidedAt: new Date(),
      voidedById: params.voidedById,
      voidReason: params.voidReason,
    };

    // La guarda `voidedAt: null` va en el WHERE del UPDATE, no solo en la
    // lectura de arriba: mismo idioma que `PaymentsService.confirm`, y por la
    // misma razón. Bajo READ COMMITTED dos anulaciones simultáneas de la misma
    // parada leen las dos la venta vigente; la perdedora se queda esperando el
    // lock y, sin esta cláusula, volvería a estampar las columnas y aplicaría
    // su propio `debtDelta` — la deuda se devolvería DOS veces. Con ella,
    // `count === 0` y la perdedora sale por el mismo no-op que una parada sin
    // venta. Los envases se salvaban solos porque su `findMany` corre después
    // del commit de la ganadora y netea; la plata no, porque los cobros se
    // leyeron antes.
    const { count } = await tx.sale.updateMany({
      where: { id: sale.id, voidedAt: null },
      data: voidColumns,
    });
    if (count === 0) {
      return { sale: null, payments: [], debtDelta: "0.00", voidMovements: [] };
    }

    if (sale.payments.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: sale.payments.map((payment) => payment.id) }, voidedAt: null },
        data: voidColumns,
      });
    }

    let debtDelta = sale.total.negated();
    for (const payment of sale.payments) {
      if (payment.status === PaymentStatus.CONFIRMED) {
        debtDelta = debtDelta.plus(payment.amount);
      }
    }
    await tx.customer.update({
      where: { id: sale.location.customerId },
      data: { debtBalance: { increment: debtDelta } },
    });

    const voidMovements = await this.emitStopVoidMovements(tx, params, sale.soldAt);

    return {
      // `soldAt` viaja de vuelta porque es de donde el camino de corrección
      // saca el instante con el que vuelve a registrar la parada: la entrega
      // corregida es la MISMA entrega, del mismo día, anotada distinto.
      sale: { id: sale.id, total: sale.total.toFixed(2), soldAt: sale.soldAt },
      payments: sale.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toFixed(2),
        status: payment.status,
      })),
      debtDelta: debtDelta.toFixed(2),
      voidMovements,
    };
  }

  /**
   * Emite la reversa de los envases de una parada, NETA de lo ya anulado: por
   * cada par (tipo de movimiento, tipo de envase) se resta lo que las
   * anulaciones existentes ya deshicieron y solo se emite la diferencia.
   *
   * El neteo no es una precaución teórica. Corregir una parada es anular y
   * volver a registrar, así que una parada corregida dos veces tiene, sobre el
   * mismo `stopId`, la entrega original ya anulada Y la segunda entrega
   * vigente. Sin netear, la segunda anulación emitiría también la reversa de la
   * primera y devolvería al camión bidones que ya habían vuelto.
   *
   * `locationId` y `routeId` salen del movimiento original, no de quien llama:
   * la anulación tiene que quedar colgada de la misma ruta que el movimiento
   * que deshace o la liquidación no la resta, y de la misma ubicación o el
   * saldo de envases se le movería a otro cliente.
   */
  private async emitStopVoidMovements(
    tx: Prisma.TransactionClient,
    params: VoidStopDeliveryParams,
    occurredAt: Date,
  ): Promise<VoidStopDeliveryMovementResult[]> {
    const movements = await tx.containerMovement.findMany({
      where: {
        stopId: params.stopId,
        type: { in: [...ORIGIN_TYPE_BY_VOID.keys(), ...VOID_TYPE_BY_ORIGIN.keys()] },
      },
      select: {
        type: true,
        containerTypeId: true,
        quantity: true,
        locationId: true,
        routeId: true,
      },
      // `findMany` sin `orderBy` no promete ningún orden, así que se pide uno.
      // Ojo: desde que corregir una parada re-registra la entrega heredando el
      // `soldAt` de la venta anulada, los movimientos de un mismo `stopId`
      // COMPARTEN `occurredAt` y este orden ya no los desempata. No importa
      // para lo que se lee acá —la suma es conmutativa, y `locationId` y
      // `routeId` son los mismos en todos los movimientos originales de una
      // parada, así que cuál gane la asignación da igual— pero no queda
      // ninguna garantía de orden que invocar. `ContainerMovement` no tiene
      // `created_at` con el cual desempatar; el día que haga falta, es eso lo
      // que falta.
      orderBy: { occurredAt: "asc" },
    });

    const pending = new Map<string, PendingVoid>();
    for (const movement of movements) {
      const originType = ORIGIN_TYPE_BY_VOID.get(movement.type);
      const isVoid = originType !== undefined;
      const groupType = originType ?? (movement.type as VoidableMovementType);
      const key = `${groupType}:${movement.containerTypeId}`;
      const entry = pending.get(key) ?? {
        type: groupType,
        containerTypeId: movement.containerTypeId,
        quantity: 0,
        locationId: null,
        routeId: null,
      };
      entry.quantity += isVoid ? -movement.quantity : movement.quantity;
      if (!isVoid) {
        entry.locationId = movement.locationId;
        entry.routeId = movement.routeId;
      }
      pending.set(key, entry);
    }

    const emitted: VoidStopDeliveryMovementResult[] = [];
    // Ordenado por la clave para que dos corridas emitan en el mismo orden, y
    // con una comparación binaria en vez de `localeCompare`: las claves son
    // nombres de enum y UUIDs, así que el orden no debe depender del locale.
    for (const [, entry] of [...pending].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      // Cero significa que ya estaba todo anulado; negativo, que se anuló de
      // más en alguna corrección anterior. En los dos casos no queda nada por
      // deshacer, y emitir sería inventar bidones.
      if (entry.quantity <= 0) continue;
      const voidType = VOID_TYPE_BY_ORIGIN.get(entry.type);
      if (voidType === undefined) continue;
      await this.containerMovementsService.createWithinTransaction(
        tx,
        {
          type: voidType,
          containerTypeId: entry.containerTypeId,
          quantity: entry.quantity,
          ...VOID_TRANSITION[voidType],
          ...(entry.locationId !== null ? { locationId: entry.locationId } : {}),
        },
        params.voidedById,
        {
          stopId: params.stopId,
          occurredAt,
          ...(entry.routeId !== null ? { routeId: entry.routeId } : {}),
        },
      );
      emitted.push({
        type: voidType,
        containerTypeId: entry.containerTypeId,
        quantity: entry.quantity,
      });
    }
    return emitted;
  }
}
