/**
 * Pure data and math for `seed-demo.ts`: the fictional demo roster, what
 * each customer buys on which day, and the debt/stock arithmetic that plan
 * implies. Nothing here touches the network or the filesystem, so it runs
 * (and is tested) directly in Jest, unlike the HTTP orchestration in
 * `seed-demo.ts` itself — see that file's own comment and
 * sonar-project.properties for why the split exists.
 */

export type ContainerTypeKey = "CON_CANO" | "SIN_CANO";
export type ProductKey = "R_CC" | "R_SC";
export type PaymentMethodKey = "EFECTIVO" | "YAPE" | "TRANSFERENCIA";

// Must match apps/api/prisma/seed.ts exactly: this script reads the catalog
// by name, never invents ids.
export const CONTAINER_TYPE_NAMES: Record<ContainerTypeKey, string> = {
  CON_CANO: "Con caño",
  SIN_CANO: "Sin caño",
};

export const PRODUCT_NAMES: Record<ProductKey, string> = {
  R_CC: "Recarga 20L con caño",
  R_SC: "Recarga 20L sin caño",
};

export const PAYMENT_METHOD_NAMES: Record<PaymentMethodKey, string> = {
  EFECTIVO: "Efectivo",
  YAPE: "Yape",
  TRANSFERENCIA: "Transferencia",
};

export const PRODUCT_CONTAINER_TYPE: Record<ProductKey, ContainerTypeKey> = {
  R_CC: "CON_CANO",
  R_SC: "SIN_CANO",
};

// Mirrors seed.ts's requiresConfirmation: Efectivo settles on the spot,
// Yape/Transferencia wait for the office. The debt math below depends on
// this exactly the way SalesService does — a PENDING payment never reduces
// debtBalance.
export const PAYMENT_METHOD_REQUIRES_CONFIRMATION: Record<PaymentMethodKey, boolean> = {
  EFECTIVO: false,
  YAPE: true,
  TRANSFERENCIA: true,
};

// Both REFILL products list at "8.00" in seed.ts; kept here (not derived
// from a live GET /products) so the expected-debt math is checkable without
// a server. seed-demo.ts still resolves the real productId/price by name at
// run time — this constant only has to agree with seed.ts, and the unit
// tests below are what catch it drifting.
export const PRODUCT_UNIT_PRICE: Record<ProductKey, string> = {
  R_CC: "8.00",
  R_SC: "8.00",
};

export interface ProductCatalogEntry {
  name: string;
  listPrice: string;
}

export interface ProductPriceMismatch {
  key: ProductKey;
  name: string;
  expected: string;
  actual: string;
}

/**
 * PRODUCT_UNIT_PRICE mirrors seed.ts's listPrice so the debt math below can
 * be checked without a live server — but seed.ts's own comment calls those
 * values "provisional placeholders, pending confirmation with the plant
 * owner". If one changes there, this plan's expected debt goes silently
 * stale unless something compares the two. seed-demo.ts calls this against
 * a real GET /products response, before writing anything, and aborts on any
 * mismatch — never averages, ignores, or "uses whichever is right" for you.
 */
export function findProductPriceMismatches(catalog: ProductCatalogEntry[]): ProductPriceMismatch[] {
  const listPriceByName = new Map(catalog.map((product) => [product.name, product.listPrice]));
  const mismatches: ProductPriceMismatch[] = [];
  for (const key of Object.keys(PRODUCT_NAMES) as ProductKey[]) {
    const name = PRODUCT_NAMES[key];
    const actual = listPriceByName.get(name);
    const expected = PRODUCT_UNIT_PRICE[key];
    // A missing product is CatalogIds' job to report (a clearer, different
    // message); this only speaks up when the product exists but disagrees.
    if (actual !== undefined && actual !== expected) {
      mismatches.push({ key, name, expected, actual });
    }
  }
  return mismatches;
}

