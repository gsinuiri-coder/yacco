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
let otherContainerTypeId: string;
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

/**
 * Flattens the error payload so a test can assert *why* a request was
 * rejected. Nest sends an array of strings for validation failures and a
 * single string for the exceptions the service throws.
 */
function messagesOf(response: { body: { message?: string | string[] } }): string {
  const { message } = response.body;
  return Array.isArray(message) ? message.join(" | ") : (message ?? "");
}

function createMovement(token: string, overrides: Record<string, unknown> = {}) {
  return request(server())
    .post("/api/v1/container-movements")
    .set("Authorization", `Bearer ${token}`)
    .send({ containerTypeId, quantity: 1, ...overrides });
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-envases", "SELLER");
  driverToken = await createUserAndLogin("repartidor-envases", "DRIVER");

  const prisma = ctx.app.get(PrismaService);
  const containerTypes = await prisma.containerType.findMany({ orderBy: { name: "asc" } });
  containerTypeId = containerTypes[0]!.id;
  otherContainerTypeId = containerTypes[1]!.id;

  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega Libro de Envases",
      phone: "987654321",
      address: "Av. Los Alamos 452",
      addressReference: "Portón azul",
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

// Belt and suspenders on top of each test's own cleanup: a failed assertion
// earlier in the suite must never leave rows that skew the invariant test's
// arithmetic for a later test in this same file.
afterEach(async () => {
  const prisma = ctx.app.get(PrismaService);
  await prisma.containerMovement.deleteMany({ where: { containerTypeId } });
  await prisma.customerContainerBalance.deleteMany({ where: { locationId } });
});

describe("POST /api/v1/container-movements — the transition matrix", () => {
  test("FLEET_ENTRY: no origin, lands EMPTY_AT_PLANT", async () => {
    const response = await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
      quantity: 20,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      type: "FLEET_ENTRY",
      fromState: null,
      toState: "EMPTY_AT_PLANT",
      quantity: 20,
    });
  });

  test("rejects a pair the type does not allow", async () => {
    const response = await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "FULL_AT_PLANT",
    });

    expect(response.status).toBe(400);
  });

  test("rejects a movement with both states omitted — that is not a movement", async () => {
    const response = await createMovement(adminToken, { type: "FILLING" });

    expect(response.status).toBe(400);
  });

  test("DAMAGE_WRITE_OFF accepts any origin", async () => {
    const response = await createMovement(adminToken, {
      type: "DAMAGE_WRITE_OFF",
      fromState: "FULL_ON_ROUTE",
    });

    expect(response.status).toBe(201);
    expect(response.body.toState).toBeNull();
  });

  test("FULL_SALE accepts leaving from the plant or from the route", async () => {
    const fromPlant = await createMovement(adminToken, {
      type: "FULL_SALE",
      fromState: "FULL_AT_PLANT",
    });
    const fromRoute = await createMovement(adminToken, {
      type: "FULL_SALE",
      fromState: "FULL_ON_ROUTE",
    });

    expect(fromPlant.status).toBe(201);
    expect(fromRoute.status).toBe(201);
  });

  test("rejects an unknown container type", async () => {
    const response = await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
      containerTypeId: MISSING_UUID,
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no existe");
  });
});

