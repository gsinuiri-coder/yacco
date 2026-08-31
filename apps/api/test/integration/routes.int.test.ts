import request from "supertest";
import {
  ContainerMovementType,
  ContainerState,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RouteStatus,
  StopOrigin,
  StopStatus,
} from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SalesService } from "../../src/modules/sales/sales.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";
const ROUTE_DATE = "2026-08-25";

// One route per driver per day, so tests that need several fresh routes for
// the same driver each need a distinct date — sequential days starting well
// past every fixed date literal used elsewhere in this file. Computed via
// real date arithmetic (not string padding) so it rolls over past day 30
// into December, January, etc. instead of ever emitting "2026-11-31".
let nextDayOffset = 0;
function nextDate(): string {
  const date = new Date(Date.UTC(2026, 10, 1) + nextDayOffset * 24 * 60 * 60 * 1000);
  nextDayOffset += 1;
  return date.toISOString().slice(0, 10);
}

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let driverId: string;
let otherDriverToken: string;
let otherDriverId: string;
let zoneId: string;
let customerId: string;
let locationId: string;
let refillProductId: string;
let containerTypeId: string;
let adminUserId: string;
let cashPaymentMethodId: string;
let yapePaymentMethodId: string;

function server() {
  return ctx.app.getHttpServer();
}

async function login(username: string, password: string): Promise<string> {
  const response = await request(server())
    .post("/api/v1/auth/login")
    .send({ username, password })
    .expect(200);
  return response.body.accessToken;
}

async function createUserAndLogin(
  username: string,
  role: string,
): Promise<{ token: string; id: string }> {
  const password = `${username}-password`;
  const created = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: username, username, password, roles: [role] })
    .expect(201);
  return { token: await login(username, password), id: created.body.id };
}

function messagesOf(response: { body: { message?: string | string[] } }): string {
  const { message } = response.body;
  return Array.isArray(message) ? message.join(" | ") : (message ?? "");
}

function validRoute(overrides: Record<string, unknown> = {}) {
  return { driverId, date: ROUTE_DATE, zoneId, ...overrides };
}

async function createRoute(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${token}`)
    .send(validRoute(overrides))
    .expect(201);
  return response.body.id;
}

async function startRoute(token: string, routeId: string): Promise<void> {
  await request(server())
    .patch(`/api/v1/routes/${routeId}/start`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
}

async function createPendingOrder(token: string): Promise<string> {
  const response = await request(server())
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      customerId,
      deliveryDate: ROUTE_DATE,
      items: [{ productId: refillProductId, quantity: 2, unitPrice: "12.50" }],
    })
    .expect(201);
  return response.body.id;
}

async function addVanSaleStop(token: string, routeId: string): Promise<string> {
  const response = await request(server())
    .post(`/api/v1/routes/${routeId}/stops`)
    .set("Authorization", `Bearer ${token}`)
    .send({ origin: StopOrigin.VAN_SALE, locationId })
    .expect(201);
  return response.body.id;
}

let batchCounter = 0;
/**
 * Cada lote nace UN DÍA MÁS VIEJO que el anterior, a propósito. `POST
 * /routes/:id/loads` exige el lote más antiguo con unidades disponibles de
 * ese tipo de envase (FIFO), y estos tests comparten un único
 * `containerTypeId`: con una fecha fija, el sobrante de un test anterior
 * sería la cabeza del FIFO y toda carga posterior se rechazaría. Fechándolos
 * hacia atrás, el lote recién creado es siempre el que la regla manda cargar,
 * que es justo lo que cada test quiere decir al pedirlo.
 *
 * La aritmética va en UTC, igual que `parseBusinessDate`/`formatBusinessDate`
 * de la API: construirla con partes locales dejaría que la zona horaria de
 * quien corre los tests corriera el día.
 */
function nextBatchDate(): string {
  const base = Date.UTC(2026, 7, 1);
  return new Date(base - batchCounter * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
/** A fresh ProductionBatch with one item, so each test controls its own stock. */
async function createBatchItem(producedQty: number): Promise<string> {
  batchCounter += 1;
  const response = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      code: `LOTE-RUTAS-${batchCounter}`,
      date: nextBatchDate(),
      items: [{ containerTypeId, producedQty }],
    })
    .expect(201);
  return response.body.items[0].id;
}

async function addLoad(
  token: string,
  routeId: string,
  batchItemId: string,
  quantity: number,
): Promise<request.Test> {
  return request(server())
    .post(`/api/v1/routes/${routeId}/loads`)
    .set("Authorization", `Bearer ${token}`)
    .send({ batchItemId, quantity });
}

let dispatchCustomerSeq = 0;
/** An independent customer+location per dispatch test, so debt/container
 * balance assertions never depend on what an earlier test in this file did. */
async function createFreshLocation(): Promise<{ customerId: string; locationId: string }> {
  dispatchCustomerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Despacho ${dispatchCustomerSeq}`,
      phone: `98600${String(dispatchCustomerSeq).padStart(4, "0")}`,
      address: "Av. Despacho 1",
      addressReference: "Reja verde",
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  return { customerId: customer.body.id, locationId: location.id };
}

/** A fresh IN_PROGRESS route with one VAN_SALE stop and `loadedQty` fulls on the truck. */
async function routeInProgressWithStock(
  loadedQty: number,
  stopLocationId: string,
): Promise<{ routeId: string; stopId: string }> {
  const batchItemId = await createBatchItem(loadedQty);
  const routeId = await createRoute(adminToken, { date: nextDate() });
  await addLoad(adminToken, routeId, batchItemId, loadedQty).then((r) =>
    expect(r.status).toBe(201),
  );
  const stopResponse = await request(server())
    .post(`/api/v1/routes/${routeId}/stops`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ origin: StopOrigin.VAN_SALE, locationId: stopLocationId })
    .expect(201);
  await startRoute(adminToken, routeId);
  return { routeId, stopId: stopResponse.body.id };
}

async function deliverStop(
  token: string,
  routeId: string,
  stopId: string,
  body: Record<string, unknown>,
): Promise<request.Test> {
  return request(server())
    .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ status: StopStatus.DELIVERED, ...body });
}

async function customerDebtBalance(id: string): Promise<string> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });
  return customer.debtBalance.toFixed(2);
}