export const DEMO_HISTORY_DAYS = 5;
export const DEMO_DRIVER_USERNAME = "chofer.demo";
export const DEMO_DRIVER_NAME = "Julio Ramírez (Demo)";
export const PRODUCTION_BATCH_CODE = "LOTE-DEMO-01";

/** Generous buffer over the 41/10 the delivery plan below actually needs. */
export const PRODUCTION_PLAN: { containerType: ContainerTypeKey; producedQty: number }[] = [
  { containerType: "CON_CANO", producedQty: 60 },
  { containerType: "SIN_CANO", producedQty: 20 },
];

/**
 * Los envases con los que la planta arranca, comprados antes de que existiera
 * el sistema (`FLEET_ENTRY`: entran a la flota como vacíos en planta).
 *
 * Sin esto la demo llenaba lotes de envases que nunca habían entrado, y el
 * inventario mostraba "vacíos en planta" en negativo con su aviso en rojo
 * —"se registraron más envases llenados que vacíos disponibles"— que no tiene
 * nada que ver con lo que la demo quiere mostrar. Cubre exactamente lo que el
 * lote va a llenar: el parque no aparece de la nada ni sobra.
 */
export const FLEET_ENTRY_PLAN: { containerType: ContainerTypeKey; quantity: number }[] =
  PRODUCTION_PLAN.map((line) => ({
    containerType: line.containerType,
    quantity: line.producedQty,
  }));

export interface DemoCustomerPlan {
  key: string;
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  /** Only the "near the limit" customer carries one; the rest are unset. */
  creditLimit?: string;
}

// Fictional businesses, obviously so ("(Demo)"), never a real plant customer.
// The driver-username conflict (see seed-demo.ts) is the actual idempotency
// guard, but a recognizable, greppable name set makes a stray partial run
// easy to spot by hand too.
export const DEMO_CUSTOMERS: DemoCustomerPlan[] = [
  {
    key: "estrella",
    name: "Bodega Los Jazmines (Demo)",
    phone: "987000001",
    address: "Jr. Los Jazmines 245",
    addressReference: "Frente a la plaza principal",
  },
  {
    key: "debt0_a",
    name: "Restaurante El Fogón Criollo (Demo)",
    phone: "987000002",
    address: "Av. Universitaria 1830",
    addressReference: "Al lado del grifo",
  },
  {
    key: "debt0_b",
    name: "Panadería Trigo Dorado (Demo)",
    phone: "987000003",
    address: "Calle Las Begonias 112",
    addressReference: "Esquina con Los Claveles",
  },
  {
    key: "small_a",
    name: "Ferretería Martillo Feliz (Demo)",
    phone: "987000004",
    address: "Jr. Comercio 588",
    addressReference: "Portón verde",
  },
  {
    key: "small_b",
    name: "Pollería Doña Encarna (Demo)",
    phone: "987000005",
    address: "Av. Los Próceres 970",
    addressReference: "Media cuadra del mercado",
  },
  {
    key: "near_limit",
    name: "Minimarket Tres Estrellas (Demo)",
    phone: "987000006",
    address: "Jr. San Martín 340",
    addressReference: "Segundo piso, tocar timbre",
    creditLimit: "70.00",
  },
  {
    key: "pending_yape",
    name: "Farmacia San Judas (Demo)",
    phone: "987000007",
    address: "Av. Grau 455",
    addressReference: "Junto al paradero",
  },
  {
    key: "pending_transferencia",
    name: "Peluquería Nueva Imagen (Demo)",
    phone: "987000008",
    address: "Calle Las Orquídeas 76",
    addressReference: "Casa de rejas azules",
  },
];

/** Vacíos que el cliente entrega en esa misma visita (`containersReturned`). */
export interface DemoContainerReturn {
  containerTypeKey: ContainerTypeKey;
  quantity: number;
}

