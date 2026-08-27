import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  CONTAINER_TYPE_NAMES,
  DEMO_CUSTOMERS,
  DEMO_DELIVERIES,
  DEMO_DRIVER_NAME,
  DEMO_DRIVER_USERNAME,
  DEMO_HISTORY_DAYS,
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
const baseUrl = process.env.DEMO_API_BASE_URL ?? DEFAULT_BASE_URL;
const adminUsername = process.env.DEMO_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.DEMO_ADMIN_PASSWORD ?? "admin123";

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

export async function run(): Promise<void> {
  console.log(`Sembrando datos de demo contra ${baseUrl} ...`);

  const login = await apiFetch<LoginResponse>("/auth/login", null, {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
  });
  const token = login.accessToken;

  // Everything down to (not including) driver creation is a READ, on
  // purpose: catalog resolution and the price check below can fail, and
  // must do so before the script's first write.
  const [containerTypes, products, paymentMethods] = await Promise.all([
    apiFetch<CatalogEntry[]>("/container-types", token),
    apiFetch<ProductCatalogResponse[]>("/products", token),
    apiFetch<CatalogEntry[]>("/payment-methods", token),
  ]);
  const containerTypeIdByKey = resolveCatalogIds(
    containerTypes,
    CONTAINER_TYPE_NAMES,
    "el tipo de envase",
  );
  const productIdByKey = resolveCatalogIds(products, PRODUCT_NAMES, "el producto");
  const paymentMethodIdByKey = resolveCatalogIds(
    paymentMethods,
    PAYMENT_METHOD_NAMES,
    "el método de pago",
  );

  // PRODUCT_UNIT_PRICE (seed-demo-plan.ts) mirrors seed.ts's listPrice, which
  // seed.ts itself calls a provisional placeholder pending confirmation with
  // the plant owner. If it ever changes there, the "Deuda esperada" summary
  // below would silently go stale — so this checks the assumption against
  // the real catalog and refuses to write anything on a mismatch, rather
  // than print wrong numbers with no warning.
  const priceMismatches = findProductPriceMismatches(products);
  if (priceMismatches.length > 0) {
    const lines = priceMismatches.map(
      (mismatch) =>
        `  - "${mismatch.name}": esperado ${mismatch.expected}, real ${mismatch.actual}`,
    );
    throw new Error(
      "El precio real de estos productos ya no coincide con PRODUCT_UNIT_PRICE en " +
        "seed-demo-plan.ts, así que la deuda esperada que este script imprime sería " +
        `incorrecta. Actualizá esa constante antes de correr "pnpm demo:data":\n${lines.join("\n")}`,
    );
  }

  // Idempotency guard — see the file-level comment: this is the FIRST write,
  // deliberately, so a re-run aborts here instead of partway through.
  let driver: UserResponse;
  try {
    driver = await apiFetch<UserResponse>("/users", token, {
      method: "POST",
      body: {
        name: DEMO_DRIVER_NAME,
        username: DEMO_DRIVER_USERNAME,
        password: randomDriverPassword(),
        roles: ["DRIVER"],
      },
    });
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
  console.log(
    `Chofer creado: ${driver.username} (contraseña generada al azar; no se imprime y no hace ` +
      "falta dársela — el chofer nunca inicia sesión en este seed, ver CLAUDE.md).",
  );

  const customerIdByKey = new Map<string, string>();
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
    customerIdByKey.set(customer.key, created.id);

    const locations = await apiFetch<CustomerLocationResponse[]>(
      `/customers/${created.id}/locations`,
      token,
    );
    const primary = locations.find((location) => location.isPrimary);
    if (primary === undefined) {
      throw new Error(
        `El cliente "${customer.name}" no tiene locación principal (no debería pasar).`,
      );
    }
    locationIdByKey.set(customer.key, primary.id);
  }
  console.log(`Clientes creados: ${DEMO_CUSTOMERS.length}.`);

  const dates = businessDatesGoingBack(DEMO_HISTORY_DAYS, new Date());

  const batch = await apiFetch<ProductionBatchResponse>("/production-batches", token, {
    method: "POST",
    body: {
      code: PRODUCTION_BATCH_CODE,
      date: dates[0],
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
  console.log(`Lote de producción "${batch.code}" creado.`);

  const deliveriesGroupedByDay = deliveriesByDay(DEMO_DELIVERIES);
  const loadsGroupedByDay = loadsNeededByDay(DEMO_DELIVERIES);

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
    const date = dates[dayIndex] as string;
    const dayDeliveries = deliveriesGroupedByDay.get(dayIndex) ?? [];
    if (dayDeliveries.length === 0) continue;

    const route = await apiFetch<RouteResponse>("/routes", token, {
      method: "POST",
      body: { driverId: driver.id, date },
    });

    const loadsNeeded = loadsGroupedByDay.get(dayIndex) ?? {};
    for (const containerTypeKey of Object.keys(loadsNeeded) as ContainerTypeKey[]) {
      const quantity = loadsNeeded[containerTypeKey];
      if (quantity === undefined || quantity <= 0) continue;
      const batchItemId = batchItemIdByContainerType.get(containerTypeKey);
      if (batchItemId === undefined) {
        throw new Error(`No hay ítem de lote para "${CONTAINER_TYPE_NAMES[containerTypeKey]}".`);
      }
      await apiFetch(`/routes/${route.id}/loads`, token, {
        method: "POST",
        body: { batchItemId, quantity },
      });
    }

    // One stop per customer scheduled this day, in delivery-plan order.
    const stopIdByCustomerKey = new Map<string, string>();
    for (const delivery of dayDeliveries) {
      if (stopIdByCustomerKey.has(delivery.customerKey)) continue;
      const locationId = locationIdByKey.get(delivery.customerKey);
      if (locationId === undefined) {
        throw new Error(`Cliente desconocido en el plan de demo: "${delivery.customerKey}".`);
      }
      const stop = await apiFetch<RouteStopResponse>(`/routes/${route.id}/stops`, token, {
        method: "POST",
        body: { origin: "VAN_SALE", locationId },
      });
      stopIdByCustomerKey.set(delivery.customerKey, stop.id);
    }

    await apiFetch(`/routes/${route.id}/start`, token, { method: "PATCH" });

    const deliveriesByCustomerKey = new Map<string, DemoDeliveryPlan[]>();
    for (const delivery of dayDeliveries) {
      const list = deliveriesByCustomerKey.get(delivery.customerKey) ?? [];
      list.push(delivery);
      deliveriesByCustomerKey.set(delivery.customerKey, list);
    }

    for (const [customerKey, lines] of deliveriesByCustomerKey) {
      const stopId = stopIdByCustomerKey.get(customerKey);
      if (stopId === undefined) continue;
      const items = lines.map((line: DemoDeliveryPlan) => ({
        productId: productIdByKey[line.productKey as ProductKey],
        quantity: line.quantity,
      }));
      const payment = lines.find((line) => line.payment !== undefined)?.payment;

      await apiFetch(`/routes/${route.id}/stops/${stopId}`, token, {
        method: "PATCH",
        body: {
          status: "DELIVERED",
          items,
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

    await apiFetch(`/routes/${route.id}/finish`, token, { method: "PATCH" });
    console.log(`Ruta del ${date}: ${dayDeliveries.length} entregas registradas.`);
  }

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
  console.log(`\nPagos PENDING en la bandeja de confirmación: ${pendingPayments.total}.`);
}

export async function main(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main();
}
