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
let customerId: string;
let primaryLocationId: string;
let secondLocationId: string;
let otherCustomerLocationId: string;
let productId: string;

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

// Not async: an async wrapper would box the returned supertest Test in a
// Promise, losing its chainable `.expect()` before the caller can use it.
function createCustomerPrice(token: string, overrides: Record<string, unknown> = {}) {
  return request(server())
    .post(`/api/v1/customers/${customerId}/prices`)
    .set("Authorization", `Bearer ${token}`)
    .send({ productId, price: "7.00", ...overrides });
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-precios", "SELLER");
  driverToken = await createUserAndLogin("repartidor-precios", "DRIVER");

  // Product is not owned by this module and is not seeded; inserted
  // directly, mirroring orders.int.test.ts.
  const prisma = ctx.app.get(PrismaService);
  const containerType = await prisma.containerType.findFirstOrThrow();
  const product = await prisma.product.create({
    data: {
      containerTypeId: containerType.id,
      name: "Recarga 20L (precios)",
      type: "REFILL",
      listPrice: "8.00",
    },
  });
  productId = product.id;

  const created = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega Con Precios Pactados",
      phone: "987654321",
      address: "Av. Los Alamos 452",
      addressReference: "Porton azul",
    })
    .expect(201);
  customerId = created.body.id;

  // The primary location is created with the customer; a second location for
  // the SAME customer has no CRUD yet (out of scope here), so it is inserted
  // directly — same pattern the customer-locations migration test uses.
  const primary = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId, isPrimary: true },
  });
  primaryLocationId = primary.id;
  const second = await prisma.customerLocation.create({
    data: {
      customerId,
      name: "Sucursal Norte",
      address: "Jr. Norte 100",
      addressReference: "Esquina",
      phone: "987654322",
    },
  });
  secondLocationId = second.id;

  const otherCustomer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Otro Cliente",
      phone: "987654323",
      address: "Jr. Otro 1",
      addressReference: "Al lado",
    })
    .expect(201);
  const otherLocation = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: otherCustomer.body.id, isPrimary: true },
  });
  otherCustomerLocationId = otherLocation.id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

// Belt and suspenders on top of each test's own cleanup: if an assertion
// throws before a test reaches its cleanup DELETE, a leftover agreed price
// would make the NEXT test's "create" collide with the very unique
// constraint this suite exists to prove — this guarantees a clean slate
// regardless of what a failed test left behind.
afterEach(async () => {
  const prisma = ctx.app.get(PrismaService);
  await prisma.customerPrice.deleteMany({ where: { customerId } });
});

