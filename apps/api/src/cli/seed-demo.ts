import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  CONTAINER_TYPE_NAMES,
  DEMO_CONTAINER_COUNTS,
  DEMO_CUSTOMERS,
  DEMO_DELIVERIES,
  DEMO_DRIVER_NAME,
  DEMO_DRIVER_USERNAME,
  DEMO_HISTORY_DAYS,
  FLEET_ENTRY_PLAN,
  PAYMENT_METHOD_NAMES,
  PRODUCT_NAMES,
  PRODUCTION_BATCH_CODE,
  PRODUCTION_PLAN,
  businessDatesGoingBack,
  computeExpectedDebtByCustomer,
  deliveriesByDay,
  findProductPriceMismatches,
  loadsNeededByDay,
  type ContainerTypeKey,
  type DemoDeliveryPlan,
  type PaymentMethodKey,
  type ProductKey,
} from "./seed-demo-plan.js";

/**
 * Seeds demo data — customers with REAL debt, produced the way debt is
 * actually born in Yacco: through the driver's route (POST
 * /routes/:id/stops/:stopId with status=DELIVERED), never a direct Prisma
 * write. That makes this script double as the only smoke test this repo has
 * for the whole dispatch-to-delivery flow, since dispatch has no web screen
 * yet (see docs/estado-por-modulo.md).
 *
 * Talks to the API over plain HTTP (native `fetch`), unlike load-roster.ts,
 * which boots a full Nest application context to call services in-process.
 * That difference is why this file is split from seed-demo-plan.ts instead
 * of following load-roster's shape: load-roster's DI concerns (compiled
 * artifact required, entrypoint-match edge cases) don't apply to a plain
 * HTTP client, but "only exercised by actually running it against a live
 * server" still does — see sonar-project.properties for the coverage
 * exclusion this earns, mirroring load-roster.ts's own.
 *
 * Idempotency: FAILS FAST with a clear message, rather than cleaning up
 * after itself. The very first write is creating the driver user
 * (DEMO_DRIVER_USERNAME) — a unique-username conflict there aborts before
 * anything else is touched, so a second run either does nothing extra (if
 * it fails immediately) or never gets the chance to double-write later
 * steps. A real rollback would mean inverting sales, payments and container
 * movements one by one — everything this domain keeps as an immutable
 * ledger (CLAUDE.md) — which is real complexity this tool doesn't need:
 * this only ever runs against a local Docker Postgres, and `prisma migrate
 * reset` already resets it in one command.
 */

const DEFAULT_BASE_URL = "http://localhost:3100/api/v1";

// SonarCloud (S8476/S7044): a base URL taken from an env var, spliced into
// every fetch() call this script makes, is exactly the "tainted URL" shape
// those rules look for. Validating it once, here, against a strict
// host[:port] shape before anything else runs is a real guard, not a lint
// placeholder — this CLI has no business talking to anything but a plain
// http(s) origin, and a malformed value (a stray path, query string, or
// control character) is far more likely to be a typo'd env var than an
// attack, but either way it's rejected before the first request.
const BASE_URL_PATTERN = /^https?:\/\/[a-zA-Z0-9.-]+(:\d{1,5})?(\/[a-zA-Z0-9/_-]*)?$/;

function assertSafeBaseUrl(value: string): string {
  if (!BASE_URL_PATTERN.test(value)) {
    throw new Error(
      `DEMO_API_BASE_URL inválida: "${value}" no tiene la forma esperada ` +
        "(http(s)://host[:puerto][/ruta], sin query ni caracteres especiales).",
    );
  }
  return value;
}

const baseUrl = assertSafeBaseUrl(process.env.DEMO_API_BASE_URL ?? DEFAULT_BASE_URL);
const adminUsername = process.env.DEMO_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.DEMO_ADMIN_PASSWORD ?? "admin123";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SonarCloud (S7044): every id this script splices into a request path came
 * back from a PREVIOUS apiFetch call, which is enough for the taint
 * checker to flag it as attacker-controlled flowing into a URL. This is the
 * real guard, not a lint workaround: an id that isn't a well-formed UUID
 * can never be a routeId/stopId/customerId Yacco actually returned, so
 * refusing to build a request around one is strictly correct.
 */
