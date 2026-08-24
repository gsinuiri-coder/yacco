import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let containerTypeId: string;
let locationId: string;

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

async function createUserAndLogin(username: string, role: string): Promise<string> {
  const password = `${username}-password`;
  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: username, username, password, roles: [role] })
    .expect(201);
  return login(username, password);
}

function messagesOf(response: { body: { message?: string | string[] } }): string {
  const { message } = response.body;
  return Array.isArray(message) ? message.join(" | ") : (message ?? "");
}

function createCount(token: string, overrides: Record<string, unknown> = {}) {
  return request(server())
    .post("/api/v1/container-counts")
    .set("Authorization", `Bearer ${token}`)
    .send({ locationId, containerTypeId, countedQuantity: 0, ...overrides });
}

function createMovement(token: string, overrides: Record<string, unknown> = {}) {
  return request(server())
    .post("/api/v1/container-movements")
    .set("Authorization", `Bearer ${token}`)
    .send({ containerTypeId, quantity: 1, ...overrides });
}

async function balanceOf(): Promise<number> {
  const prisma = ctx.app.get(PrismaService);
  const balance = await prisma.customerContainerBalance.findUnique({
    where: { locationId_containerTypeId: { locationId, containerTypeId } },
  });
  return balance?.quantity ?? 0;
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-conteos", "SELLER");
  driverToken = await createUserAndLogin("repartidor-conteos", "DRIVER");

  const prisma = ctx.app.get(PrismaService);
  const containerTypes = await prisma.containerType.findMany({ orderBy: { name: "asc" } });
  containerTypeId = containerTypes[0]!.id;

  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega Libro de Conteos",
      phone: "987654322",
      address: "Av. Los Alamos 453",
      addressReference: "Portón verde",
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id, isPrimary: true },
  });
  locationId = location.id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

// Belt and suspenders on top of each test's own scenario: a failed
// assertion earlier in the suite must never leave rows that skew a later
// test's expected balance or delta.
afterEach(async () => {
  const prisma = ctx.app.get(PrismaService);
  await prisma.containerCount.deleteMany({ where: { locationId } });
  await prisma.containerMovement.deleteMany({ where: { locationId } });
  await prisma.customerContainerBalance.deleteMany({ where: { locationId } });
});

describe("POST /api/v1/container-counts", () => {
  test("a positive delta emits COUNT_ADJUSTMENT into WITH_CUSTOMER and the balance ends at countedQuantity", async () => {
    const response = await createCount(adminToken, { countedQuantity: 7 }).expect(201);

    expect(response.body).toMatchObject({
      countedQuantity: 7,
      expectedQuantity: 0,
      locationId,
      containerTypeId,
    });
    expect(response.body.adjustmentId).not.toBeNull();
    expect(await balanceOf()).toBe(7);

    const movement = await ctx.app.get(PrismaService).containerMovement.findUnique({
      where: { id: response.body.adjustmentId },
    });
    expect(movement).toMatchObject({
      type: "COUNT_ADJUSTMENT",
      fromState: null,
      toState: "WITH_CUSTOMER",
      quantity: 7,
    });
  });

  test("a negative delta emits COUNT_ADJUSTMENT out of WITH_CUSTOMER and the balance ends at countedQuantity", async () => {
    await createMovement(adminToken, {
      type: "LOAN_DELIVERY",
      fromState: "FULL_ON_ROUTE",
      toState: "WITH_CUSTOMER",
      locationId,
      quantity: 10,
    }).expect(201);
    expect(await balanceOf()).toBe(10);

    const response = await createCount(adminToken, { countedQuantity: 4 }).expect(201);

    expect(response.body).toMatchObject({ countedQuantity: 4, expectedQuantity: 10 });
    expect(response.body.adjustmentId).not.toBeNull();
    expect(await balanceOf()).toBe(4);

    const movement = await ctx.app.get(PrismaService).containerMovement.findUnique({
      where: { id: response.body.adjustmentId },
    });
    expect(movement).toMatchObject({
      type: "COUNT_ADJUSTMENT",
      fromState: "WITH_CUSTOMER",
      toState: null,
      quantity: 6,
    });
  });

  test("a zero delta records the count with no adjustment and leaves the balance unchanged", async () => {
    await createMovement(adminToken, {
      type: "LOAN_DELIVERY",
      fromState: "FULL_ON_ROUTE",
      toState: "WITH_CUSTOMER",
      locationId,
      quantity: 5,
    }).expect(201);

    const response = await createCount(adminToken, { countedQuantity: 5 }).expect(201);

    expect(response.body).toMatchObject({
      countedQuantity: 5,
      expectedQuantity: 5,
      adjustmentId: null,
    });
    expect(await balanceOf()).toBe(5);

    const prisma = ctx.app.get(PrismaService);
    const adjustments = await prisma.containerMovement.findMany({
      where: { locationId, type: "COUNT_ADJUSTMENT" },
    });
    expect(adjustments).toHaveLength(0);
  });

  test("rejects an unknown container type", async () => {
    const response = await createCount(adminToken, {
      containerTypeId: MISSING_UUID,
      countedQuantity: 5,
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no existe");
  });

  test("rejects an unknown location", async () => {
    const response = await createCount(adminToken, {
      locationId: MISSING_UUID,
      countedQuantity: 5,
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no existe");
  });

  test("rejects a negative countedQuantity", async () => {
    const response = await createCount(adminToken, { countedQuantity: -1 });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/v1/container-movements — COUNT_ADJUSTMENT stays internal", () => {
  test("rejects COUNT_ADJUSTMENT on the public route", async () => {
    const response = await createMovement(adminToken, {
      type: "COUNT_ADJUSTMENT",
      toState: "WITH_CUSTOMER",
      locationId,
    });

    expect(response.status).toBe(400);
  });
});

describe("role guard", () => {
  test("SELLER can register a count", async () => {
    await createCount(sellerToken, { countedQuantity: 2 }).expect(201);
  });

  test("DRIVER is refused", async () => {
    const response = await createCount(driverToken, { countedQuantity: 2 });
    expect(response.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server())
      .post("/api/v1/container-counts")
      .send({ locationId, containerTypeId, countedQuantity: 2 });

    expect(response.status).toBe(401);
  });
});
