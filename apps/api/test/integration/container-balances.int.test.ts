import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// The audit work list: who holds what according to the system and — above
// all — who has never been counted. Built from customer_locations, so a
// location with no movement at all still shows up.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let typeA: { id: string; name: string };
let typeB: { id: string; name: string };
let northZoneId: string;
let untouched: { locationId: string };
let twoTypes: { locationId: string };
let negative: { locationId: string };
let stale: { locationId: string };
let inactiveCustomer: { locationId: string };
let inactiveLocation: { locationId: string };

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

async function createLocation(name: string, phone: string, zoneId?: string): Promise<string> {
  const prisma = ctx.app.get(PrismaService);
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name,
      phone,
      address: "Av. Auditoría 1",
      addressReference: "Portón gris",
      ...(zoneId !== undefined ? { zoneId } : {}),
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id, isPrimary: true },
  });
  return location.id;
}

function deliver(locationId: string, containerTypeId: string, quantity: number) {
  return request(server())
    .post("/api/v1/container-movements")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      type: "LOAN_DELIVERY",
      containerTypeId,
      fromState: "FULL_ON_ROUTE",
      toState: "WITH_CUSTOMER",
      locationId,
      quantity,
    })
    .expect(201);
}

function pickup(locationId: string, containerTypeId: string, quantity: number) {
  return request(server())
    .post("/api/v1/container-movements")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      type: "EMPTY_PICKUP",
      containerTypeId,
      fromState: "WITH_CUSTOMER",
      toState: "EMPTY_ON_ROUTE",
      locationId,
      quantity,
    })
    .expect(201);
}

/** Backdated counts go straight to the table: the public route always stamps now. */
async function countAt(
  locationId: string,
  containerTypeId: string,
  countedQuantity: number,
  countedAt: Date,
): Promise<void> {
  const prisma = ctx.app.get(PrismaService);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } });
  await prisma.containerCount.create({
    data: {
      locationId,
      containerTypeId,
      countedAt,
      countedQuantity,
      expectedQuantity: countedQuantity,
      countedById: admin.id,
    },
  });
}

interface Row {
  customer: { id: string; name: string; active: boolean };
  location: { id: string; name: string; active: boolean };
  zone: { id: string; name: string } | null;
  totalQuantity: number;
  lastCountedAt: string | null;
  containers: {
    containerType: { id: string; name: string };
    quantity: number;
    lastCountedAt: string | null;
  }[];
}