describe("POST /api/v1/container-movements — customer-facing movements", () => {
  test('rejects a movement touching "with the customer" without a locationId', async () => {
    const response = await createMovement(adminToken, {
      type: "LOAN_DELIVERY",
      fromState: "FULL_ON_ROUTE",
      toState: "WITH_CUSTOMER",
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("locación");
  });

  test("rejects a location that does not exist", async () => {
    const response = await createMovement(adminToken, {
      type: "LOAN_DELIVERY",
      fromState: "FULL_ON_ROUTE",
      toState: "WITH_CUSTOMER",
      locationId: MISSING_UUID,
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no existe");
  });

  test("delivering on loan and then picking everything back up leaves the customer's balance at zero", async () => {
    await createMovement(adminToken, {
      type: "LOAN_DELIVERY",
      fromState: "FULL_ON_ROUTE",
      toState: "WITH_CUSTOMER",
      locationId,
      quantity: 8,
    }).expect(201);

    const prisma = ctx.app.get(PrismaService);
    const afterDelivery = await prisma.customerContainerBalance.findUnique({
      where: { locationId_containerTypeId: { locationId, containerTypeId } },
    });
    expect(afterDelivery?.quantity).toBe(8);

    await createMovement(adminToken, {
      type: "EMPTY_PICKUP",
      fromState: "WITH_CUSTOMER",
      toState: "EMPTY_ON_ROUTE",
      locationId,
      quantity: 8,
    }).expect(201);

    const afterPickup = await prisma.customerContainerBalance.findUnique({
      where: { locationId_containerTypeId: { locationId, containerTypeId } },
    });
    expect(afterPickup?.quantity).toBe(0);
  });
});

describe("the ledger's own invariants, enforced by the database", () => {
  test("quantity zero or negative is rejected by the database, not only the DTO", async () => {
    const prisma = ctx.app.get(PrismaService);
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } });

    await expect(
      prisma.containerMovement.create({
        data: {
          occurredAt: new Date(),
          type: "FLEET_ENTRY",
          containerTypeId,
          quantity: 0,
          toState: "EMPTY_AT_PLANT",
          recordedById: admin.id,
        },
      }),
    ).rejects.toThrow();
  });

  test("both states null is rejected by the database, not only the service", async () => {
    const prisma = ctx.app.get(PrismaService);
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } });

    await expect(
      prisma.containerMovement.create({
        data: {
          occurredAt: new Date(),
          type: "FLEET_ENTRY",
          containerTypeId,
          quantity: 5,
          recordedById: admin.id,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("GET /api/v1/container-movements/inventory", () => {
  test("matches a manual sum of a long, varied sequence — this is what protects the fleet", async () => {
    // Two batches enter the fleet, one is filled and loaded onto a route,
    // some is delivered on loan, some sold straight from the plant, some
    // returns full, some is picked back up empty, and one gets damaged on
    // the route. No step here is a no-op: every state the fleet can be in is
    // touched at least once.
    await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
      quantity: 100,
    }).expect(201);
    await createMovement(adminToken, {
      type: "FILLING",
      fromState: "EMPTY_AT_PLANT",
      toState: "FULL_AT_PLANT",
      quantity: 80,
    }).expect(201);
    await createMovement(adminToken, {
      type: "ROUTE_LOAD",
      fromState: "FULL_AT_PLANT",
      toState: "FULL_ON_ROUTE",
      quantity: 50,
    }).expect(201);
    await createMovement(adminToken, {
      type: "LOAN_DELIVERY",
      fromState: "FULL_ON_ROUTE",
      toState: "WITH_CUSTOMER",
      locationId,
      quantity: 30,
    }).expect(201);
    await createMovement(adminToken, {
      type: "FULL_SALE",
      fromState: "FULL_ON_ROUTE",
      quantity: 10,
    }).expect(201);
    await createMovement(adminToken, {
      type: "FULL_RETURN",
      fromState: "FULL_ON_ROUTE",
      toState: "FULL_AT_PLANT",
      quantity: 10,
    }).expect(201);
    await createMovement(adminToken, {
      type: "FULL_SALE",
      fromState: "FULL_AT_PLANT",
      quantity: 5,
    }).expect(201);
    await createMovement(adminToken, {
      type: "EMPTY_PICKUP",
      fromState: "WITH_CUSTOMER",
      toState: "EMPTY_ON_ROUTE",
      locationId,
      quantity: 12,
    }).expect(201);
    await createMovement(adminToken, {
      type: "EMPTY_UNLOAD",
      fromState: "EMPTY_ON_ROUTE",
      toState: "EMPTY_AT_PLANT",
      quantity: 8,
    }).expect(201);
    await createMovement(adminToken, {
      type: "DAMAGE_WRITE_OFF",
      fromState: "EMPTY_ON_ROUTE",
      quantity: 4,
    }).expect(201);
    await createMovement(adminToken, {
      type: "LOSS_WRITE_OFF",
      fromState: "WITH_CUSTOMER",
      locationId,
      quantity: 2,
    }).expect(201);

    // Manual bookkeeping, worked out by hand from the sequence above.
    const expected = {
      EMPTY_AT_PLANT: 100 - 80 + 8, // entry, minus filled, plus unloaded
      FULL_AT_PLANT: 80 - 50 + 10 - 5, // filled, minus loaded, plus returned, minus sold
      FULL_ON_ROUTE: 50 - 30 - 10 - 10, // loaded, minus delivered, minus sold, minus returned
      WITH_CUSTOMER: 30 - 12 - 2, // delivered, minus picked up, minus lost
      EMPTY_ON_ROUTE: 12 - 8 - 4, // picked up, minus unloaded, minus damaged
    };
    const totalIn = 100; // the only entry into the fleet
    const totalOut = 10 + 5 + 4 + 2; // both sales, the damage, the loss
    const totalInStates = Object.values(expected).reduce((sum, value) => sum + value, 0);
    expect(totalInStates + totalOut).toBe(totalIn);

    const response = await request(server())
      .get("/api/v1/container-movements/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    for (const [state, quantity] of Object.entries(expected)) {
      const entry = response.body.find(
        (item: { containerTypeId: string; state: string }) =>
          item.containerTypeId === containerTypeId && item.state === state,
      );
      expect(entry).toMatchObject({ quantity });
    }

    // A container type the sequence never touched still reports every state
    // at zero, not a missing row.
    const untouched = response.body.filter(
      (item: { containerTypeId: string }) => item.containerTypeId === otherContainerTypeId,
    );
    expect(untouched).toHaveLength(5);
    expect(untouched.every((item: { quantity: number }) => item.quantity === 0)).toBe(true);
  });
});

describe("GET /api/v1/container-movements — pagination and filters", () => {
  test("lists movements filtered by type", async () => {
    await createMovement(adminToken, { type: "FLEET_ENTRY", toState: "EMPTY_AT_PLANT" }).expect(
      201,
    );
    await createMovement(adminToken, {
      type: "FILLING",
      fromState: "EMPTY_AT_PLANT",
      toState: "FULL_AT_PLANT",
    }).expect(201);

    const response = await request(server())
      .get(`/api/v1/container-movements?type=FILLING&containerTypeId=${containerTypeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data.every((item: { type: string }) => item.type === "FILLING")).toBe(
      true,
    );
    expect(response.body.total).toBe(response.body.data.length);
  });
});

describe("role guard", () => {
  test("SELLER can register and list movements", async () => {
    await createMovement(sellerToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
    }).expect(201);

    await request(server())
      .get("/api/v1/container-movements")
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
  });

  test("DRIVER is refused on every container-movements route", async () => {
    const create = await createMovement(driverToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
    });
    expect(create.status).toBe(403);

    const list = await request(server())
      .get("/api/v1/container-movements")
      .set("Authorization", `Bearer ${driverToken}`);
    expect(list.status).toBe(403);

    const inventory = await request(server())
      .get("/api/v1/container-movements/inventory")
      .set("Authorization", `Bearer ${driverToken}`);
    expect(inventory.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/container-movements");

    expect(response.status).toBe(401);
  });
});
