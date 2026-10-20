import { randomUUID } from "node:crypto";
import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MINUTE_MS = 60 * 1000;

let nextDayOffset = 0;
function nextDate(): string {
  const date = new Date(Date.UTC(2026, 11, 1) + nextDayOffset * 24 * 60 * 60 * 1000);
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
let firstVehicleId: string;
let secondVehicleId: string;
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
    .send({ name: `Nombre ${username}`, username, password, roles: [role] })
    .expect(201);
  return { token: await login(username, password), id: created.body.id };
}

async function createRoute(routeDriverId: string): Promise<string> {
  const response = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ driverId: routeDriverId, date: nextDate(), vehicleId: firstVehicleId })
    .expect(201);
  return response.body.id;
}

async function startRoute(routeId: string): Promise<void> {
  await request(server())
    .patch(`/api/v1/routes/${routeId}/start`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
}

async function finishRoute(routeId: string): Promise<void> {
  await request(server())
    .patch(`/api/v1/routes/${routeId}/finish`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
}

function point(recordedAt: Date, clientPointId = randomUUID()) {
  return {
    clientPointId,
    latitude: "-12.046374",
    longitude: "-77.042793",
    accuracyM: "12.50",
    recordedAt: recordedAt.toISOString(),
  };
}

function sendPoints(routeId: string, token: string, points: ReturnType<typeof point>[]) {
  return request(server())
    .post(`/api/v1/routes/${routeId}/location-points`)
    .set("Authorization", `Bearer ${token}`)
    .send({ points });
}

describe("Route location points (integration)", () => {
  beforeAll(async () => {
    ctx = await startTestApp();
    prisma = ctx.app.get(PrismaService);
    adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    sellerToken = (await createUserAndLogin("vendedor-mapa", "SELLER")).token;
    const driver = await createUserAndLogin("chofer-mapa", "DRIVER");
    driverToken = driver.token;
    driverId = driver.id;
    const otherDriver = await createUserAndLogin("otro-chofer-mapa", "DRIVER");
    otherDriverToken = otherDriver.token;
    otherDriverId = otherDriver.id;

    const adminUser = await prisma.user.findFirstOrThrow({ where: { username: ADMIN_USERNAME } });
    const vehicleData = { brand: "Toyota", model: "Dyna", createdById: adminUser.id };
    firstVehicleId = (
      await prisma.vehicle.create({ data: { ...vehicleData, plate: "MAP101", name: "Primero" } })
    ).id;
    containerTypeId = (
      await request(server())
        .post("/api/v1/container-types")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Bidón Mapa" })
        .expect(201)
    ).body.id;
    secondVehicleId = (
      await prisma.vehicle.create({ data: { ...vehicleData, plate: "MAP202", name: "Segundo" } })
    ).id;
  }, 180000);

  afterAll(async () => {
    await stopTestApp(ctx);
  });

  it("tells every role that uses it how often to send the location", async () => {
    const response = await request(server())
      .get("/api/v1/settings/location-tracking")
      .set("Authorization", `Bearer ${driverToken}`)
      .expect(200);

    expect(response.body).toEqual({ intervalSeconds: 300 });
  });

  it("HU-27 E2: stores a batch of three with one repeated as two points", async () => {
    const routeId = await createRoute(driverId);
    await startRoute(routeId);
    const repeated = point(new Date(), randomUUID());

    const response = await sendPoints(routeId, driverToken, [
      repeated,
      point(new Date()),
      repeated,
    ]).expect(201);

    expect(response.body).toEqual({ received: 3, stored: 2 });
    expect(await prisma.routeLocationPoint.count({ where: { routeId } })).toBe(2);

    const resent = await sendPoints(routeId, driverToken, [repeated]).expect(201);
    expect(resent.body).toEqual({ received: 1, stored: 0 });
    expect(await prisma.routeLocationPoint.count({ where: { routeId } })).toBe(2);
  });

  it("HU-27 E3: rejects points for a planned route and for a finished one", async () => {
    const plannedRouteId = await createRoute(driverId);
    await sendPoints(plannedRouteId, driverToken, [point(new Date())]).expect(409);

    const finishedRouteId = await createRoute(driverId);
    await startRoute(finishedRouteId);
    await finishRoute(finishedRouteId);
    await sendPoints(finishedRouteId, driverToken, [point(new Date())]).expect(409);

    expect(
      await prisma.routeLocationPoint.count({
        where: { routeId: { in: [plannedRouteId, finishedRouteId] } },
      }),
    ).toBe(0);
  });

  it("HU-27 E3: rejects a driver sending points for another driver's route, and the office too", async () => {
    const routeId = await createRoute(otherDriverId);
    await startRoute(routeId);

    await sendPoints(routeId, driverToken, [point(new Date())]).expect(403);
    await sendPoints(routeId, adminToken, [point(new Date())]).expect(403);

    expect(await prisma.routeLocationPoint.count({ where: { routeId } })).toBe(0);
  });

  it("HU-27 E2: records the route's current vehicle, also after a change in a pit", async () => {
    const routeId = await createRoute(driverId);
    await startRoute(routeId);
    const before = point(new Date(Date.now() - 10 * MINUTE_MS));
    await sendPoints(routeId, driverToken, [before]).expect(201);

    await request(server())
      .post(`/api/v1/routes/${routeId}/pit-stops`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        counts: [{ containerTypeId, countedFull: 0, countedEmpty: 0 }],
        vehicleId: secondVehicleId,
        vehicleReason: "Se bajó una llanta",
      })
      .expect(201);
    const after = point(new Date());
    await sendPoints(routeId, driverToken, [after]).expect(201);

    const stored = await prisma.routeLocationPoint.findMany({
      where: { routeId },
      orderBy: { recordedAt: "asc" },
    });
    expect(stored.map((row) => [row.clientPointId, row.vehicleId, row.driverId])).toEqual([
      [before.clientPointId, firstVehicleId, driverId],
      [after.clientPointId, secondVehicleId, driverId],
    ]);

    const track = await request(server())
      .get(`/api/v1/routes/${routeId}/location-points`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
    expect(track.body.map((row: { vehiclePlate: string }) => row.vehiclePlate)).toEqual([
      "MAP101",
      "MAP202",
    ]);
  });

  it("HU-27 E4: returns the last point of each route in progress and marks only the stale one", async () => {
    const freshRouteId = await createRoute(driverId);
    await startRoute(freshRouteId);
    const staleRouteId = await createRoute(otherDriverId);
    await startRoute(staleRouteId);

    const older = point(new Date(Date.now() - 8 * MINUTE_MS));
    const fresh = point(new Date(Date.now() - 3 * MINUTE_MS));
    await sendPoints(freshRouteId, driverToken, [fresh, older]).expect(201);
    const stale = point(new Date(Date.now() - 20 * MINUTE_MS));
    await sendPoints(staleRouteId, otherDriverToken, [stale]).expect(201);
    const finishedRouteId = await createRoute(driverId);
    await startRoute(finishedRouteId);
    await sendPoints(finishedRouteId, driverToken, [point(new Date())]).expect(201);
    await finishRoute(finishedRouteId);

    const response = await request(server())
      .get("/api/v1/route-locations/latest")
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);

    const byRoute = new Map(
      response.body.routes.map((row: { routeId: string }) => [row.routeId, row]),
    );
    expect(byRoute.has(finishedRouteId)).toBe(false);
    expect(byRoute.get(freshRouteId)).toMatchObject({
      driverName: "Nombre chofer-mapa",
      vehiclePlate: "MAP101",
      noSignal: false,
      lastPoint: { recordedAt: fresh.recordedAt, latitude: "-12.046374" },
    });
    expect(byRoute.get(staleRouteId)).toMatchObject({
      driverName: "Nombre otro-chofer-mapa",
      noSignal: true,
      lastPoint: { recordedAt: stale.recordedAt },
    });
  });

  it("keeps the map and the track away from drivers", async () => {
    await request(server())
      .get("/api/v1/route-locations/latest")
      .set("Authorization", `Bearer ${driverToken}`)
      .expect(403);
  });
});
