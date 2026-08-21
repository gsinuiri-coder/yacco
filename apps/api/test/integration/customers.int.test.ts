import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let northZoneId: string;
let southZoneId: string;

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

function validCustomer(overrides: Record<string, unknown> = {}) {
  return {
    name: "Bodega Santa Rosa",
    phone: "987654321",
    address: "Av. Los Alamos 452",
    addressReference: "Porton azul frente al parque",
    ...overrides,
  };
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-clientes", "SELLER");
  driverToken = await createUserAndLogin("repartidor-clientes", "DRIVER");

  // Zones are not seeded, and this module does not own them, so the two zones
  // the filter test needs are inserted directly.
  const prisma = ctx.app.get(PrismaService);
  const north = await prisma.zone.create({ data: { name: "Norte", deliveryDays: ["MONDAY"] } });
  const south = await prisma.zone.create({ data: { name: "Sur", deliveryDays: ["TUESDAY"] } });
  northZoneId = north.id;
  southZoneId = south.id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

// HU-05 §2.4 E1: "Cuando registro un cliente con nombre, teléfono y dirección
// o referencia, entonces se crea con saldo de envases 0 y deuda S/ 0."

describe("POST /api/v1/customers", () => {
  test("HU-05 E1: a seller registers a customer and it starts with debt S/ 0", async () => {
    const response = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send(validCustomer({ name: "Cliente Nuevo", phone: "900000001" }))
      .expect(201);

    expect(response.body).toMatchObject({
      name: "Cliente Nuevo",
      phone: "900000001",
      debtBalance: "0.00",
      creditLimit: null,
      active: true,
      zoneId: null,
      zone: null,
    });
    expect(response.body.id).toEqual(expect.any(String));

    const detail = await request(server())
      .get(`/api/v1/customers/${response.body.id}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
    expect(detail.body.debtBalance).toBe("0.00");
    expect(detail.body.zone).toBeNull();
  });

  test("accepts a zone and a credit limit, echoing the limit with 2 decimals and the zone name", async () => {
    const response = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        validCustomer({
          name: "Cliente Con Credito",
          phone: "900000002",
          zoneId: northZoneId,
          creditLimit: "150.5",
        }),
      )
      .expect(201);

    expect(response.body.zoneId).toBe(northZoneId);
    expect(response.body.zone).toEqual({ id: northZoneId, name: "Norte" });
    expect(response.body.creditLimit).toBe("150.50");

    const detail = await request(server())
      .get(`/api/v1/customers/${response.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.zone).toEqual({ id: northZoneId, name: "Norte" });
  });

  test("rejects a body missing required fields with 400", async () => {
    const response = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Sin telefono" });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("El teléfono es obligatorio");
  });

  test("rejects a non-numeric credit limit with 400", async () => {
    const response = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validCustomer({ phone: "900000003", creditLimit: "mucho" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("límite de crédito");
  });

  test("rejects a zone that does not exist with 400", async () => {
    const response = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validCustomer({ phone: "900000004", zoneId: "99999999-9999-4999-8999-999999999999" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no existe");
  });

  // debtBalance is a ledger balance: only sales and payments may move it, in
  // the same transaction as their source row. The API must refuse it outright
  // rather than accept and ignore it, or the caller would think it took.
  test("refuses a body carrying debtBalance instead of silently ignoring it", async () => {
    const response = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validCustomer({ phone: "900000005", debtBalance: "999.99" }));

    expect(response.status).toBe(400);
    // Rejected *because of* debtBalance, not for some unrelated reason.
    expect(messagesOf(response)).toContain("debtBalance");
  });
});

describe("GET /api/v1/customers", () => {
  const listedPhones = ["911000001", "911000002", "911000003"];

  beforeAll(async () => {
    await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        validCustomer({ name: "Ferreteria Aurora", phone: listedPhones[0], zoneId: northZoneId }),
      )
      .expect(201);
    await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        validCustomer({ name: "Panaderia Aurora", phone: listedPhones[1], zoneId: southZoneId }),
      )
      .expect(201);
    const inactive = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validCustomer({ name: "Kiosko Cerrado", phone: listedPhones[2], zoneId: southZoneId }))
      .expect(201);
    await request(server())
      .patch(`/api/v1/customers/${inactive.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);
  });

  test("paginates and never returns the whole roster", async () => {
    const response = await request(server())
      .get("/api/v1/customers?page=1&limit=2")
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.limit).toBe(2);
    expect(response.body.page).toBe(1);
    expect(response.body.total).toBeGreaterThan(2);
    expect(response.body.totalPages).toBe(Math.ceil(response.body.total / 2));
  });

  test("rejects a page size above the cap with 400", async () => {
    const response = await request(server())
      .get("/api/v1/customers?limit=5000")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("100");
  });

  test("searches by name, case-insensitively", async () => {
    const response = await request(server())
      .get("/api/v1/customers?search=aurora")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const names = response.body.data.map((customer: { name: string }) => customer.name);
    expect(names).toEqual(expect.arrayContaining(["Ferreteria Aurora", "Panaderia Aurora"]));
    expect(response.body.total).toBe(2);
  });

  test("searches by phone", async () => {
    const response = await request(server())
      .get(`/api/v1/customers?search=${listedPhones[0]}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.data[0].phone).toBe(listedPhones[0]);
  });

  test("filters by zone", async () => {
    const response = await request(server())
      .get(`/api/v1/customers?zoneId=${northZoneId}&limit=100`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.total).toBeGreaterThan(0);
    for (const customer of response.body.data) {
      expect(customer.zoneId).toBe(northZoneId);
      expect(customer.zone).toEqual({ id: northZoneId, name: "Norte" });
    }
  });

  test("filters by active, and a deactivated customer is still there to be found", async () => {
    const inactiveList = await request(server())
      .get("/api/v1/customers?active=false&limit=100")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const phones = inactiveList.body.data.map((customer: { phone: string }) => customer.phone);
    expect(phones).toContain(listedPhones[2]);
    for (const customer of inactiveList.body.data) {
      expect(customer.active).toBe(false);
    }

    const activeList = await request(server())
      .get("/api/v1/customers?active=true&limit=100")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const activePhones = activeList.body.data.map((customer: { phone: string }) => customer.phone);
    expect(activePhones).not.toContain(listedPhones[2]);
  });

  // The boolean transform must leave a value it does not recognise alone so
  // @IsBoolean reports it, rather than quietly turning it into false.
  test("rejects a non-boolean active filter with 400", async () => {
    const response = await request(server())
      .get("/api/v1/customers?active=quizas")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("activo");
  });

  test("exposes debtBalance and creditLimit as read-only strings in the list", async () => {
    const response = await request(server())
      .get("/api/v1/customers?limit=1")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data[0].debtBalance).toMatch(/^\d+\.\d{2}$/);
  });

  test("rejects an unknown query parameter with 400", async () => {
    const response = await request(server())
      .get("/api/v1/customers?debtBalance=0")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("debtBalance");
  });
});

describe("GET /api/v1/customers/:id", () => {
  test("an unknown id is rejected with 404 Not Found", async () => {
    const response = await request(server())
      .get("/api/v1/customers/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(messagesOf(response)).toContain("no existe");
  });

  test("a malformed id is rejected with 400", async () => {
    const response = await request(server())
      .get("/api/v1/customers/not-a-uuid")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/v1/customers/:id", () => {
  test("deactivating keeps the row and leaves debtBalance untouched", async () => {
    const created = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validCustomer({ name: "Para Desactivar", phone: "922000001" }))
      .expect(201);

    const patched = await request(server())
      .patch(`/api/v1/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ active: false })
      .expect(200);
    expect(patched.body.active).toBe(false);

    const detail = await request(server())
      .get(`/api/v1/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.active).toBe(false);
    expect(detail.body.debtBalance).toBe("0.00");
  });

  test("refuses a patch carrying debtBalance", async () => {
    const created = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validCustomer({ name: "Deuda Intacta", phone: "922000002" }))
      .expect(201);

    await request(server())
      .patch(`/api/v1/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ debtBalance: "500.00" })
      .expect(400);

    const detail = await request(server())
      .get(`/api/v1/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.debtBalance).toBe("0.00");
  });

  test("an unknown id is rejected with 404 Not Found", async () => {
    const response = await request(server())
      .patch("/api/v1/customers/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });

    expect(response.status).toBe(404);
    expect(messagesOf(response)).toContain("no existe");
  });
});

describe("role guard", () => {
  test("DRIVER is refused on every customers route", async () => {
    const list = await request(server())
      .get("/api/v1/customers")
      .set("Authorization", `Bearer ${driverToken}`);
    expect(list.status).toBe(403);

    const create = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${driverToken}`)
      .send(validCustomer({ phone: "933000001" }));
    expect(create.status).toBe(403);

    const patch = await request(server())
      .patch("/api/v1/customers/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ active: false });
    expect(patch.status).toBe(403);

    // 403 must come from the guard, not from the customer not existing.
    const detail = await request(server())
      .get("/api/v1/customers/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${driverToken}`);
    expect(detail.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/customers");

    expect(response.status).toBe(401);
  });
});