function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Valor inesperado para ${label}: "${value}" no es un UUID.`);
  }
  return value;
}

/**
 * SonarCloud (S5145): every value below traced back to an HTTP response,
 * which its log-injection rule treats as untrusted — a value crossing a
 * process boundary could in principle carry a CR/LF and forge a fake log
 * line. Stripping those before anything reaches console.log/error is the
 * actual fix; values that only ever come from this script's own constants
 * (DEMO_CUSTOMERS, the computed business dates) are never routed through
 * this, and Sonar doesn't flag them either.
 */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\r\n]/g, " ");
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface LoginResponse {
  accessToken: string;
}
interface CatalogEntry {
  id: string;
  name: string;
}
interface ProductCatalogResponse extends CatalogEntry {
  listPrice: string;
}
interface UserResponse {
  id: string;
  username: string;
}
interface CustomerResponse {
  id: string;
  name: string;
}
interface CustomerLocationResponse {
  id: string;
  isPrimary: boolean;
}
interface ProductionBatchItemResponse {
  id: string;
  containerTypeId: string;
}
interface ProductionBatchResponse {
  code: string;
  items: ProductionBatchItemResponse[];
}
interface RouteResponse {
  id: string;
}
interface RouteStopResponse {
  id: string;
}
interface PaginatedResponse<T> {
  data: T[];
  total: number;
}
interface PaymentResponse {
  id: string;
  amount: string;
}

async function apiFetch<T>(
  path: string,
  token: string | null,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    throw new Error(
      `No se pudo conectar con la API en ${baseUrl}. ¿Está levantada? ` +
        `(pnpm demo:up && pnpm dev:api)\n${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    let parsedMessage: unknown;
    try {
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object" && "message" in body) {
        parsedMessage = (body as { message: unknown }).message;
      }
    } catch {
      // Non-JSON error body: fall through to statusText below.
    }
    const message = Array.isArray(parsedMessage)
      ? parsedMessage.join("; ")
      : (parsedMessage ?? response.statusText);
    throw new ApiError(response.status, String(message));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Random, 16 bytes of entropy — plenty over CreateUserDto's 8-char minimum. */
function randomDriverPassword(): string {
  return randomBytes(16).toString("base64url");
}

/** Resolves a fixed set of catalog names (see seed-demo-plan.ts) to real ids. */
function resolveCatalogIds<K extends string>(
  entries: CatalogEntry[],
  namesByKey: Record<K, string>,
  label: string,
): Record<K, string> {
  const idByName = new Map(entries.map((entry) => [entry.name, entry.id]));
  const result = {} as Record<K, string>;
  for (const key of Object.keys(namesByKey) as K[]) {
    const name = namesByKey[key];
    const id = idByName.get(name);
    if (id === undefined) {
      throw new Error(
        `Falta ${label} "${name}" en el catálogo. Corré "pnpm db:seed" antes de "pnpm demo:data".`,
      );
    }
    result[key] = id;
  }
  return result;
}

interface Catalog {
  containerTypeIdByKey: Record<ContainerTypeKey, string>;
  productIdByKey: Record<ProductKey, string>;
  paymentMethodIdByKey: Record<PaymentMethodKey, string>;
  products: ProductCatalogResponse[];
}