async function containerBalance(location: string): Promise<number> {
  const balance = await prisma.customerContainerBalance.findUnique({
    where: { locationId_containerTypeId: { locationId: location, containerTypeId } },
  });
  return balance?.quantity ?? 0;
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = (await createUserAndLogin("vendedor-rutas", "SELLER")).token;
  const driver = await createUserAndLogin("repartidor-rutas", "DRIVER");
  driverToken = driver.token;
  driverId = driver.id;
  const otherDriver = await createUserAndLogin("repartidor-rutas-2", "DRIVER");
  otherDriverToken = otherDriver.token;
  otherDriverId = otherDriver.id;

  const zone = await request(server())
    .post("/api/v1/zones")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Zona Rutas" })
    .expect(201);
  zoneId = zone.body.id;

  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega Rutas",
      phone: "987000000",
      address: "Av. Rutas 100",
      addressReference: "Frente al parque",
    })
    .expect(201);
  customerId = customer.body.id;

  const location = await prisma.customerLocation.findFirstOrThrow({ where: { customerId } });
  locationId = location.id;

  const containerType = await prisma.containerType.findFirstOrThrow();
  containerTypeId = containerType.id;
  const product = await prisma.product.create({
    data: {
      containerTypeId: containerType.id,
      name: "Recarga 20L (rutas)",
      type: "REFILL",
      listPrice: "12.50",
    },
  });
  refillProductId = product.id;

  const admin = await prisma.user.findFirstOrThrow({ where: { username: ADMIN_USERNAME } });
  adminUserId = admin.id;
  cashPaymentMethodId = (
    await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } })
  ).id;
  yapePaymentMethodId = (await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Yape" } }))
    .id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

// HU-10 §2.4 E1 (this PR: only the planning skeleton — FIFO cargo and the
// pedido -> ON_ROUTE transition belong to the next PR): "Dado pedidos
// pendientes y stock de llenos por lote, cuando creo la ruta con sus
// paradas y carga, entonces..."

describe("POST /api/v1/routes", () => {
  test("an admin plans a route, born PLANNED", async () => {
    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validRoute());

    expect(response.status).toBe(201);
    expect(response.body.status).toBe(RouteStatus.PLANNED);
    expect(response.body.date).toBe(ROUTE_DATE);
    expect(response.body.driver).toMatchObject({ id: driverId });
    expect(response.body.zone).toMatchObject({ id: zoneId });
    expect(response.body.stops).toEqual([]);
  });

  test("a seller can also plan a route", async () => {
    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send(validRoute({ date: "2026-08-26" }));

    expect(response.status).toBe(201);
  });

  test("a driver cannot plan a route: planning is office work", async () => {
    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${driverToken}`)
      .send(validRoute({ date: "2026-08-27" }));

    expect(response.status).toBe(403);
  });

  test("zoneId is optional", async () => {
    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ driverId, date: "2026-08-28" });

    expect(response.status).toBe(201);
    expect(response.body.zone).toBeNull();
  });

  test("rejects a driver id that does not exist", async () => {
    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validRoute({ driverId: MISSING_UUID, date: "2026-08-29" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain(MISSING_UUID);
  });

  test("rejects a driverId that names a user without the DRIVER role", async () => {
    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        validRoute({
          driverId: (await createUserAndLogin("no-chofer", "SELLER")).id,
          date: "2026-08-30",
        }),
      );

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no tiene el rol de chofer");
  });

  test("rejects a deactivated driver, naming them", async () => {
    const inactive = await createUserAndLogin("chofer-inactivo", "DRIVER");
    await request(server())
      .patch(`/api/v1/users/${inactive.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);

    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validRoute({ driverId: inactive.id, date: "2026-08-31" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("chofer-inactivo");
    expect(messagesOf(response)).toContain("desactivado");
  });

  test("rejects an unknown zone", async () => {
    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validRoute({ zoneId: MISSING_UUID, date: "2026-09-01" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain(MISSING_UUID);
  });

  test("one route per driver per day: a second POST fails with a clear message", async () => {
    await createRoute(adminToken, { date: "2026-09-05" });

    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validRoute({ date: "2026-09-05" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("ya tiene una ruta planificada");
    // Como la lee una persona, no como viaja en el cable: la web muestra este
    // mensaje tal cual, junto a fechas que siempre dice en DD/MM/AAAA.
    expect(messagesOf(response)).toContain("05/09/2026");
    expect(messagesOf(response)).not.toContain("2026-09-05");
  });

  test("rejects a malformed date", async () => {
    const response = await request(server())
      .post("/api/v1/routes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validRoute({ date: "25/08/2026" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("AAAA-MM-DD");
  });
});

describe("GET /api/v1/routes", () => {
  let listDate: string;

  beforeAll(async () => {
    listDate = "2026-09-10";
    await createRoute(adminToken, { date: listDate });
    await createRoute(adminToken, { driverId: otherDriverId, date: listDate });
  });

  test("paginates", async () => {
    const response = await request(server())
      .get(`/api/v1/routes?date=${listDate}&limit=1`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.total).toBeGreaterThanOrEqual(2);
  });

  test("filters by driverId, zoneId and status", async () => {
    const response = await request(server())
      .get(`/api/v1/routes?date=${listDate}&driverId=${driverId}&zoneId=${zoneId}&status=PLANNED`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    for (const route of response.body.data) {
      expect(route.driverId).toBe(driverId);
      expect(route.zoneId).toBe(zoneId);
      expect(route.status).toBe(RouteStatus.PLANNED);
    }
  });

  test("a driver only ever sees their own routes, even asking for another driverId", async () => {
    const response = await request(server())
      .get(`/api/v1/routes?date=${listDate}&driverId=${otherDriverId}&limit=100`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(200);
    for (const route of response.body.data) {
      expect(route.driverId).toBe(driverId);
    }
  });
});

describe("GET /api/v1/routes/:id", () => {
  test("returns the route with its stops ordered by position", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-15" });
    await addVanSaleStop(adminToken, routeId);
    await addVanSaleStop(adminToken, routeId);

    const response = await request(server())
      .get(`/api/v1/routes/${routeId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.stops).toHaveLength(2);
    expect(response.body.stops[0].position).toBe(1);
    expect(response.body.stops[1].position).toBe(2);
  });

  // La locación principal de todo cliente se llama "Principal": sin el
  // cliente, una hoja de ruta repite ese nombre en cada fila.
  test("each stop's location names the customer it belongs to", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-19" });
    await addVanSaleStop(adminToken, routeId);

    const response = await request(server())
      .get(`/api/v1/routes/${routeId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.stops[0].location.customer).toEqual({
      id: customerId,
      name: "Bodega Rutas",
    });
  });

  test("an unknown id is rejected with 404", async () => {
    const response = await request(server())
      .get(`/api/v1/routes/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  test("the assigned driver can see their own route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-16" });

    const response = await request(server())
      .get(`/api/v1/routes/${routeId}`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(200);
  });

  test("a driver is refused another driver's route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-17" });

    const response = await request(server())
      .get(`/api/v1/routes/${routeId}`)
      .set("Authorization", `Bearer ${otherDriverToken}`);

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/v1/routes/:id/start and /finish", () => {
  test("PLANNED -> IN_PROGRESS -> FINISHED", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-20" });

    const started = await request(server())
      .patch(`/api/v1/routes/${routeId}/start`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe(RouteStatus.IN_PROGRESS);

    const finished = await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(finished.status).toBe(200);
    expect(finished.body.status).toBe(RouteStatus.FINISHED);
  });

  test("a driver can start and finish their own route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-21" });

    await request(server())
      .patch(`/api/v1/routes/${routeId}/start`)
      .set("Authorization", `Bearer ${driverToken}`)
      .expect(200);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${driverToken}`)
      .expect(200);
  });

  test("refuses to finish a route that was never started", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-22" });

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain(RouteStatus.PLANNED);
  });

  test("refuses to start a route twice", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-23" });
    await startRoute(adminToken, routeId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/start`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain(RouteStatus.IN_PROGRESS);
  });

  test("refuses to finish a route twice", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-24" });
    await startRoute(adminToken, routeId);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain(RouteStatus.FINISHED);
  });

  // Terminar exige que las paradas estén resueltas. No es «avisa, no bloquea»
  // al revés: eso rige juicios de negocio (el límite de crédito, una
  // liquidación descuadrada), y esto es la máquina de estados. Una parada
  // PENDING en una ruta FINISHED deja su pedido en ON_ROUTE sin ninguna
  // salida — es lo que prueba el último test de este bloque.
  test("refuses to finish a route with a stop still PENDING, saying how many are left", async () => {
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await addVanSaleStop(adminToken, routeId);
    await startRoute(adminToken, routeId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toBe(
      "No se puede terminar la ruta: queda 1 parada sin resolver. Cada parada tiene que quedar marcada (entregada o no entregada) o quitarse de la ruta.",
    );
    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe(RouteStatus.IN_PROGRESS);
  });

  test("el mensaje va en plural cuando falta más de una parada", async () => {
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await addVanSaleStop(adminToken, routeId);
    await addVanSaleStop(adminToken, routeId);
    await addVanSaleStop(adminToken, routeId);
    await startRoute(adminToken, routeId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toBe(
      "No se puede terminar la ruta: quedan 3 paradas sin resolver. Cada parada tiene que quedar marcada (entregada o no entregada) o quitarse de la ruta.",
    );
  });

  // Resuelta no es lo mismo que entregada: una parada que no se pudo entregar
  // también cierra su pedido, y no traba la ruta.
  test("finishes once every stop is resolved, a FAILED one included", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(5, locId);
    const failedStopId = await addVanSaleStop(adminToken, routeId);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${failedStopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Local cerrado" })
      .expect(200);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(RouteStatus.FINISHED);
  });

  // `none` es cierto sobre el conjunto vacío, y una ruta que nunca tuvo
  // paradas no congela ningún pedido: se termina como siempre.
  test("a route with no stops can still be finished", async () => {
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await startRoute(adminToken, routeId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(RouteStatus.FINISHED);
    expect(response.body.stops).toEqual([]);
  });

  // El que cierra el bucle: el 409 no es el punto, el punto es que el pedido
  // de la parada pendiente todavía tiene salida. Con la ruta FINISHED y la
  // parada PENDING no la tendría — `markStop` exige la ruta en curso,
  // `removeStop` exige que se pueda tocar, y `OrdersService.cancel` exige el
  // pedido PENDING.
  test("tras el 409, el pedido de la parada pendiente todavía puede cerrarse", async () => {
    const routeId = await createRoute(adminToken, { date: nextDate() });
    const orderId = await createPendingOrder(adminToken);
    const stop = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId })
      .expect(201);
    await startRoute(adminToken, routeId);

    const refused = await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(refused.status).toBe(409);
    const stillOnRoute = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(stillOnRoute.status).toBe(OrderStatus.ON_ROUTE);

    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stop.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Local cerrado" })
      .expect(200);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.FAILED);
  });

  test("an unknown id is rejected with 404", async () => {
    const response = await request(server())
      .patch(`/api/v1/routes/${MISSING_UUID}/start`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  test("a driver cannot start another driver's route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-25" });

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/start`)
      .set("Authorization", `Bearer ${otherDriverToken}`);

    expect(response.status).toBe(403);
  });
});

describe("POST /api/v1/routes/:id/stops", () => {
  test("VAN_SALE: takes locationId directly, position starts at 1", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-09-30" });

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.VAN_SALE, locationId });

    expect(response.status).toBe(201);
    expect(response.body.origin).toBe(StopOrigin.VAN_SALE);
    expect(response.body.locationId).toBe(locationId);
    expect(response.body.orderId).toBeNull();
    expect(response.body.position).toBe(1);
    expect(response.body.status).toBe(StopStatus.PENDING);
  });

  test("a second stop gets position 2", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-01" });
    await addVanSaleStop(adminToken, routeId);

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.VAN_SALE, locationId });

    expect(response.status).toBe(201);
    expect(response.body.position).toBe(2);
  });

  test("ORDER: derives locationId from the pending order, needs no locationId", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-02" });
    const orderId = await createPendingOrder(adminToken);

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId });

    expect(response.status).toBe(201);
    expect(response.body.origin).toBe(StopOrigin.ORDER);
    expect(response.body.orderId).toBe(orderId);
    expect(response.body.locationId).toBe(locationId);
  });

  test("refuses ORDER with no orderId", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-03" });

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("orderId");
  });

  test("refuses VAN_SALE with no locationId", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-04" });

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.VAN_SALE });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("locationId");
  });

  test("refuses an order that is not pending", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-05" });
    const orderId = await createPendingOrder(adminToken);
    await request(server())
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no está pendiente");
  });

  test("refuses an order already assigned to another stop, naming it as the reason", async () => {
    const firstRouteId = await createRoute(adminToken, { date: "2026-10-06" });
    const secondRouteId = await createRoute(adminToken, {
      driverId: otherDriverId,
      date: "2026-10-06",
    });
    const orderId = await createPendingOrder(adminToken);
    await request(server())
      .post(`/api/v1/routes/${firstRouteId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId })
      .expect(201);

    const response = await request(server())
      .post(`/api/v1/routes/${secondRouteId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("ya está asignado a otra parada");
  });

  test("refuses to add a stop to a FINISHED route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-07" });
    await startRoute(adminToken, routeId);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.VAN_SALE, locationId });

    expect(response.status).toBe(409);
  });

  test("a driver can add a VAN_SALE stop to their own route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-08" });

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ origin: StopOrigin.VAN_SALE, locationId });

    expect(response.status).toBe(201);
  });

  test("a driver cannot add a stop to another driver's route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-09" });

    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${otherDriverToken}`)
      .send({ origin: StopOrigin.VAN_SALE, locationId });

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/v1/routes/:id/stops/:stopId", () => {
  // Loaded with stock (unlike a bare PLANNED->IN_PROGRESS route) so a plain
  // DELIVERED mark in this describe block — which now always registers a
  // real delivery — has fulls on the truck to deliver. A function, not a
  // plain const: `describe` bodies run at file-load time, before `beforeAll`
  // has set `refillProductId`, so a value computed eagerly here would bake
  // in `undefined`.
  function oneItem() {
    return [{ productId: refillProductId, quantity: 1 }];
  }
  async function inProgressRouteWithStop(): Promise<{ routeId: string; stopId: string }> {
    const batchItemId = await createBatchItem(10);
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await addLoad(adminToken, routeId, batchItemId, 10).then((r) => expect(r.status).toBe(201));
    const stopId = await addVanSaleStop(adminToken, routeId);
    await startRoute(adminToken, routeId);
    return { routeId, stopId };
  }

  test("marks a stop DELIVERED", async () => {
    const { routeId, stopId } = await inProgressRouteWithStop();

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ status: StopStatus.DELIVERED, items: oneItem() });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(StopStatus.DELIVERED);
    expect(response.body.failureReason).toBeNull();
  });

  test("marks a stop FAILED with a reason", async () => {
    const { routeId, stopId } = await inProgressRouteWithStop();

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Cliente cerrado" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(StopStatus.FAILED);
    expect(response.body.failureReason).toBe("Cliente cerrado");
  });

  test("FAILED with no reason is rejected", async () => {
    const { routeId, stopId } = await inProgressRouteWithStop();

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ status: StopStatus.FAILED });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("motivo");
  });

  test("DELIVERED carrying a failureReason is rejected", async () => {
    const { routeId, stopId } = await inProgressRouteWithStop();

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ status: StopStatus.DELIVERED, failureReason: "no debería ir" });

    expect(response.status).toBe(400);
  });

  test("refuses to mark a stop before the route starts", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-16" });
    const stopId = await addVanSaleStop(adminToken, routeId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ status: StopStatus.DELIVERED });

    expect(response.status).toBe(409);
  });

  test("refuses to re-mark an already-marked stop", async () => {
    const { routeId, stopId } = await inProgressRouteWithStop();
    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ status: StopStatus.DELIVERED, items: oneItem() })
      .expect(200);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "x" });

    expect(response.status).toBe(409);
  });

  test("an unknown stopId is rejected with 404", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-17" });
    await startRoute(adminToken, routeId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.DELIVERED, items: oneItem() });

    expect(response.status).toBe(404);
  });

  test("a driver cannot mark a stop on another driver's route", async () => {
    const { routeId, stopId } = await inProgressRouteWithStop();

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${otherDriverToken}`)
      .send({ status: StopStatus.DELIVERED });

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/v1/routes/:id/stops/reorder", () => {
  test("reassigns positions 1..N in the requested order", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-20" });
    const firstStopId = await addVanSaleStop(adminToken, routeId);
    const secondStopId = await addVanSaleStop(adminToken, routeId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stopIds: [secondStopId, firstStopId] });

    expect(response.status).toBe(200);
    const byId = new Map(
      response.body.stops.map((stop: { id: string; position: number }) => [stop.id, stop.position]),
    );
    expect(byId.get(secondStopId)).toBe(1);
    expect(byId.get(firstStopId)).toBe(2);
  });

  test("rejects an incomplete list", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-21" });
    const firstStopId = await addVanSaleStop(adminToken, routeId);
    await addVanSaleStop(adminToken, routeId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stopIds: [firstStopId] });

    expect(response.status).toBe(400);
  });

  test("rejects a list with an id from another route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-22" });
    const stopId = await addVanSaleStop(adminToken, routeId);
    // A second real stop, so the submitted list's length matches the
    // route's real stop count — otherwise the length check below would
    // fire first and the "foreign id" branch this test targets would never
    // run.
    await addVanSaleStop(adminToken, routeId);
    const otherRouteId = await createRoute(adminToken, {
      driverId: otherDriverId,
      date: "2026-10-22",
    });
    const foreignStopId = await addVanSaleStop(adminToken, otherRouteId);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stopIds: [stopId, foreignStopId] });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain(foreignStopId);
  });

  test("refuses to reorder a FINISHED route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-23" });
    const stopId = await addVanSaleStop(adminToken, routeId);
    await startRoute(adminToken, routeId);
    // La parada se resuelve antes de terminar porque terminar lo exige; lo que
    // este test mira sigue siendo el reorden de una ruta ya cerrada.
    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Local cerrado" })
      .expect(200);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stopIds: [stopId] });

    expect(response.status).toBe(409);
  });
});