export interface DemoDeliveryPlan {
  customerKey: string;
  /** 0 = oldest day of history, DEMO_HISTORY_DAYS - 1 = today. */
  dayIndex: number;
  productKey: ProductKey;
  quantity: number;
  payment?: { methodKey: PaymentMethodKey; amount: string };
  /**
   * Devolver es lo normal, no la excepción: en la operación real el chofer
   * deja llenos y se lleva los vacíos de la visita anterior. Sin esto la demo
   * entregaba y nunca recogía, y el saldo de envases de cada cliente solo
   * podía crecer.
   *
   * No mueve deuda monetaria: `computeExpectedDebtByCustomer` no lo mira, y
   * no debe.
   */
  containersReturned?: DemoContainerReturn[];
}

// Verified against SalesService.registerStopDeliveryWithinTransaction: debt
// moves by the full sale total, then back down by a payment ONLY if it is
// CONFIRMED (Efectivo). See computeExpectedDebtByCustomer's test for the
// resulting number on each customer.
export const DEMO_DELIVERIES: DemoDeliveryPlan[] = [
  // estrella: 5 deliveries across every day, one partial Efectivo payment
  // and one PENDING Yape that must NOT reduce debt — ends at a clear
  // 3-figure balance.
  { customerKey: "estrella", dayIndex: 0, productKey: "R_CC", quantity: 5 },
  {
    customerKey: "estrella",
    dayIndex: 1,
    productKey: "R_CC",
    quantity: 4,
    payment: { methodKey: "YAPE", amount: "20.00" },
    containersReturned: [{ containerTypeKey: "CON_CANO", quantity: 5 }],
  },
  {
    customerKey: "estrella",
    dayIndex: 2,
    productKey: "R_CC",
    quantity: 5,
    containersReturned: [{ containerTypeKey: "CON_CANO", quantity: 4 }],
  },
  {
    customerKey: "estrella",
    dayIndex: 3,
    productKey: "R_CC",
    quantity: 3,
    payment: { methodKey: "EFECTIVO", amount: "20.00" },
    containersReturned: [{ containerTypeKey: "CON_CANO", quantity: 5 }],
  },
  {
    customerKey: "estrella",
    dayIndex: 4,
    productKey: "R_CC",
    quantity: 4,
    containersReturned: [{ containerTypeKey: "CON_CANO", quantity: 3 }],
  },

  // debt0_a / debt0_b: every delivery paid in full, on the spot, Efectivo.
  {
    customerKey: "debt0_a",
    dayIndex: 0,
    productKey: "R_CC",
    quantity: 2,
    payment: { methodKey: "EFECTIVO", amount: "16.00" },
  },
  {
    customerKey: "debt0_a",
    dayIndex: 3,
    productKey: "R_CC",
    quantity: 1,
    payment: { methodKey: "EFECTIVO", amount: "8.00" },
    containersReturned: [{ containerTypeKey: "CON_CANO", quantity: 2 }],
  },
  {
    customerKey: "debt0_b",
    dayIndex: 1,
    productKey: "R_SC",
    quantity: 3,
    payment: { methodKey: "EFECTIVO", amount: "24.00" },
  },
  {
    customerKey: "debt0_b",
    dayIndex: 4,
    productKey: "R_SC",
    quantity: 2,
    payment: { methodKey: "EFECTIVO", amount: "16.00" },
    containersReturned: [{ containerTypeKey: "SIN_CANO", quantity: 3 }],
  },

  // small_a / small_b: one unpaid delivery each, small debt.
  //
  // small_a es el descuadre de la demo, y nace como nace en la planta: en la
  // primera visita que el sistema registra, el cliente devuelve los 5 envases
  // que tenía acumulados del cuaderno de papel, y el libro solo sabía de los 2
  // que se le acababan de entregar. Queda en -3, que no es un error de datos:
  // dice que hubo entregas que nadie anotó. Va en el día 0 a propósito —así el
  // negativo no depende de agregar una entrega que movería la deuda esperada—
  // y esta ubicación se deja SIN CONTAR, porque el saldo negativo es
  // justamente lo que manda a alguien a contarla.
  {
    customerKey: "small_a",
    dayIndex: 0,
    productKey: "R_CC",
    quantity: 2,
    containersReturned: [{ containerTypeKey: "CON_CANO", quantity: 5 }],
  },
  { customerKey: "small_b", dayIndex: 2, productKey: "R_SC", quantity: 3 },

  // near_limit: three unpaid/partial deliveries that land close under its
  // 70.00 creditLimit without ever exceeding it.
  { customerKey: "near_limit", dayIndex: 1, productKey: "R_CC", quantity: 6 },
  {
    customerKey: "near_limit",
    dayIndex: 2,
    productKey: "R_CC",
    quantity: 4,
    payment: { methodKey: "EFECTIVO", amount: "32.00" },
    containersReturned: [{ containerTypeKey: "CON_CANO", quantity: 6 }],
  },
  {
    customerKey: "near_limit",
    dayIndex: 3,
    productKey: "R_CC",
    quantity: 2,
    containersReturned: [{ containerTypeKey: "CON_CANO", quantity: 4 }],
  },

  // pending_yape / pending_transferencia: exist to give the payment
  // confirmation tray something to show (GET /payments?status=PENDING).
  {
    customerKey: "pending_yape",
    dayIndex: 1,
    productKey: "R_SC",
    quantity: 2,
    payment: { methodKey: "YAPE", amount: "16.00" },
  },
  {
    customerKey: "pending_transferencia",
    dayIndex: 2,
    productKey: "R_CC",
    quantity: 3,
    payment: { methodKey: "TRANSFERENCIA", amount: "24.00" },
  },
];