async function fetchAll(queryString = ""): Promise<{ data: Row[]; total: number }> {
  const response = await request(server())
    .get(`/api/v1/container-balances?limit=100${queryString}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  return response.body;
}

function rowOf(rows: Row[], locationId: string): Row | undefined {
  return rows.find((row) => row.location.id === locationId);
}

const OLD_COUNT = new Date("2026-01-05T15:00:00.000Z");
const RECENT_COUNT = new Date("2026-06-20T15:00:00.000Z");
const CUTOFF = "2026-03-01T00:00:00.000Z";

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-auditoria", "SELLER");

  const prisma = ctx.app.get(PrismaService);
  const containerTypes = await prisma.containerType.findMany({ orderBy: { name: "asc" } });
  typeA = containerTypes[0]!;
  typeB = containerTypes[1]!;
  const north = await prisma.zone.create({ data: { name: "Norte", deliveryDays: ["MONDAY"] } });
  northZoneId = north.id;

  // Never touched: no movement, no count. The whole point of the report.
  untouched = { locationId: await createLocation("Bodega Sin Tocar", "987100001", northZoneId) };

  // Two types, each counted at a different time; no zone.
  twoTypes = { locationId: await createLocation("Bodega Dos Tipos", "987100002") };
  await deliver(twoTypes.locationId, typeA.id, 6);
  await deliver(twoTypes.locationId, typeB.id, 2);
  await countAt(twoTypes.locationId, typeA.id, 6, OLD_COUNT);
  await countAt(twoTypes.locationId, typeB.id, 2, RECENT_COUNT);

  // Returned more than the books said: type A at -1, type B fine.
  negative = { locationId: await createLocation("Bodega Negativa", "987100003", northZoneId) };
  await deliver(negative.locationId, typeA.id, 2);
  await pickup(negative.locationId, typeA.id, 3);
  await deliver(negative.locationId, typeB.id, 1);

  // Counted once, long ago, and never since.
  stale = { locationId: await createLocation("Bodega Antigua", "987100004") };
  await deliver(stale.locationId, typeA.id, 4);
  await countAt(stale.locationId, typeA.id, 4, OLD_COUNT);

  // Customer taken off the books while still holding containers: the most
  // urgent case of the audit, and it must NOT vanish from the list.
  inactiveCustomer = { locationId: await createLocation("Bodega Cerrada", "987100005") };
  await deliver(inactiveCustomer.locationId, typeA.id, 3);
  const closed = await prisma.customerLocation.findUniqueOrThrow({
    where: { id: inactiveCustomer.locationId },
  });
  await prisma.customer.update({ where: { id: closed.customerId }, data: { active: false } });

  // Active customer whose location was deactivated.
  inactiveLocation = { locationId: await createLocation("Bodega Sucursal Cerrada", "987100006") };
  await deliver(inactiveLocation.locationId, typeB.id, 1);
  await prisma.customerLocation.update({
    where: { id: inactiveLocation.locationId },
    data: { active: false },
  });
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/container-balances", () => {
  test("a location with no movement at all appears, with empty containers and lastCountedAt null", async () => {
    const { data } = await fetchAll();

    const row = rowOf(data, untouched.locationId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      customer: { id: expect.any(String), name: "Bodega Sin Tocar" },
      location: { id: untouched.locationId, name: expect.any(String) },
      zone: { id: northZoneId, name: "Norte" },
      totalQuantity: 0,
      lastCountedAt: null,
      containers: [],
    });
  });

  test("a location holding two types returns both, each with its own lastCountedAt, and the row's is the most recent", async () => {
    const { data } = await fetchAll();

    const row = rowOf(data, twoTypes.locationId)!;
    expect(row.zone).toBeNull();
    expect(row.totalQuantity).toBe(8);
    expect(row.containers).toHaveLength(2);
    const a = row.containers.find((c) => c.containerType.id === typeA.id)!;
    const b = row.containers.find((c) => c.containerType.id === typeB.id)!;
    expect(a).toEqual({
      containerType: { id: typeA.id, name: typeA.name },
      quantity: 6,
      lastCountedAt: OLD_COUNT.toISOString(),
    });
    expect(b).toEqual({
      containerType: { id: typeB.id, name: typeB.name },
      quantity: 2,
      lastCountedAt: RECENT_COUNT.toISOString(),
    });
    expect(row.lastCountedAt).toBe(RECENT_COUNT.toISOString());
  });

  test("a negative balance is shown as-is, never hidden", async () => {
    const { data } = await fetchAll();

    const row = rowOf(data, negative.locationId)!;
    const a = row.containers.find((c) => c.containerType.id === typeA.id)!;
    expect(a.quantity).toBe(-1);
    expect(row.totalQuantity).toBe(0);
  });

  test("a deactivated customer's location still appears, with customer.active false", async () => {
    const { data } = await fetchAll();

    const row = rowOf(data, inactiveCustomer.locationId);
    expect(row).toBeDefined();
    expect(row!.customer.active).toBe(false);
    expect(row!.location.active).toBe(true);
    expect(row!.totalQuantity).toBe(3);
  });

  test("a deactivated location of an active customer reports customer.active true and location.active false", async () => {
    const { data } = await fetchAll();

    const row = rowOf(data, inactiveLocation.locationId)!;
    expect(row.customer.active).toBe(true);
    expect(row.location.active).toBe(false);
  });

  test("rows are ordered by customer name", async () => {
    const { data } = await fetchAll();

    const names = data.map((row) => row.customer.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
  });

  describe("filters", () => {
    test("uncountedOnly keeps the never-counted and drops the counted", async () => {
      const { data } = await fetchAll("&uncountedOnly=true");

      const ids = data.map((row) => row.location.id);
      expect(ids).toContain(untouched.locationId);
      expect(ids).toContain(negative.locationId);
      expect(ids).not.toContain(twoTypes.locationId);
      expect(ids).not.toContain(stale.locationId);
    });

    test("withDiscrepancies returns only locations with some type in negative", async () => {
      const { data } = await fetchAll("&withDiscrepancies=true");

      expect(data.map((row) => row.location.id)).toEqual([negative.locationId]);
    });

    test("countedBefore returns locations counted, but not since the cutoff", async () => {
      const { data } = await fetchAll(`&countedBefore=${CUTOFF}`);

      const ids = data.map((row) => row.location.id);
      expect(ids).toContain(stale.locationId);
      expect(ids).not.toContain(twoTypes.locationId);
      expect(ids).not.toContain(untouched.locationId);
    });

    test("zoneId filters, and a location without a zone breaks nothing", async () => {
      const { data } = await fetchAll(`&zoneId=${northZoneId}`);

      const ids = data.map((row) => row.location.id);
      expect(ids).toEqual(expect.arrayContaining([untouched.locationId, negative.locationId]));
      expect(ids).not.toContain(twoTypes.locationId);
      for (const row of data) expect(row.zone).toEqual({ id: northZoneId, name: "Norte" });
    });

    test("rejects a non-boolean or non-date filter with 400", async () => {
      await request(server())
        .get("/api/v1/container-balances?uncountedOnly=quizas")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
      await request(server())
        .get("/api/v1/container-balances?countedBefore=ayer")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  test("pagination reports the right total and never the whole list", async () => {
    const all = await fetchAll();

    const response = await request(server())
      .get("/api/v1/container-balances?page=1&limit=2")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(response.body).toMatchObject({
      total: all.total,
      page: 1,
      limit: 2,
      totalPages: Math.ceil(all.total / 2),
    });
    expect(response.body.data).toHaveLength(2);
    expect(all.total).toBeGreaterThanOrEqual(4);

    await request(server())
      .get("/api/v1/container-balances?limit=101")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });
});

describe("role guard", () => {
  test("SELLER is refused — the audit is office work", async () => {
    await request(server())
      .get("/api/v1/container-balances")
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    await request(server()).get("/api/v1/container-balances").expect(401);
  });
});