describe("DELETE /api/v1/routes/:id/stops/:stopId", () => {
  test("removes a pending stop and recompacts the positions of the rest", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-25" });
    const firstStopId = await addVanSaleStop(adminToken, routeId);
    const secondStopId = await addVanSaleStop(adminToken, routeId);
    const thirdStopId = await addVanSaleStop(adminToken, routeId);

    await request(server())
      .delete(`/api/v1/routes/${routeId}/stops/${firstStopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);

    const route = await request(server())
      .get(`/api/v1/routes/${routeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const positions = new Map(
      route.body.stops.map((stop: { id: string; position: number }) => [stop.id, stop.position]),
    );
    expect(positions.has(firstStopId)).toBe(false);
    expect(positions.get(secondStopId)).toBe(1);
    expect(positions.get(thirdStopId)).toBe(2);
  });

  // Sacar un pedido del camión tiene que devolverlo a la bandeja: si el
  // pedido quedara ocupado, no habría forma de reasignarlo a otra ruta.
  test("frees the order of an ORDER stop, so it can be assigned again", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-26" });
    const orderId = await createPendingOrder(adminToken);
    const stopResponse = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId })
      .expect(201);

    await request(server())
      .delete(`/api/v1/routes/${routeId}/stops/${stopResponse.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);

    const listed = await request(server())
      .get("/api/v1/orders?status=PENDING&hasRouteStop=false&limit=100")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(listed.body.data.map((order: { id: string }) => order.id)).toContain(orderId);

    const otherRouteId = await createRoute(adminToken, {
      driverId: otherDriverId,
      date: "2026-10-26",
    });
    await request(server())
      .post(`/api/v1/routes/${otherRouteId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId })
      .expect(201);
  });

  test("refuses to remove a stop that was already delivered", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(5, locId);
    const delivered = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    });
    expect(delivered.status).toBe(200);

    const response = await request(server())
      .delete(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain("pendiente");
  });

  test("an unknown stop id on a real route is 404", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-27" });

    const response = await request(server())
      .delete(`/api/v1/routes/${routeId}/stops/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  test("a driver cannot remove a stop from another driver's route", async () => {
    const routeId = await createRoute(adminToken, { date: "2026-10-28" });
    const stopId = await addVanSaleStop(adminToken, routeId);

    const response = await request(server())
      .delete(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${otherDriverToken}`);

    expect(response.status).toBe(403);
  });
});

