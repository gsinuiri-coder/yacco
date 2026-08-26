import request from "supertest";
import {
  ContainerMovementType,
  ContainerState,
  RouteStatus,
  StopOrigin,
  StopStatus,
} from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";
const ROUTE_DATE = "2026-08-25";

// One route per driver per day, so tests that need several fresh routes for
// the same driver each need a distinct date — sequential days starting well
// past every fixed date literal used elsewhere in this file.
let nextDay = 1;
function nextDate(): string {
  return `2026-11-${String(nextDay++).padStart(2, "0")}`;
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
/** A fresh ProductionBatch with one item, so each test controls its own stock. */
async function createBatchItem(producedQty: number): Promise<string> {
  batchCounter += 1;
  const response = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      code: `LOTE-RUTAS-${batchCounter}`,
      date: "2026-08-01",
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
  async function inProgressRouteWithStop(): Promise<{ routeId: string; stopId: string }> {
    const routeId = await createRoute(adminToken, { date: nextDate() });
    const stopId = await addVanSaleStop(adminToken, routeId);
    await startRoute(adminToken, routeId);
    return { routeId, stopId };
  }

  test("marks a stop DELIVERED", async () => {
    const { routeId, stopId } = await inProgressRouteWithStop();

    const response = await request(server())
      .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ status: StopStatus.DELIVERED });

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
      .send({ status: StopStatus.DELIVERED })
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
      .send({ status: StopStatus.DELIVERED });

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

describe("auth", () => {
  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/routes");

    expect(response.status).toBe(401);
  });
});