/** Everything down to (not including) driver creation is a READ, on purpose — see run(). */
async function resolveCatalog(token: string): Promise<Catalog> {
  const [containerTypes, products, paymentMethods] = await Promise.all([
    apiFetch<CatalogEntry[]>("/container-types", token),
    apiFetch<ProductCatalogResponse[]>("/products", token),
    apiFetch<CatalogEntry[]>("/payment-methods", token),
  ]);
  return {
    containerTypeIdByKey: resolveCatalogIds(
      containerTypes,
      CONTAINER_TYPE_NAMES,
      "el tipo de envase",
    ),
    productIdByKey: resolveCatalogIds(products, PRODUCT_NAMES, "el producto"),
    paymentMethodIdByKey: resolveCatalogIds(
      paymentMethods,
      PAYMENT_METHOD_NAMES,
      "el método de pago",
    ),
    products,
  };
}

/**
 * PRODUCT_UNIT_PRICE (seed-demo-plan.ts) mirrors seed.ts's listPrice, which
 * seed.ts itself calls a provisional placeholder pending confirmation with
 * the plant owner. If it ever changes there, the "Deuda esperada" summary
 * below would silently go stale — so this checks the assumption against
 * the real catalog and refuses to write anything on a mismatch, rather
 * than print wrong numbers with no warning.
 */
function assertPricesMatchCatalog(products: ProductCatalogResponse[]): void {
  const priceMismatches = findProductPriceMismatches(products);
  if (priceMismatches.length === 0) return;

  const lines = priceMismatches.map(
    (mismatch) => `  - "${mismatch.name}": esperado ${mismatch.expected}, real ${mismatch.actual}`,
  );
  throw new Error(
    "El precio real de estos productos ya no coincide con PRODUCT_UNIT_PRICE en " +
      "seed-demo-plan.ts, así que la deuda esperada que este script imprime sería " +
      `incorrecta. Actualizá esa constante antes de correr "pnpm demo:data":\n${lines.join("\n")}`,
  );
}

/** Idempotency guard — see the file-level comment: this is the FIRST write, deliberately. */
async function createDriver(token: string): Promise<UserResponse> {
  try {
    const driver = await apiFetch<UserResponse>("/users", token, {
      method: "POST",
      body: {
        name: DEMO_DRIVER_NAME,
        username: DEMO_DRIVER_USERNAME,
        password: randomDriverPassword(),
        roles: ["DRIVER"],
      },
    });
    console.log(
      `Chofer creado: ${sanitizeForLog(driver.username)} (contraseña generada al azar; no se ` +
        "imprime y no hace falta dársela — el chofer nunca inicia sesión en este seed, ver CLAUDE.md).",
    );
    return driver;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new Error(
        `El seed de demo ya corrió antes: el usuario "${DEMO_DRIVER_USERNAME}" ya existe. ` +
          "Este script no se limpia solo — reseteá la base local de Docker " +
          "(cd apps/api && npx prisma migrate reset) y volvé a correr pnpm demo:data.",
      );
    }
    throw error;
  }
}

async function createCustomers(token: string): Promise<Map<string, string>> {
  const locationIdByKey = new Map<string, string>();
  for (const customer of DEMO_CUSTOMERS) {
    const created = await apiFetch<CustomerResponse>("/customers", token, {
      method: "POST",
      body: {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        addressReference: customer.addressReference,
        ...(customer.creditLimit !== undefined ? { creditLimit: customer.creditLimit } : {}),
      },
    });

    const locations = await apiFetch<CustomerLocationResponse[]>(
      `/customers/${assertUuid(created.id, "id de cliente")}/locations`,
      token,
    );
    const primary = locations.find((location) => location.isPrimary);
    if (primary === undefined) {
      throw new Error(
        `El cliente "${customer.name}" no tiene ubicación principal (no debería pasar).`,
      );
    }
    locationIdByKey.set(customer.key, primary.id);
  }
  console.log(`Clientes creados: ${DEMO_CUSTOMERS.length}.`);
  return locationIdByKey;
}