describe("POST /api/v1/routes/:id/loads", () => {
  test("loads units, decrements availableQty atomically, and records a ROUTE_LOAD movement tagged with the route", async () => {
    const batchItemId = await createBatchItem(100);
    const routeId = await createRoute(adminToken, { date: nextDate() });

    const response = await addLoad(adminToken, routeId, batchItemId, 30);

    expect(response.status).toBe(201);
    expect(response.body.quantity).toBe(30);
    expect(response.body.batchItemId).toBe(batchItemId);
    expect(response.body.batchItem.containerType.id).toBe(containerTypeId);

    const batchItem = await prisma.batchItem.findUniqueOrThrow({ where: { id: batchItemId } });
    expect(batchItem.availableQty).toBe(70);

    const movement = await prisma.containerMovement.findFirstOrThrow({
      where: { routeId, type: ContainerMovementType.ROUTE_LOAD },
    });
    expect(movement.fromState).toBe(ContainerState.FULL_AT_PLANT);
    expect(movement.toState).toBe(ContainerState.FULL_ON_ROUTE);
    expect(movement.quantity).toBe(30);
    expect(movement.containerTypeId).toBe(containerTypeId);
  });

  test("loading the same batchItem twice on the same route sums via two rows, not a replace", async () => {
    const batchItemId = await createBatchItem(100);
    const routeId = await createRoute(adminToken, { date: nextDate() });

    await addLoad(adminToken, routeId, batchItemId, 20).then((r) => expect(r.status).toBe(201));
    await addLoad(adminToken, routeId, batchItemId, 15).then((r) => expect(r.status).toBe(201));

    const list = await request(server())
      .get(`/api/v1/routes/${routeId}/loads`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(2);
    const total = list.body.reduce(
      (sum: number, load: { quantity: number }) => sum + load.quantity,
      0,
    );
    expect(total).toBe(35);

    const batchItem = await prisma.batchItem.findUniqueOrThrow({ where: { id: batchItemId } });
    expect(batchItem.availableQty).toBe(65);
  });

  test("rejects insufficient stock with a clear message, leaving availableQty untouched", async () => {
    const batchItemId = await createBatchItem(10);
    const routeId = await createRoute(adminToken, { date: nextDate() });

    const response = await addLoad(adminToken, routeId, batchItemId, 20);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("insuficiente");

    const batchItem = await prisma.batchItem.findUniqueOrThrow({ where: { id: batchItemId } });
    expect(batchItem.availableQty).toBe(10);
  });

  /**
   * El FIFO se prueba sobre un tipo de envase propio: así ningún sobrante de
   * otro test puede ser la cabeza del FIFO y la aserción nombra exactamente
   * el lote que se espera. De paso deja demostrado que la regla se acota por
   * tipo de envase, no por toda la planta.
   */
  describe("FIFO: el lote más antiguo con stock", () => {
    let fifoSeq = 0;

    /**
     * Un tipo de envase nuevo por test, con dos lotes suyos: el sobrante de
     * un test hermano no puede convertirse en la cabeza del FIFO del
     * siguiente, y la aserción nombra exactamente el lote que se espera.
     */
    async function createFifoPair(): Promise<{ oldItemId: string; newItemId: string }> {
      fifoSeq += 1;
      const containerType = await request(server())
        .post("/api/v1/container-types")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: `Envase FIFO ${fifoSeq} (rutas)` })
        .expect(201);

      const batch = async (code: string, date: string) => {
        const response = await request(server())
          .post("/api/v1/production-batches")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            code,
            date,
            items: [{ containerTypeId: containerType.body.id, producedQty: 40 }],
          })
          .expect(201);
        return response.body.items[0].id as string;
      };

      return {
        oldItemId: await batch(`LOTE-FIFO-VIEJO-${fifoSeq}`, "2026-05-01"),
        newItemId: await batch(`LOTE-FIFO-NUEVO-${fifoSeq}`, "2026-05-02"),
      };
    }

    test("rechaza el lote nuevo mientras el viejo tenga unidades, y nombra cuál cargar", async () => {
      const { newItemId: newBatchItemId } = await createFifoPair();
      const routeId = await createRoute(adminToken, { date: nextDate() });

      const response = await addLoad(adminToken, routeId, newBatchItemId, 5);

      expect(response.status).toBe(400);
      expect(messagesOf(response)).toContain("LOTE-FIFO-VIEJO");

      // Nada se descontó: el guard corre antes del UPDATE.
      const untouched = await prisma.batchItem.findUniqueOrThrow({
        where: { id: newBatchItemId },
      });
      expect(untouched.availableQty).toBe(40);
    });

    test("acepta el lote nuevo recién cuando el viejo se quedó sin unidades", async () => {
      const { oldItemId, newItemId } = await createFifoPair();
      const routeId = await createRoute(adminToken, { date: nextDate() });

      await addLoad(adminToken, routeId, oldItemId, 40).then((r) => expect(r.status).toBe(201));
      const response = await addLoad(adminToken, routeId, newItemId, 10);

      expect(response.status).toBe(201);
      expect(response.body.batchItemId).toBe(newItemId);
    });

    test("los lotes viejos de OTRO tipo de envase no bloquean la carga", async () => {
      const { oldItemId } = await createFifoPair();
      const routeId = await createRoute(adminToken, { date: nextDate() });

      // El `containerTypeId` compartido del archivo arrastra sobrantes de
      // otros tests, más viejos que estos dos lotes: si el guard no se acotara
      // por tipo de envase, este 201 sería un 400.
      const response = await addLoad(adminToken, routeId, oldItemId, 5);

      expect(response.status).toBe(201);
    });
  });

  test("rejects an unknown batchItemId", async () => {
    const routeId = await createRoute(adminToken, { date: nextDate() });

    const response = await addLoad(adminToken, routeId, MISSING_UUID, 10);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain(MISSING_UUID);
  });

  test("refuses to load a FINISHED route", async () => {
    const batchItemId = await createBatchItem(100);
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await startRoute(adminToken, routeId);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const response = await addLoad(adminToken, routeId, batchItemId, 10);

    expect(response.status).toBe(409);
  });

  test("a driver cannot load the truck: cargo is office work", async () => {
    const batchItemId = await createBatchItem(100);
    const routeId = await createRoute(adminToken, { date: nextDate() });

    const response = await addLoad(driverToken, routeId, batchItemId, 10);

    expect(response.status).toBe(403);
  });

  test("two simultaneous routes loading the same containerType don't step on each other", async () => {
    const sharedBatchItemId = await createBatchItem(200);
    const routeADate = nextDate();
    const routeAId = await createRoute(adminToken, { date: routeADate });
    const routeBId = await createRoute(adminToken, { driverId: otherDriverId, date: routeADate });

    await addLoad(adminToken, routeAId, sharedBatchItemId, 50).then((r) =>
      expect(r.status).toBe(201),
    );
    await addLoad(adminToken, routeBId, sharedBatchItemId, 30).then((r) =>
      expect(r.status).toBe(201),
    );

    const loadsA = await request(server())
      .get(`/api/v1/routes/${routeAId}/loads`)
      .set("Authorization", `Bearer ${adminToken}`);
    const loadsB = await request(server())
      .get(`/api/v1/routes/${routeBId}/loads`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(loadsA.body).toHaveLength(1);
    expect(loadsA.body[0].quantity).toBe(50);
    expect(loadsB.body).toHaveLength(1);
    expect(loadsB.body[0].quantity).toBe(30);

    const movementsA = await prisma.containerMovement.findMany({
      where: { routeId: routeAId, type: ContainerMovementType.ROUTE_LOAD },
    });
    const movementsB = await prisma.containerMovement.findMany({
      where: { routeId: routeBId, type: ContainerMovementType.ROUTE_LOAD },
    });
    expect(movementsA).toHaveLength(1);
    expect(movementsA[0]?.quantity).toBe(50);
    expect(movementsB).toHaveLength(1);
    expect(movementsB[0]?.quantity).toBe(30);

    const batchItem = await prisma.batchItem.findUniqueOrThrow({
      where: { id: sharedBatchItemId },
    });
    expect(batchItem.availableQty).toBe(120);
  });

  test("real concurrency: two loads racing for the same stock — only one wins", async () => {
    const batchItemId = await createBatchItem(50);
    const routeId = await createRoute(adminToken, { date: nextDate() });

    const [first, second] = await Promise.all([
      addLoad(adminToken, routeId, batchItemId, 50),
      addLoad(adminToken, routeId, batchItemId, 50),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);

    const batchItem = await prisma.batchItem.findUniqueOrThrow({ where: { id: batchItemId } });
    expect(batchItem.availableQty).toBe(0);

    const loads = await prisma.routeLoad.findMany({ where: { routeId, batchItemId } });
    expect(loads).toHaveLength(1);
  });
});