/**
 * Saldo de envases que el plan deja en cada ubicación, por tipo: entregado
 * menos devuelto. Es la misma cuenta que hacen `LOAN_DELIVERY` y
 * `EMPTY_PICKUP` sobre `customer_container_balances`, hecha acá para poder
 * verificar el plan sin levantar un servidor — igual que
 * `computeExpectedDebtByCustomer` con la deuda.
 *
 * Puede dar NEGATIVO, y eso es información, no un error: significa que el
 * cliente devolvió envases que nadie registró haberle entregado.
 */
export function computeExpectedContainerBalances(
  deliveries: DemoDeliveryPlan[],
): Map<string, Partial<Record<ContainerTypeKey, number>>> {
  const result = new Map<string, Partial<Record<ContainerTypeKey, number>>>();
  const add = (customerKey: string, type: ContainerTypeKey, delta: number): void => {
    const byType = result.get(customerKey) ?? {};
    byType[type] = (byType[type] ?? 0) + delta;
    result.set(customerKey, byType);
  };

  for (const delivery of deliveries) {
    add(delivery.customerKey, PRODUCT_CONTAINER_TYPE[delivery.productKey], delivery.quantity);
    for (const returned of delivery.containersReturned ?? []) {
      add(delivery.customerKey, returned.containerTypeKey, -returned.quantity);
    }
  }
  return result;
}

/**
 * Un conteo físico de la demo. `countedQuantity` es lo que "se encontró en el
 * mostrador": comparado con el saldo del libro, `ContainerCountsService`
 * decide solo si emite un `COUNT_ADJUSTMENT` y guarda su `adjustmentId`.
 */
export interface DemoContainerCountPlan {
  customerKey: string;
  containerTypeKey: ContainerTypeKey;
  countedQuantity: number;
}

/**
 * Los conteos existen para que la pantalla de cuadre (#100) se pueda ver con
 * una de cada situación que sabe distinguir. Se siembran DESPUÉS de todas las
 * rutas, porque cada conteo se compara contra el saldo final.
 *
 * Quién queda en cada estado, y por qué:
 * - `debt0_a` (1 esperado, 1 contado): contada y cuadrada. `delta === 0`, así
 *   que no deja ajuste — la fecha del conteo es su única huella.
 * - `estrella` (4 esperados, 3 contados): faltó uno. Ajuste hacia abajo.
 * - `near_limit` (2 esperados, 3 contados): había uno de más. Ajuste hacia
 *   arriba, la otra dirección que admite `COUNT_ADJUSTMENT`.
 * - `small_a`, `small_b`, `debt0_b`, `pending_yape`, `pending_transferencia`:
 *   sin contar, para que el contador de progreso tenga sus dos mitades y el
 *   filtro de sin contar devuelva un conjunto distinto al de descuadres.
 *
 * `small_a` NO se cuenta a propósito: contarla resolvería el negativo y la
 * demo se quedaría sin descuadre que mostrar.
 */