async function createProductionBatch(
  token: string,
  date: string,
  containerTypeIdByKey: Record<ContainerTypeKey, string>,
): Promise<Map<ContainerTypeKey, string>> {
  const batch = await apiFetch<ProductionBatchResponse>("/production-batches", token, {
    method: "POST",
    body: {
      code: PRODUCTION_BATCH_CODE,
      date,
      notes: "Lote de arranque para el seed de demo.",
      items: PRODUCTION_PLAN.map((line) => ({
        containerTypeId: containerTypeIdByKey[line.containerType],
        producedQty: line.producedQty,
      })),
    },
  });

  const batchItemIdByContainerType = new Map<ContainerTypeKey, string>();
  for (const item of batch.items) {
    const key = (Object.keys(containerTypeIdByKey) as ContainerTypeKey[]).find(
      (candidate) => containerTypeIdByKey[candidate] === item.containerTypeId,
    );
    if (key !== undefined) batchItemIdByContainerType.set(key, item.id);
  }
  console.log(`Lote de producción "${sanitizeForLog(batch.code)}" creado.`);
  return batchItemIdByContainerType;
}

async function loadRouteContainers(
  token: string,
  routeId: string,
  loadsNeeded: Partial<Record<ContainerTypeKey, number>>,
  batchItemIdByContainerType: Map<ContainerTypeKey, string>,
): Promise<void> {
  const safeRouteId = assertUuid(routeId, "id de ruta");
  for (const containerTypeKey of Object.keys(loadsNeeded) as ContainerTypeKey[]) {
    const quantity = loadsNeeded[containerTypeKey];
    if (quantity === undefined || quantity <= 0) continue;
    const batchItemId = batchItemIdByContainerType.get(containerTypeKey);
    if (batchItemId === undefined) {
      throw new Error(`No hay ítem de lote para "${CONTAINER_TYPE_NAMES[containerTypeKey]}".`);
    }
    await apiFetch(`/routes/${safeRouteId}/loads`, token, {
      method: "POST",
      body: { batchItemId, quantity },
    });
  }
}

/** One stop per customer scheduled this day, in delivery-plan order. */
async function addRouteStops(
  token: string,
  routeId: string,
  dayDeliveries: DemoDeliveryPlan[],
  locationIdByKey: Map<string, string>,
): Promise<Map<string, string>> {
  const safeRouteId = assertUuid(routeId, "id de ruta");
  const stopIdByCustomerKey = new Map<string, string>();
  for (const delivery of dayDeliveries) {
    if (stopIdByCustomerKey.has(delivery.customerKey)) continue;
    const locationId = locationIdByKey.get(delivery.customerKey);
    if (locationId === undefined) {
      throw new Error(`Cliente desconocido en el plan de demo: "${delivery.customerKey}".`);
    }
    const stop = await apiFetch<RouteStopResponse>(`/routes/${safeRouteId}/stops`, token, {
      method: "POST",
      body: { origin: "VAN_SALE", locationId },
    });
    stopIdByCustomerKey.set(delivery.customerKey, stop.id);
  }
  return stopIdByCustomerKey;
}

function groupDeliveriesByCustomer(
  dayDeliveries: DemoDeliveryPlan[],
): Map<string, DemoDeliveryPlan[]> {
  const deliveriesByCustomerKey = new Map<string, DemoDeliveryPlan[]>();
  for (const delivery of dayDeliveries) {
    const list = deliveriesByCustomerKey.get(delivery.customerKey) ?? [];
    list.push(delivery);
    deliveriesByCustomerKey.set(delivery.customerKey, list);
  }
  return deliveriesByCustomerKey;
}