describe("GET /api/v1/routes/:id/loads", () => {
  test("a driver can read their own route's loads", async () => {
    const batchItemId = await createBatchItem(100);
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await addLoad(adminToken, routeId, batchItemId, 10);

    const response = await request(server())
      .get(`/api/v1/routes/${routeId}/loads`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  test("a driver cannot read another driver's route's loads", async () => {
    const routeId = await createRoute(adminToken, { date: nextDate() });

    const response = await request(server())
      .get(`/api/v1/routes/${routeId}/loads`)
      .set("Authorization", `Bearer ${otherDriverToken}`);

    expect(response.status).toBe(403);
  });

  test("an unknown route id is rejected with 404", async () => {
    const response = await request(server())
      .get(`/api/v1/routes/${MISSING_UUID}/loads`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/v1/routes/:id/loads/:loadId", () => {
  test("deletes the load, returns the stock, and records the inverse FULL_RETURN movement", async () => {
    const batchItemId = await createBatchItem(100);
    const routeId = await createRoute(adminToken, { date: nextDate() });
    const created = await addLoad(adminToken, routeId, batchItemId, 40);
    const loadId = created.body.id;

    const response = await request(server())
      .delete(`/api/v1/routes/${routeId}/loads/${loadId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(204);

    const batchItem = await prisma.batchItem.findUniqueOrThrow({ where: { id: batchItemId } });
    expect(batchItem.availableQty).toBe(100);

    const reversal = await prisma.containerMovement.findFirstOrThrow({
      where: { routeId, type: ContainerMovementType.FULL_RETURN },
    });
    expect(reversal.fromState).toBe(ContainerState.FULL_ON_ROUTE);
    expect(reversal.toState).toBe(ContainerState.FULL_AT_PLANT);
    expect(reversal.quantity).toBe(40);

    // The original ROUTE_LOAD movement is never edited or deleted — only
    // the RouteLoad "currently loaded" row is removed.
    const original = await prisma.containerMovement.findFirstOrThrow({
      where: { routeId, type: ContainerMovementType.ROUTE_LOAD },
    });
    expect(original.quantity).toBe(40);

    const list = await request(server())
      .get(`/api/v1/routes/${routeId}/loads`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(0);
  });

  test("refuses to correct a load once the route is no longer PLANNED, leaving stock untouched", async () => {
    const batchItemId = await createBatchItem(100);
    const routeId = await createRoute(adminToken, { date: nextDate() });
    const created = await addLoad(adminToken, routeId, batchItemId, 40);
    const loadId = created.body.id;
    await startRoute(adminToken, routeId);

    const response = await request(server())
      .delete(`/api/v1/routes/${routeId}/loads/${loadId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);

    const batchItem = await prisma.batchItem.findUniqueOrThrow({ where: { id: batchItemId } });
    expect(batchItem.availableQty).toBe(60);
    const list = await request(server())
      .get(`/api/v1/routes/${routeId}/loads`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(1);
  });

  test("an unknown loadId is rejected with 404", async () => {
    const routeId = await createRoute(adminToken, { date: nextDate() });

    const response = await request(server())
      .delete(`/api/v1/routes/${routeId}/loads/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  test("a driver cannot delete a load", async () => {
    const batchItemId = await createBatchItem(100);
    const routeId = await createRoute(adminToken, { date: nextDate() });
    const created = await addLoad(adminToken, routeId, batchItemId, 10);

    const response = await request(server())
      .delete(`/api/v1/routes/${routeId}/loads/${created.body.id}`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(403);
  });
});

// HU-12 §2.4 E1 (canje 1:1) and E2 (deuda de envases — devolución parcial):
// "Dado una parada con 3 llenos a entregar, cuando registro 3 entregados y 3
// vacíos recogidos, entonces el saldo del cliente no varía" (E1); una
// devolución parcial deja el saldo a favor del envase (E2). HU-13 §2.4 E1
// (cobro): "Dado un total de S/ 40, cuando registro un pago de S/ 25,
// entonces se registra el abono y la deuda del cliente aumenta en S/ 15."
// The idempotency guard below (a stop already DELIVERED cannot be
// re-marked) is this PR's own addition, ahead of HU-16's sync-envelope
// idempotency (S7) — see the PR description for why this ships as a
// classic REST endpoint rather than through /sync/operations already.
describe("PATCH /api/v1/routes/:id/stops/:stopId — DELIVERED registers the delivery", () => {
  test("happy path: sale, LOAN_DELIVERY movement, cash payment CONFIRMED, debt reduced by the payment", async () => {
    const { customerId: custId, locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "37.50" },
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(StopStatus.DELIVERED);
    expect(response.body.sale).toMatchObject({ total: "37.50", creditLimitExceeded: false });
    expect(response.body.payment).toMatchObject({ status: "CONFIRMED", amount: "37.50" });

    // Cash fully covers the sale: 37.50 (sale) - 37.50 (confirmed payment) = 0.
    expect(await customerDebtBalance(custId)).toBe("0.00");
    expect(await containerBalance(locId)).toBe(3);

    const movement = await prisma.containerMovement.findFirstOrThrow({
      where: { stopId, type: ContainerMovementType.LOAN_DELIVERY },
    });
    expect(movement.fromState).toBe(ContainerState.FULL_ON_ROUTE);
    expect(movement.toState).toBe(ContainerState.WITH_CUSTOMER);
    expect(movement.quantity).toBe(3);
    expect(movement.routeId).toBe(routeId);

    const sale = await prisma.sale.findFirstOrThrow({ where: { stopId } });
    expect(sale.recordedById).toBeTruthy();
  });

  test("a Yape payment is born PENDING and does not reduce the customer's debt", async () => {
    const { customerId: custId, locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 2 }],
      payment: { paymentMethodId: yapePaymentMethodId, amount: "25.00" },
    });

    expect(response.status).toBe(200);
    expect(response.body.payment).toMatchObject({ status: "PENDING", amount: "25.00" });
    // Debt reflects the full sale — the PENDING payment has not been verified yet.
    expect(await customerDebtBalance(custId)).toBe("25.00");

    const payment = await prisma.payment.findFirstOrThrow({ where: { stopId } });
    expect(payment.confirmedAt).toBeNull();
    expect(payment.confirmedById).toBeNull();
  });

  test("a price override with no priceOverrideAuthorizedById is rejected, and nothing is recorded", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1, unitPrice: "15.00" }],
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("priceOverrideAuthorizedById");

    const stop = await prisma.routeStop.findUniqueOrThrow({ where: { id: stopId } });
    expect(stop.status).toBe(StopStatus.PENDING);
    const sale = await prisma.sale.findFirst({ where: { stopId } });
    expect(sale).toBeNull();
  });

  test("a price override WITH priceOverrideAuthorizedById is recorded at the charged price", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1, unitPrice: "15.00" }],
      priceOverrideAuthorizedById: adminUserId,
    });

    expect(response.status).toBe(200);
    expect(response.body.sale.total).toBe("15.00");
    const sale = await prisma.sale.findFirstOrThrow({ where: { stopId } });
    expect(sale.priceOverrideAuthorizedById).toBe(adminUserId);
  });

  test("a partial container return proceeds and reports the resulting balance", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
      containersReturned: [{ containerTypeId, quantity: 1 }],
    });

    expect(response.status).toBe(200);
    // Delivered 3 (balance +3), returned only 1 (balance -1) => net +2.
    expect(response.body.containerBalances).toEqual(
      expect.arrayContaining([expect.objectContaining({ containerTypeId, quantity: 2 })]),
    );
    expect(await containerBalance(locId)).toBe(2);

    const pickup = await prisma.containerMovement.findFirstOrThrow({
      where: { stopId, type: ContainerMovementType.EMPTY_PICKUP },
    });
    expect(pickup.fromState).toBe(ContainerState.WITH_CUSTOMER);
    expect(pickup.toState).toBe(ContainerState.EMPTY_ON_ROUTE);
    expect(pickup.quantity).toBe(1);
  });

  test("HU-12 E1: delivering 3 and getting 3 back (a 1:1 exchange) leaves the customer's container balance unchanged", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
      containersReturned: [{ containerTypeId, quantity: 3 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.containerBalances).toEqual(
      expect.arrayContaining([expect.objectContaining({ containerTypeId, quantity: 0 })]),
    );
    expect(await containerBalance(locId)).toBe(0);
  });

  test("insufficient stock on the truck blocks the delivery, naming how much there is and how much was requested", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(2, locId);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 5 }],
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("hay 2, se pidió 5");

    const stop = await prisma.routeStop.findUniqueOrThrow({ where: { id: stopId } });
    expect(stop.status).toBe(StopStatus.PENDING);
    expect(await prisma.sale.findFirst({ where: { stopId } })).toBeNull();
    expect(
      await prisma.containerMovement.findFirst({
        where: { stopId, type: ContainerMovementType.LOAN_DELIVERY },
      }),
    ).toBeNull();
  });

  test("double-marking the same stop is rejected, naming the date and who registered it", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    const items = [{ productId: refillProductId, quantity: 1 }];
    await deliverStop(adminToken, routeId, stopId, { items }).then((r) =>
      expect(r.status).toBe(200),
    );

    const response = await deliverStop(adminToken, routeId, stopId, { items });

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toMatch(/ya fue registrada/);
    // Exactly one sale/movement from the first call — the rejected retry left nothing.
    expect(await prisma.sale.count({ where: { stopId } })).toBe(1);
  });

  test("tras anular la entrega, el conflicto ya no cita una venta que no vale", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    const items = [{ productId: refillProductId, quantity: 1 }];
    await deliverStop(adminToken, routeId, stopId, { items }).then((r) =>
      expect(r.status).toBe(200),
    );
    const sales = ctx.app.get(SalesService);
    await prisma.$transaction((tx) =>
      sales.voidStopDeliveryWithinTransaction(tx, {
        stopId,
        voidedById: adminUserId,
        voidReason: "Se anotó la parada equivocada",
      }),
    );

    const response = await deliverStop(adminToken, routeId, stopId, { items });

    // Sigue siendo 409 —la parada quedó DELIVERED y devolverla a PENDING es
    // otro trabajo— pero el mensaje ya no puede nombrar la fecha ni el autor
    // de una entrega que se deshizo: eso mandaría a la oficina a buscar un
    // cobro que ya no existe. Cae al mensaje genérico de estado.
    expect(response.status).toBe(409);
    expect(messagesOf(response)).not.toMatch(/ya fue registrada/);
    expect(messagesOf(response)).toMatch(/ya está en estado DELIVERED/);
    // La venta sigue en la tabla, anulada: nada se borró.
    expect(await prisma.sale.count({ where: { stopId } })).toBe(1);
    expect(await prisma.sale.count({ where: { stopId, voidedAt: null } })).toBe(0);
  });

  test("real concurrency: two requests marking the same stop — exactly one wins, the loser leaves no trace", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    const items = [{ productId: refillProductId, quantity: 1 }];

    const [first, second] = await Promise.all([
      deliverStop(adminToken, routeId, stopId, { items }),
      deliverStop(adminToken, routeId, stopId, { items }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.sale.count({ where: { stopId } })).toBe(1);
    expect(
      await prisma.containerMovement.count({
        where: { stopId, type: ContainerMovementType.LOAN_DELIVERY },
      }),
    ).toBe(1);
  });

  test("refuses to deliver a stop on a route that already FINISHED", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    // La parada se marca FAILED antes de terminar —terminar exige resolverlas
    // todas— y el intento de entrega posterior sigue chocando con la guarda
    // que este test mira: la ruta ya no está en curso.
    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Local cerrado" })
      .expect(200);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    });

    expect(response.status).toBe(409);
    expect(await prisma.sale.findFirst({ where: { stopId } })).toBeNull();
  });

  test("a DRIVER cannot deliver a stop on another driver's route", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await deliverStop(otherDriverToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    });

    expect(response.status).toBe(403);
    expect(await prisma.sale.findFirst({ where: { stopId } })).toBeNull();
  });

  test("the assigned DRIVER can deliver their own route's stop", async () => {
    const { locationId: locId } = await createFreshLocation();
    const batchItemId = await createBatchItem(10);
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await addLoad(adminToken, routeId, batchItemId, 10).then((r) => expect(r.status).toBe(201));
    const stopResponse = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.VAN_SALE, locationId: locId })
      .expect(201);
    await startRoute(driverToken, routeId);

    const response = await deliverStop(driverToken, routeId, stopResponse.body.id, {
      items: [{ productId: refillProductId, quantity: 1 }],
    });

    expect(response.status).toBe(200);
  });

  test("flags creditLimitExceeded without blocking the sale", async () => {
    const customer = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Cliente Límite",
        phone: "986999999",
        address: "Av. Límite 1",
        addressReference: "Portón rojo",
        creditLimit: "10.00",
      })
      .expect(201);
    const location = await prisma.customerLocation.findFirstOrThrow({
      where: { customerId: customer.body.id },
    });
    const { routeId, stopId } = await routeInProgressWithStock(10, location.id);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 2 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.sale.creditLimitExceeded).toBe(true);
  });

  test("regression: a sale fully covered by a same-visit cash payment is NOT flagged as exceeding the credit limit", async () => {
    const customer = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Cliente Límite Cubierto",
        phone: "986999998",
        address: "Av. Límite 2",
        addressReference: "Portón azul",
        creditLimit: "10.00",
      })
      .expect(201);
    const location = await prisma.customerLocation.findFirstOrThrow({
      where: { customerId: customer.body.id },
    });
    const { routeId, stopId } = await routeInProgressWithStock(10, location.id);

    // Sale total (25.00) alone exceeds the 10.00 limit, but cash covers it
    // in full: no credit was ever extended, so this must NOT be flagged.
    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 2 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "25.00" },
    });

    expect(response.status).toBe(200);
    expect(response.body.sale.creditLimitExceeded).toBe(false);
    expect(await customerDebtBalance(customer.body.id)).toBe("0.00");
  });

  test("HU-13 E1: a partial cash payment (25 of 40) leaves exactly the residual (15) as the customer's debt", async () => {
    const { customerId: custId, locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1, unitPrice: "40.00" }],
      priceOverrideAuthorizedById: adminUserId,
      payment: { paymentMethodId: cashPaymentMethodId, amount: "25.00" },
    });

    expect(response.status).toBe(200);
    expect(response.body.sale.total).toBe("40.00");
    expect(await customerDebtBalance(custId)).toBe("15.00");
  });
});

describe("GET /api/v1/routes/:id?stopStatus filters the stops shown", () => {
  test("only PENDING stops come back when filtering by stopStatus=PENDING", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    const secondStopId = await addVanSaleStop(adminToken, routeId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));

    const response = await request(server())
      .get(`/api/v1/routes/${routeId}?stopStatus=PENDING`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.stops.map((stop: { id: string }) => stop.id)).toEqual([secondStopId]);
  });
});

describe("auth", () => {
  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/routes");

    expect(response.status).toBe(401);
  });
});

/*
 * HU-10 E1: el pedido sigue a su parada. Antes de esto `OrderStatus.ON_ROUTE`
 * y `FAILED` eran valores muertos del enum —no se escribían en ningún punto de
 * la API— y un pedido asignado a una parada seguía figurando como pendiente.
 *
 * Cada escritura del pedido va DENTRO de la transacción de la operación que la
 * causa; estos tests miran el resultado, y el de "cancelar un pedido asignado
 * devuelve 409" (en orders.int.test.ts) es el que fija el agujero que se cerró.
 */
describe("HU-10 E1: Order.status sigue a su parada", () => {
  async function plannedRouteWithOrder(): Promise<{
    routeId: string;
    stopId: string;
    orderId: string;
  }> {
    const routeId = await createRoute(adminToken, { date: nextDate() });
    const orderId = await createPendingOrder(adminToken);
    const response = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId })
      .expect(201);
    return { routeId, stopId: response.body.id, orderId };
  }

  async function orderStatus(id: string): Promise<string> {
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    return order.status;
  }

  test("asignar un pedido a una parada lo deja ON_ROUTE", async () => {
    const { orderId } = await plannedRouteWithOrder();

    expect(await orderStatus(orderId)).toBe(OrderStatus.ON_ROUTE);
  });

  test("GET /orders?status=ON_ROUTE devuelve el pedido asignado", async () => {
    const { orderId } = await plannedRouteWithOrder();

    const response = await request(server())
      .get("/api/v1/orders?status=ON_ROUTE")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data.map((order: { id: string }) => order.id)).toContain(orderId);
  });

  test("marcar la parada DELIVERED deja el pedido DELIVERED", async () => {
    const { routeId, stopId, orderId } = await plannedRouteWithOrder();
    const batchItemId = await createBatchItem(10);
    await addLoad(adminToken, routeId, batchItemId, 10).then((r) => expect(r.status).toBe(201));
    await startRoute(adminToken, routeId);

    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));

    expect(await orderStatus(orderId)).toBe(OrderStatus.DELIVERED);
  });

  // Nunca vuelve a PENDING: `deliveryDate` es una fecha de negocio, así que
  // reintentar mañana es otro pedido. Si volviera a PENDING, uno fallado tres
  // veces se vería idéntico a uno recién tomado.
  test("marcar la parada FAILED deja el pedido FAILED, no PENDING", async () => {
    const { routeId, stopId, orderId } = await plannedRouteWithOrder();
    await startRoute(adminToken, routeId);

    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Local cerrado" })
      .expect(200);

    expect(await orderStatus(orderId)).toBe(OrderStatus.FAILED);
  });

  test("quitar la parada devuelve el pedido a PENDING y se lo puede reasignar", async () => {
    const { routeId, stopId, orderId } = await plannedRouteWithOrder();

    await request(server())
      .delete(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);

    expect(await orderStatus(orderId)).toBe(OrderStatus.PENDING);

    // Lo que el docblock de removeStop promete: el pedido queda libre. Sin la
    // vuelta a PENDING, addStop lo rechazaría y quedaría inasignable.
    const otherRouteId = await createRoute(adminToken, { date: nextDate() });
    await request(server())
      .post(`/api/v1/routes/${otherRouteId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId })
      .expect(201);

    expect(await orderStatus(orderId)).toBe(OrderStatus.ON_ROUTE);
  });

  test("una parada VAN_SALE no toca ningún pedido en ninguna de las cuatro operaciones", async () => {
    const orderId = await createPendingOrder(adminToken);
    const { locationId: locId } = await createFreshLocation();

    // Agregar y quitar una parada de autoventa.
    const plannedRouteId = await createRoute(adminToken, { date: nextDate() });
    const vanStopId = await addVanSaleStop(adminToken, plannedRouteId);
    expect(await orderStatus(orderId)).toBe(OrderStatus.PENDING);
    await request(server())
      .delete(`/api/v1/routes/${plannedRouteId}/stops/${vanStopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
    expect(await orderStatus(orderId)).toBe(OrderStatus.PENDING);

    // Entregar una parada de autoventa.
    const delivered = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, delivered.routeId, delivered.stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));
    expect(await orderStatus(orderId)).toBe(OrderStatus.PENDING);

    // Fallar una parada de autoventa.
    const failed = await routeInProgressWithStock(10, locId);
    await request(server())
      .patch(`/api/v1/routes/${failed.routeId}/stops/${failed.stopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Nadie atendió" })
      .expect(200);
    expect(await orderStatus(orderId)).toBe(OrderStatus.PENDING);
  });
});
/*
 * Corregir una parada: anular lo anotado y volver a registrarlo como fue.
 * Nada se edita ni se borra (CLAUDE.md) — la venta anterior queda en la tabla
 * con su motivo de anulación y los envases vuelven con movimientos inversos.
 */
describe("PATCH /api/v1/routes/:id/stops/:stopId/correction", () => {
  const REASON = "El chofer dictó 3 y habían sido 2";

  async function correctStop(
    token: string,
    routeId: string,
    stopId: string,
    body: Record<string, unknown>,
  ): Promise<request.Test> {
    return request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}/correction`)
      .set("Authorization", `Bearer ${token}`)
      .send({ correctionReason: REASON, ...body });
  }

  /** La única venta que todavía vale para esa parada, o null si no hay. */
  async function liveSale(stopId: string) {
    return prisma.sale.findFirst({ where: { stopId, voidedAt: null } });
  }

  /**
   * La deuda que el estado de cuenta reconstruiría desde los libros: todo lo
   * vendido y no anulado, menos todo lo cobrado, confirmado y no anulado. Si
   * `customers.debt_balance` no coincide con esto, el saldo materializado dejó
   * de ser reconstruible desde su ledger, que es la invariante que sostiene
   * toda la plata del sistema (CLAUDE.md).
   */
  async function rebuiltDebt(custId: string): Promise<string> {
    const sales = await prisma.sale.aggregate({
      where: { voidedAt: null, location: { customerId: custId } },
      _sum: { total: true },
    });
    const payments = await prisma.payment.aggregate({
      where: {
        voidedAt: null,
        status: PaymentStatus.CONFIRMED,
        customerId: custId,
      },
      _sum: { amount: true },
    });
    const sold = sales._sum.total ?? new Prisma.Decimal(0);
    const collected = payments._sum.amount ?? new Prisma.Decimal(0);
    return sold.minus(collected).toFixed(2);
  }

  test("DELIVERED -> DELIVERED con otra cantidad: una sola venta vigente, la anterior anulada, y la deuda cuadra con los libros", async () => {
    const { customerId: custId, locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(200));
    const original = await liveSale(stopId);
    expect(original?.total.toFixed(2)).toBe("37.50");

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(StopStatus.DELIVERED);
    expect(response.body.sale.total).toBe("25.00");

    expect(await prisma.sale.count({ where: { stopId } })).toBe(2);
    const voided = await prisma.sale.findFirstOrThrow({
      where: { stopId, voidedAt: { not: null } },
    });
    expect(voided.id).toBe(original?.id);
    expect(voided.voidReason).toBe(REASON);
    expect(voided.voidedById).toBe(adminUserId);

    // La entrega corregida es la MISMA entrega: hereda el instante de la vieja.
    const corrected = await liveSale(stopId);
    expect(corrected?.soldAt.toISOString()).toBe(original?.soldAt.toISOString());
    expect(corrected?.total.toFixed(2)).toBe("25.00");

    expect(await customerDebtBalance(custId)).toBe("25.00");
    expect(await customerDebtBalance(custId)).toBe(await rebuiltDebt(custId));
    // 3 entregados, 3 devueltos por la anulación, 2 entregados de nuevo.
    expect(await containerBalance(locId)).toBe(2);

    const stop = await prisma.routeStop.findUniqueOrThrow({
      where: { id: stopId },
    });
    expect(stop.correctionReason).toBe(REASON);
    expect(stop.correctedById).toBe(adminUserId);
    expect(stop.correctedAt).toBeInstanceOf(Date);
  });

  test("el cuerpo describe la parada entera: repetir el cobro y los vacíos los vuelve a registrar; omitirlos los borra", async () => {
    const { customerId: custId, locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(20, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
      containersReturned: [{ containerTypeId, quantity: 1 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "37.50" },
    }).then((r) => expect(r.status).toBe(200));
    expect(await customerDebtBalance(custId)).toBe("0.00");

    // Corrección que repite todo lo que sigue valiendo: 2 en vez de 3, mismo
    // vacío devuelto, cobro por el nuevo total.
    const restated = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
      containersReturned: [{ containerTypeId, quantity: 1 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "25.00" },
    });

    expect(restated.status).toBe(200);
    expect(restated.body.payment).toMatchObject({ status: "CONFIRMED", amount: "25.00" });
    expect(await customerDebtBalance(custId)).toBe("0.00");
    expect(await customerDebtBalance(custId)).toBe(await rebuiltDebt(custId));
    // 2 entregados menos 1 devuelto.
    expect(await containerBalance(locId)).toBe(1);

    // Y la otra mitad de la regla: una corrección que NO repite el cobro ni
    // los vacíos no los vuelve a registrar. Es reemplazo, no parche — quien
    // llama tiene que mandar la parada entera.
    const partial = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    });

    expect(partial.status).toBe(200);
    expect(partial.body.payment).toBeNull();
    expect(await customerDebtBalance(custId)).toBe("25.00");
    expect(await customerDebtBalance(custId)).toBe(await rebuiltDebt(custId));
    expect(await containerBalance(locId)).toBe(2);
  });

  test("un motivo de corrección de solo espacios es 400, y no toca nada", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
      correctionReason: "   ",
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toMatch(/motivo de la corrección/);
    expect(await prisma.sale.count({ where: { stopId } })).toBe(1);
  });

  test("DELIVERED -> FAILED: no queda venta vigente y el pedido pasa a FAILED", async () => {
    const { customerId: custId, locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "37.50" },
    }).then((r) => expect(r.status).toBe(200));

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.FAILED,
      failureReason: "El cliente no estaba y no se entregó nada",
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(StopStatus.FAILED);
    expect(response.body.failureReason).toBe("El cliente no estaba y no se entregó nada");
    expect(await liveSale(stopId)).toBeNull();
    // La deuda y los envases vuelven a cero: no hubo entrega ni cobro.
    expect(await customerDebtBalance(custId)).toBe("0.00");
    expect(await customerDebtBalance(custId)).toBe(await rebuiltDebt(custId));
    expect(await containerBalance(locId)).toBe(0);
  });

  test("FAILED -> DELIVERED: la venta nueva se fecha al mediodía de Lima del día de la ruta y conserva el motivo de falla original", async () => {
    const batchItemId = await createBatchItem(10);
    // Una fecha PASADA y propia de este test, no `nextDate()`: el mediodía de
    // Lima de un día futuro se acota a "ahora" y quedaría indistinguible de
    // fechar la venta hoy, que es justo el error que este test tiene que ver.
    const routeDate = "2026-07-15";
    const routeId = await createRoute(adminToken, { date: routeDate });
    await addLoad(adminToken, routeId, batchItemId, 10).then((r) => expect(r.status).toBe(201));
    const stopId = await addVanSaleStop(adminToken, routeId);
    await startRoute(adminToken, routeId);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Nadie atendió" })
      .expect(200);

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(StopStatus.DELIVERED);

    // Sin venta anterior de la cual heredar el instante, la venta nace al
    // mediodía de Lima del día de la ruta — 17:00 UTC, porque Lima es UTC-5
    // todo el año. Exacto, no aproximado: fecharla hoy sería contar una
    // entrega de julio en el día en que alguien la corrigió.
    const sale = await prisma.sale.findFirstOrThrow({
      where: { stopId, voidedAt: null },
    });
    expect(sale.soldAt.toISOString()).toBe(`${routeDate}T17:00:00.000Z`);
    // Y los movimientos de envases van al mismo instante, no a hoy.
    const movement = await prisma.containerMovement.findFirstOrThrow({
      where: { stopId, type: ContainerMovementType.LOAN_DELIVERY },
    });
    expect(movement.occurredAt.toISOString()).toBe(`${routeDate}T17:00:00.000Z`);

    // El motivo de falla original NO se limpia: es la evidencia de que hubo un
    // error de anotación, y borrarlo la destruiría.
    const stop = await prisma.routeStop.findUniqueOrThrow({
      where: { id: stopId },
    });
    expect(stop.failureReason).toBe("Nadie atendió");
    expect(stop.correctionReason).toBe(REASON);
  });

  test("FAILED -> DELIVERED sobre una ruta cuyo mediodía todavía no llegó: se acota a ahora en vez de mandar una fecha futura", async () => {
    const batchItemId = await createBatchItem(10);
    // `nextDate()` siempre devuelve un día muy posterior a hoy, así que su
    // mediodía de Lima es futuro. Sin el acotado, `ContainerMovementsService`
    // rechazaría el movimiento con "La fecha del movimiento no puede ser
    // futura" y la corrección se caería con un 400 que no tiene nada que ver
    // con lo que el usuario hizo.
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await addLoad(adminToken, routeId, batchItemId, 10).then((r) => expect(r.status).toBe(201));
    const stopId = await addVanSaleStop(adminToken, routeId);
    await startRoute(adminToken, routeId);
    await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: StopStatus.FAILED, failureReason: "Nadie atendió" })
      .expect(200);

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 1 }],
    });

    expect(response.status).toBe(200);
    const sale = await prisma.sale.findFirstOrThrow({
      where: { stopId, voidedAt: null },
    });
    expect(sale.soldAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("una ruta ya liquidada se corrige igual: la liquidación queda desactualizada, no bloquea", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(200));
    await request(server())
      .patch(`/api/v1/routes/${routeId}/finish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    await request(server())
      .post(`/api/v1/routes/${routeId}/settlement`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fullReturned: 7, emptiesCollected: [] })
      .expect(201);
    expect((await prisma.route.findUniqueOrThrow({ where: { id: routeId } })).status).toBe(
      RouteStatus.SETTLED,
    );

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.sale.total).toBe("25.00");
  });

  test("una ruta PLANNED no tiene nada registrado que corregir: 409", async () => {
    const routeId = await createRoute(adminToken, { date: nextDate() });
    const stopId = await addVanSaleStop(adminToken, routeId);

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 1 }],
    });

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toMatch(/no hay nada que corregir/);
  });

  test("una parada todavía PENDING se marca, no se corrige: 409", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 1 }],
    });

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toMatch(/todavía no se registró/);
    expect(await prisma.sale.count({ where: { stopId } })).toBe(0);
  });

  test("una parada que no es de esta ruta es 404, no 409", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId } = await routeInProgressWithStock(10, locId);

    const response = await correctStop(adminToken, routeId, MISSING_UUID, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 1 }],
    });

    expect(response.status).toBe(404);
  });

  test("corregir es del ADMIN: un SELLER y un DRIVER reciben 403", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));
    const body = {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    };

    expect((await correctStop(sellerToken, routeId, stopId, body)).status).toBe(403);
    expect((await correctStop(driverToken, routeId, stopId, body)).status).toBe(403);
    // Nada se tocó: sigue habiendo una sola venta, la original.
    expect(await prisma.sale.count({ where: { stopId } })).toBe(1);
  });

  test("corregir al alza sobre un camión sin stock avisa y registra: 200 con stockShortfall, no 400", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(3, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(200));

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 5 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.stockShortfall).toEqual([
      expect.objectContaining({ containerTypeId, available: 3, requested: 5 }),
    ]);
    expect((await liveSale(stopId))?.total.toFixed(2)).toBe("62.50");
    expect(await containerBalance(locId)).toBe(5);
  });

  test("el cuerpo no puede traer priceOverrideAuthorizedById: lo pone quien corrige", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));

    const response = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
      priceOverrideAuthorizedById: adminUserId,
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("priceOverrideAuthorizedById");

    // Y sin mandarlo queda igual asentado quien corrigió, que es la decisión
    // de dominio: el ADMIN que corrige es quien autoriza el precio.
    const ok = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    });
    expect(ok.status).toBe(200);
    expect((await liveSale(stopId))?.priceOverrideAuthorizedById).toBe(adminUserId);
  });

  test("dos correcciones seguidas: una sola venta vigente, dos anuladas y las columnas con los datos de la segunda", async () => {
    const { customerId: custId, locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(20, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(200));

    await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    }).then((r) => expect(r.status).toBe(200));
    const second = await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 4 }],
      correctionReason: "Al final habían sido 4",
    });

    expect(second.status).toBe(200);
    expect(await prisma.sale.count({ where: { stopId } })).toBe(3);
    expect(await prisma.sale.count({ where: { stopId, voidedAt: null } })).toBe(1);
    expect((await liveSale(stopId))?.total.toFixed(2)).toBe("50.00");
    expect(await customerDebtBalance(custId)).toBe("50.00");
    expect(await customerDebtBalance(custId)).toBe(await rebuiltDebt(custId));
    expect(await containerBalance(locId)).toBe(4);

    // Las tres columnas guardan SOLO la última corrección, a propósito: la
    // historia entera vive en las dos ventas anuladas y en el libro.
    const stop = await prisma.routeStop.findUniqueOrThrow({
      where: { id: stopId },
    });
    expect(stop.correctionReason).toBe("Al final habían sido 4");
  });

  test("el pedido de una parada de pedido sigue a su corrección, y nunca vuelve a PENDING", async () => {
    const batchItemId = await createBatchItem(10);
    const routeId = await createRoute(adminToken, { date: nextDate() });
    await addLoad(adminToken, routeId, batchItemId, 10).then((r) => expect(r.status).toBe(201));
    const orderId = await createPendingOrder(adminToken);
    const stopResponse = await request(server())
      .post(`/api/v1/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ origin: StopOrigin.ORDER, orderId })
      .expect(201);
    const stopId = stopResponse.body.id as string;
    await startRoute(adminToken, routeId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 2 }],
    }).then((r) => expect(r.status).toBe(200));

    await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.FAILED,
      failureReason: "No se entregó nada",
    }).then((r) => expect(r.status).toBe(200));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.FAILED,
    );

    await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    }).then((r) => expect(r.status).toBe(200));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.DELIVERED,
    );
  });

  /**
   * La parada queda con DOS ventas y DOS cobros en la tabla —el par anulado y
   * el par vigente, con montos distintos— así que el detalle sólo puede
   * mostrar el monto correcto si el include filtra de verdad por
   * `voidedAt: null`. Con una sola venta el test pasaría sin filtro.
   */
  test("el detalle de la ruta muestra la venta y el cobro VIGENTES, y quién corrigió la parada", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "37.50" },
    }).then((r) => expect(r.status).toBe(200));

    await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "25.00" },
    }).then((r) => expect(r.status).toBe(200));

    expect(await prisma.sale.count({ where: { stopId } })).toBe(2);
    expect(await prisma.payment.count({ where: { stopId } })).toBe(2);

    const detail = await request(server())
      .get(`/api/v1/routes/${routeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const stop = (detail.body.stops as Record<string, unknown>[]).find(
      (candidate) => candidate.id === stopId,
    );
    expect((stop?.sale as { total: string }).total).toBe("25.00");
    expect((stop?.payment as { amount: string }).amount).toBe("25.00");
    expect(stop?.correction).toMatchObject({
      correctedBy: { id: adminUserId, name: expect.any(String) as unknown },
      correctionReason: REASON,
    });
    // Los saldos de envases y el faltante de stock son de la escritura, no de
    // una lectura: leer la ruta no los recalcula.
    expect(stop?.containerBalances).toBeUndefined();
    expect(stop?.stockShortfall).toBeUndefined();
  });

  // El listado paga 20 rutas por página: la venta se queda en el detalle. Lo
  // que sí viaja es la corrección, que es un join chico.
  test("el listado de rutas no trae la venta de cada parada, pero sí dice que se corrigió", async () => {
    const { locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(200));
    await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    }).then((r) => expect(r.status).toBe(200));

    const list = await request(server())
      .get(`/api/v1/routes?page=1&limit=20`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const route = (list.body.data as { id: string; stops: Record<string, unknown>[] }[]).find(
      (candidate) => candidate.id === routeId,
    );
    const stop = route?.stops.find((candidate) => candidate.id === stopId);
    expect(stop?.sale).toBeUndefined();
    expect(stop?.payment).toBeUndefined();
    expect(stop?.correction).toMatchObject({ correctionReason: REASON });
  });

  // Anular un cobro no lo esconde de la bandeja: aparece con su monto original
  // y su `voidedAt`, para que la oficina lo vea tachado en vez de buscarlo sin
  // encontrarlo y registrarlo otra vez.
  test("el cobro anulado por una corrección sigue apareciendo en la bandeja de cobros", async () => {
    const { customerId: custId, locationId: locId } = await createFreshLocation();
    const { routeId, stopId } = await routeInProgressWithStock(10, locId);
    await deliverStop(adminToken, routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "37.50" },
    }).then((r) => expect(r.status).toBe(200));

    await correctStop(adminToken, routeId, stopId, {
      status: StopStatus.DELIVERED,
      items: [{ productId: refillProductId, quantity: 2 }],
    }).then((r) => expect(r.status).toBe(200));

    const tray = await request(server())
      .get(`/api/v1/payments?page=1&limit=20&customerId=${custId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const rows = tray.body.data as { id: string; amount: string; voidedAt: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe("37.50");
    expect(rows[0]?.voidedAt).not.toBeNull();
    expect(tray.body.totals).toMatchObject({ count: 1, amount: "37.50" });
  });
});