describe("GET /api/v1/customers/:customerId/effective-prices — precedence", () => {
  test("without any agreed price, the effective price is listPrice, source LIST", async () => {
    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const entry = response.body.find(
      (item: { product: { id: string } }) => item.product.id === productId,
    );
    expect(entry).toMatchObject({ price: "8.00", source: "LIST" });
  });

  test("a customer-wide price wins over listPrice, for every one of its locations", async () => {
    const created = await createCustomerPrice(adminToken, { price: "7.00" }).expect(201);
    expect(created.body.location).toBeNull();

    const atPrimary = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices?locationId=${primaryLocationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const atSecond = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices?locationId=${secondLocationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    for (const response of [atPrimary, atSecond]) {
      const entry = response.body.find(
        (item: { product: { id: string } }) => item.product.id === productId,
      );
      expect(entry).toMatchObject({ price: "7.00", source: "CUSTOMER" });
    }

    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
  });

  test("a location price wins over the customer price in ITS location; the other location keeps the customer price; deleting it reverts to the customer price", async () => {
    const customerWide = await createCustomerPrice(adminToken, { price: "7.00" }).expect(201);
    const override = await createCustomerPrice(adminToken, {
      locationId: secondLocationId,
      price: "6.50",
    }).expect(201);
    expect(override.body.location).toEqual({ id: secondLocationId, name: "Sucursal Norte" });

    const atSecond = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices?locationId=${secondLocationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(
      atSecond.body.find((item: { product: { id: string } }) => item.product.id === productId),
    ).toMatchObject({ price: "6.50", source: "LOCATION" });

    const atPrimary = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices?locationId=${primaryLocationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(
      atPrimary.body.find((item: { product: { id: string } }) => item.product.id === productId),
    ).toMatchObject({ price: "7.00", source: "CUSTOMER" });

    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${override.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);

    const afterDelete = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices?locationId=${secondLocationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(
      afterDelete.body.find((item: { product: { id: string } }) => item.product.id === productId),
    ).toMatchObject({ price: "7.00", source: "CUSTOMER" });

    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${customerWide.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
  });

  test("rejects a locationId that does not belong to this customer", async () => {
    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices?locationId=${otherCustomerLocationId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no pertenece");
  });

  test("SELLER can consult effective prices", async () => {
    await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
  });
});

describe("POST /api/v1/customers/:customerId/prices — the two partial unique indexes", () => {
  test("rejects a duplicate customer-wide price (locationId IS NULL tier)", async () => {
    const first = await createCustomerPrice(adminToken, { price: "7.00" }).expect(201);

    const duplicate = await createCustomerPrice(adminToken, { price: "6.00" });

    expect(duplicate.status).toBe(409);
    expect(messagesOf(duplicate)).toContain("Ya existe");

    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${first.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
  });

  test("rejects a duplicate location price (locationId IS NOT NULL tier) — a plain UNIQUE would miss this", async () => {
    const first = await createCustomerPrice(adminToken, {
      locationId: primaryLocationId,
      price: "7.00",
    }).expect(201);

    const duplicate = await createCustomerPrice(adminToken, {
      locationId: primaryLocationId,
      price: "6.00",
    });

    expect(duplicate.status).toBe(409);
    expect(messagesOf(duplicate)).toContain("Ya existe");

    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${first.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
  });

  // Two NULLs are not equal in Postgres, so a single 3-column UNIQUE would
  // never collide on the locationId-IS-NULL tier — this is exactly the case
  // that forced the two partial indexes instead of one plain UNIQUE.
  test("a customer-wide price and a location price for the same product coexist", async () => {
    const customerWide = await createCustomerPrice(adminToken, { price: "7.00" }).expect(201);
    const locationSpecific = await createCustomerPrice(adminToken, {
      locationId: primaryLocationId,
      price: "6.50",
    }).expect(201);

    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${customerWide.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${locationSpecific.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
  });

  test("rejects a location that does not belong to this customer, with 400 not 500", async () => {
    const response = await createCustomerPrice(adminToken, { locationId: otherCustomerLocationId });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no pertenece");
  });

  test("rejects a location that does not exist at all", async () => {
    const response = await createCustomerPrice(adminToken, { locationId: MISSING_UUID });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no existe");
  });

  test("rejects a product that does not exist", async () => {
    const response = await request(server())
      .post(`/api/v1/customers/${customerId}/prices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: MISSING_UUID, price: "7.00" });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no existe");
  });

  test("rejects a price sent as a JSON number, not just a malformed string", async () => {
    const response = await request(server())
      .post(`/api/v1/customers/${customerId}/prices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId, price: 7.0 });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("precio");
  });

  test("an unknown customer id is rejected with 404", async () => {
    const response = await request(server())
      .post(`/api/v1/customers/${MISSING_UUID}/prices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId, price: "7.00" });

    expect(response.status).toBe(404);
  });
});

describe("PATCH and DELETE /api/v1/customers/:customerId/prices/:priceId", () => {
  test("updates the price, and the effective price picks it up", async () => {
    const created = await createCustomerPrice(adminToken, { price: "7.00" }).expect(201);

    const patched = await request(server())
      .patch(`/api/v1/customers/${customerId}/prices/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ price: "5.50" })
      .expect(200);
    expect(patched.body.price).toBe("5.50");

    const effective = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(
      effective.body.find((item: { product: { id: string } }) => item.product.id === productId),
    ).toMatchObject({ price: "5.50", source: "CUSTOMER" });

    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
  });

  test("an unknown price id is rejected with 404", async () => {
    const response = await request(server())
      .patch(`/api/v1/customers/${customerId}/prices/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ price: "5.50" });

    expect(response.status).toBe(404);
  });

  test("deleting an unknown price id is rejected with 404", async () => {
    const response = await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});

describe("GET /api/v1/customers/:customerId/prices", () => {
  test("lists agreed prices with product and location resolved as nested objects", async () => {
    const created = await createCustomerPrice(adminToken, {
      locationId: primaryLocationId,
      price: "6.50",
    }).expect(201);

    const list = await request(server())
      .get(`/api/v1/customers/${customerId}/prices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const entry = list.body.find((item: { id: string }) => item.id === created.body.id);
    expect(entry).toMatchObject({
      product: { id: productId, name: expect.any(String) },
      location: { id: primaryLocationId, name: expect.any(String) },
      price: "6.50",
    });

    await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
  });
});

describe("role guard", () => {
  test("SELLER cannot create, update or delete prices", async () => {
    const create = await createCustomerPrice(sellerToken, { price: "7.00" });
    expect(create.status).toBe(403);

    const patch = await request(server())
      .patch(`/api/v1/customers/${customerId}/prices/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ price: "7.00" });
    expect(patch.status).toBe(403);

    const remove = await request(server())
      .delete(`/api/v1/customers/${customerId}/prices/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(remove.status).toBe(403);
  });

  test("SELLER cannot list the management view either", async () => {
    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/prices`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(response.status).toBe(403);
  });

  test("DRIVER is refused on every customer-prices route", async () => {
    const list = await request(server())
      .get(`/api/v1/customers/${customerId}/prices`)
      .set("Authorization", `Bearer ${driverToken}`);
    expect(list.status).toBe(403);

    const effective = await request(server())
      .get(`/api/v1/customers/${customerId}/effective-prices`)
      .set("Authorization", `Bearer ${driverToken}`);
    expect(effective.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get(`/api/v1/customers/${customerId}/prices`);

    expect(response.status).toBe(401);
  });
});