async function deliverRouteStops(
  token: string,
  routeId: string,
  dayDeliveries: DemoDeliveryPlan[],
  stopIdByCustomerKey: Map<string, string>,
  productIdByKey: Record<ProductKey, string>,
  paymentMethodIdByKey: Record<PaymentMethodKey, string>,
  containerTypeIdByKey: Record<ContainerTypeKey, string>,
): Promise<void> {
  const safeRouteId = assertUuid(routeId, "id de ruta");
  const deliveriesByCustomerKey = groupDeliveriesByCustomer(dayDeliveries);

  for (const [customerKey, lines] of deliveriesByCustomerKey) {
    const stopId = stopIdByCustomerKey.get(customerKey);
    if (stopId === undefined) continue;
    const items = lines.map((line) => ({
      productId: productIdByKey[line.productKey as ProductKey],
      quantity: line.quantity,
    }));
    const payment = lines.find((line) => line.payment !== undefined)?.payment;
    // Los vacíos que el cliente devuelve en esta misma visita. Se mandan por
    // el mismo PATCH que la entrega, que es como los registra el chofer:
    // `SalesService` los aplica en pleno y reporta el saldo resultante sin
    // validarlo contra nada, así que una devolución mayor a lo entregado deja
    // el saldo en negativo por el camino real (CLAUDE.md: alertar, no
    // bloquear). Es el descuadre que la demo necesita mostrar.
    const containersReturned = lines.flatMap((line) =>
      (line.containersReturned ?? []).map((returned) => ({
        containerTypeId: containerTypeIdByKey[returned.containerTypeKey],
        quantity: returned.quantity,
      })),
    );

    await apiFetch(`/routes/${safeRouteId}/stops/${assertUuid(stopId, "id de parada")}`, token, {
      method: "PATCH",
      body: {
        status: "DELIVERED",
        items,
        ...(containersReturned.length > 0 ? { containersReturned } : {}),
        ...(payment !== undefined
          ? {
              payment: {
                paymentMethodId: paymentMethodIdByKey[payment.methodKey as PaymentMethodKey],
                amount: payment.amount,
              },
            }
          : {}),
      },
    });
  }
}

async function runRouteForDay(
  token: string,
  driverId: string,
  date: string,
  dayDeliveries: DemoDeliveryPlan[],
  loadsNeeded: Partial<Record<ContainerTypeKey, number>>,
  batchItemIdByContainerType: Map<ContainerTypeKey, string>,
  locationIdByKey: Map<string, string>,
  productIdByKey: Record<ProductKey, string>,
  paymentMethodIdByKey: Record<PaymentMethodKey, string>,
  containerTypeIdByKey: Record<ContainerTypeKey, string>,
): Promise<void> {
  const route = await apiFetch<RouteResponse>("/routes", token, {
    method: "POST",
    body: { driverId, date },
  });

  await loadRouteContainers(token, route.id, loadsNeeded, batchItemIdByContainerType);
  const stopIdByCustomerKey = await addRouteStops(token, route.id, dayDeliveries, locationIdByKey);

  await apiFetch(`/routes/${assertUuid(route.id, "id de ruta")}/start`, token, { method: "PATCH" });
  await deliverRouteStops(
    token,
    route.id,
    dayDeliveries,
    stopIdByCustomerKey,
    productIdByKey,
    paymentMethodIdByKey,
    containerTypeIdByKey,
  );
  await apiFetch(`/routes/${assertUuid(route.id, "id de ruta")}/finish`, token, {
    method: "PATCH",
  });

  console.log(`Ruta del ${date}: ${dayDeliveries.length} entregas registradas.`);
}

/**
 * El parque inicial, ANTES del lote: `FILLING` consume vacíos en planta, así
 * que sin esta entrada la demo llenaba envases que no existían y el
 * inventario abría con un negativo y su aviso en rojo.
 */
async function seedFleetEntry(
  token: string,
  containerTypeIdByKey: Record<ContainerTypeKey, string>,
): Promise<void> {
  for (const line of FLEET_ENTRY_PLAN) {
    await apiFetch("/container-movements", token, {
      method: "POST",
      body: {
        type: "FLEET_ENTRY",
        containerTypeId: containerTypeIdByKey[line.containerType],
        quantity: line.quantity,
        toState: "EMPTY_AT_PLANT",
      },
    });
  }
  const total = FLEET_ENTRY_PLAN.reduce((sum, line) => sum + line.quantity, 0);
  console.log(`Parque inicial dado de alta: ${total} envases vacíos en planta.`);
}