export const DEMO_CONTAINER_COUNTS: DemoContainerCountPlan[] = [
  { customerKey: "debt0_a", containerTypeKey: "CON_CANO", countedQuantity: 1 },
  { customerKey: "estrella", containerTypeKey: "CON_CANO", countedQuantity: 3 },
  { customerKey: "near_limit", containerTypeKey: "CON_CANO", countedQuantity: 3 },
];

/**
 * `count` business-date strings (AAAA-MM-DD), oldest first, ending at
 * `referenceInstant`'s America/Lima calendar date. Deliberately never routes
 * through a plain `Date` constructed from a date STRING and then read back
 * in local time (CLAUDE.md's date rule) — it reads the calendar day once via
 * `Intl.DateTimeFormat`, then does every subsequent step as UTC-anchored
 * integer arithmetic on that day, so no step re-crosses a timezone.
 */
export function businessDatesGoingBack(count: number, referenceInstant: Date): string[] {
  const limaFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = limaFormatter.formatToParts(referenceInstant);
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const anchor = Date.UTC(part("year"), part("month") - 1, part("day"));

  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(anchor - i * 86_400_000);
    const yyyy = day.getUTCFullYear();
    const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(day.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

export function deliveriesByDay(deliveries: DemoDeliveryPlan[]): Map<number, DemoDeliveryPlan[]> {
  const result = new Map<number, DemoDeliveryPlan[]>();
  for (const delivery of deliveries) {
    const list = result.get(delivery.dayIndex) ?? [];
    list.push(delivery);
    result.set(delivery.dayIndex, list);
  }
  return result;
}

/** Container units RouteLoad needs to cover each day's deliveries, by type. */
export function loadsNeededByDay(
  deliveries: DemoDeliveryPlan[],
): Map<number, Partial<Record<ContainerTypeKey, number>>> {
  const result = new Map<number, Partial<Record<ContainerTypeKey, number>>>();
  for (const delivery of deliveries) {
    const containerType = PRODUCT_CONTAINER_TYPE[delivery.productKey];
    const byType = result.get(delivery.dayIndex) ?? {};
    byType[containerType] = (byType[containerType] ?? 0) + delivery.quantity;
    result.set(delivery.dayIndex, byType);
  }
  return result;
}

function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function centsToMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Same rule as SalesService: debt moves by the full sale total, then back
 * down by the payment ONLY when it is born CONFIRMED (Efectivo here). A
 * PENDING Yape/Transferencia leaves the full total on the books until the
 * office confirms it — so this is deliberately NOT `total - payment` for
 * every delivery that has one.
 */
export function computeExpectedDebtByCustomer(deliveries: DemoDeliveryPlan[]): Map<string, string> {
  const centsByCustomer = new Map<string, number>();
  for (const delivery of deliveries) {
    const totalCents = toCents(PRODUCT_UNIT_PRICE[delivery.productKey]) * delivery.quantity;
    const confirmedCents =
      delivery.payment !== undefined &&
      !PAYMENT_METHOD_REQUIRES_CONFIRMATION[delivery.payment.methodKey]
        ? toCents(delivery.payment.amount)
        : 0;
    const delta = totalCents - confirmedCents;
    centsByCustomer.set(
      delivery.customerKey,
      (centsByCustomer.get(delivery.customerKey) ?? 0) + delta,
    );
  }

  const result = new Map<string, string>();
  for (const customer of DEMO_CUSTOMERS) {
    result.set(customer.key, centsToMoney(centsByCustomer.get(customer.key) ?? 0));
  }
  return result;
}