/**
 * Conteos físicos, DESPUÉS de todas las rutas: cada uno se compara contra el
 * saldo final de esa ubicación, así que sembrarlos antes contaría contra un
 * saldo intermedio y dejaría ajustes que no significan nada.
 *
 * Todos caen en el mismo instante, y no hay forma de evitarlo desde acá:
 * `CreateContainerCountDto` no acepta fecha a propósito. Por eso el filtro
 * «contadas antes de» de la pantalla de cuadre no se puede demostrar con
 * estos datos — anotado en docs/backlog-tecnico.md.
 */
async function seedContainerCounts(
  token: string,
  locationIdByKey: Map<string, string>,
  containerTypeIdByKey: Record<ContainerTypeKey, string>,
): Promise<void> {
  for (const count of DEMO_CONTAINER_COUNTS) {
    const locationId = locationIdByKey.get(count.customerKey);
    if (locationId === undefined) continue;

    await apiFetch("/container-counts", token, {
      method: "POST",
      body: {
        locationId: assertUuid(locationId, "id de ubicación"),
        containerTypeId: containerTypeIdByKey[count.containerTypeKey],
        countedQuantity: count.countedQuantity,
      },
    });
  }
  console.log(`Conteos de envases registrados: ${DEMO_CONTAINER_COUNTS.length}.`);
}

async function printSummary(token: string): Promise<void> {
  const expectedDebtByCustomerKey = computeExpectedDebtByCustomer(DEMO_DELIVERIES);
  console.log("\nDeuda esperada (verificar contra GET /customers):");
  for (const customer of DEMO_CUSTOMERS) {
    const expected = expectedDebtByCustomerKey.get(customer.key) ?? "0.00";
    const limitNote =
      customer.creditLimit !== undefined ? ` (límite S/ ${customer.creditLimit})` : "";
    console.log(`  ${customer.name}: S/ ${expected}${limitNote}`);
  }

  const pendingPayments = await apiFetch<PaginatedResponse<PaymentResponse>>(
    "/payments?status=PENDING",
    token,
  );
  console.log(
    `\nPagos PENDING en la bandeja de confirmación: ${sanitizeForLog(pendingPayments.total)}.`,
  );
}

export async function run(): Promise<void> {
  console.log(`Sembrando datos de demo contra ${baseUrl} ...`);

  const login = await apiFetch<LoginResponse>("/auth/login", null, {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
  });
  const token = login.accessToken;

  const { containerTypeIdByKey, productIdByKey, paymentMethodIdByKey, products } =
    await resolveCatalog(token);
  assertPricesMatchCatalog(products);

  await seedFleetEntry(token, containerTypeIdByKey);
  const driver = await createDriver(token);
  const locationIdByKey = await createCustomers(token);

  const dates = businessDatesGoingBack(DEMO_HISTORY_DAYS, new Date());
  const batchItemIdByContainerType = await createProductionBatch(
    token,
    dates[0] as string,
    containerTypeIdByKey,
  );

  const deliveriesGroupedByDay = deliveriesByDay(DEMO_DELIVERIES);
  const loadsGroupedByDay = loadsNeededByDay(DEMO_DELIVERIES);

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
    const date = dates[dayIndex] as string;
    const dayDeliveries = deliveriesGroupedByDay.get(dayIndex) ?? [];
    if (dayDeliveries.length === 0) continue;

    await runRouteForDay(
      token,
      driver.id,
      date,
      dayDeliveries,
      loadsGroupedByDay.get(dayIndex) ?? {},
      batchItemIdByContainerType,
      locationIdByKey,
      productIdByKey,
      paymentMethodIdByKey,
      containerTypeIdByKey,
    );
  }

  await seedContainerCounts(token, locationIdByKey, containerTypeIdByKey);
  await printSummary(token);
}

export async function main(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(sanitizeForLog(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main();
}
