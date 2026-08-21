import request from "supertest";
import { OrderStatus } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let sellerId: string;
let driverToken: string;
let customerId: string;
let otherCustomerId: string;
let refillProductId: string;
let containerProductId: string;

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

function validOrder(overrides: Record<string, unknown> = {}) {
  return {
    customerId,
    deliveryDate: "2026-08-25",
    items: [{ productId: refillProductId, quantity: 3, unitPrice: "12.50" }],
    ...overrides,
  };
}

async function createOrder(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(server())
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${token}`)
    .send(validOrder(overrides))
    .expect(201);
  return response.body.id;
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-pedidos", "SELLER");
  driverToken = await createUserAndLogin("repartidor-pedidos", "DRIVER");

  const sellerList = await request(server())
    .get("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  sellerId = sellerList.body.find(
    (user: { username: string }) => user.username === "vendedor-pedidos",
  ).id;

  // Customers come from their own module; products are not seeded and this
  // module does not own them, so they are inserted directly.
  const prisma = ctx.app.get(PrismaService);
  const containerType = await prisma.containerType.findFirstOrThrow();
  const refill = await prisma.product.create({
    data: {
      containerTypeId: containerType.id,
      name: "Recarga 20L",
      type: "REFILL",
      listPrice: "12.50",
    },
  });
  const containerSale = await prisma.product.create({
    data: {
      containerTypeId: containerType.id,
      name: "Bidón nuevo",
      type: "CONTAINER_SALE",
      listPrice: "35.00",
    },
  });
  refillProductId = refill.id;
  containerProductId = containerSale.id;

  const first = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega Santa Rosa",
      phone: "987654321",
      address: "Av. Los Alamos 452",
      addressReference: "Porton azul",
    })
    .expect(201);
  const second = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Panaderia Aurora",
      phone: "987654322",
      address: "Jr. Union 100",
      addressReference: "Esquina",
    })
    .expect(201);
  customerId = first.body.id;
  otherCustomerId = second.body.id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

// HU-06 §2.4 E1: "Dado un cliente registrado, cuando capturo un pedido,
// entonces queda en estado «pendiente», disponible para asignar a una ruta,
// con precios según lista o personalizado."

describe("POST /api/v1/orders", () => {
  test("HU-06 E1: a seller captures an order and it lands PENDING with its items", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send(
        validOrder({
          items: [
            { productId: refillProductId, quantity: 3, unitPrice: "12.50" },
            { productId: containerProductId, quantity: 1, unitPrice: "35.00" },
          ],
        }),
      );

    expect(response.status).toBe(201);
    expect(response.body.status).toBe(OrderStatus.PENDING);
    expect(response.body.deliveryDate).toBe("2026-08-25");
    // createdById comes from the token, not the body.
    expect(response.body.createdById).toBe(sellerId);
    expect(response.body.customer).toMatchObject({ id: customerId, name: "Bodega Santa Rosa" });
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items.map((item: { unitPrice: string }) => item.unitPrice).sort()).toEqual(
      ["12.50", "35.00"],
    );
    expect(response.body.items[0].product.name).toEqual(expect.any(String));
  });

  test("money keeps 2 decimals exactly, with no float round-trip", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        validOrder({ items: [{ productId: refillProductId, quantity: 1, unitPrice: "0.07" }] }),
      );

    expect(response.status).toBe(201);
    expect(response.body.items[0].unitPrice).toBe("0.07");
  });

  test("refuses a unitPrice sent as a JSON number, not just a malformed string", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ items: [{ productId: refillProductId, quantity: 1, unitPrice: 12.5 }] }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("precio unitario");
  });

  test("rejects an unknown customer, naming it", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ customerId: MISSING_UUID }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain(MISSING_UUID);
    expect(messagesOf(response)).toContain("no existe");
  });

  test("rejects an unknown product, naming it", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ items: [{ productId: MISSING_UUID, quantity: 1, unitPrice: "10.00" }] }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain(MISSING_UUID);
  });

  // Office entry, not field capture: a deactivated customer is a decision
  // someone took, and taking an order against it would quietly undo it.
  test("refuses an order for a deactivated customer, saying it must be reactivated", async () => {
    const created = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Bodega Cerrada",
        phone: "955000001",
        address: "Av. Cerrada 1",
        addressReference: "Cortina abajo",
      })
      .expect(201);
    await request(server())
      .patch(`/api/v1/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);

    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ customerId: created.body.id }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("Bodega Cerrada");
    expect(messagesOf(response)).toContain("desactivado");
    expect(messagesOf(response)).toContain("reactívalo");
  });

  test("refuses a product that is no longer on sale, naming it", async () => {
    const prisma = ctx.app.get(PrismaService);
    const containerType = await prisma.containerType.findFirstOrThrow();
    const withdrawn = await prisma.product.create({
      data: {
        containerTypeId: containerType.id,
        name: "Recarga descontinuada",
        type: "REFILL",
        listPrice: "9.00",
        active: false,
      },
    });

    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ items: [{ productId: withdrawn.id, quantity: 1, unitPrice: "9.00" }] }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("Recarga descontinuada");
    expect(messagesOf(response)).toContain("Ya no están a la venta");
  });

  test("a customer and products that are all active still go through", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        validOrder({
          items: [
            { productId: refillProductId, quantity: 2, unitPrice: "12.50" },
            { productId: containerProductId, quantity: 1, unitPrice: "35.00" },
          ],
        }),
      );

    expect(response.status).toBe(201);
    expect(response.body.status).toBe(OrderStatus.PENDING);
    expect(response.body.items).toHaveLength(2);
  });

  test("rejects quantity 0 before the CHECK constraint has to", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        validOrder({ items: [{ productId: refillProductId, quantity: 0, unitPrice: "10.00" }] }),
      );

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("cantidad debe ser mayor que 0");
  });

  test("rejects a fractional quantity", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        validOrder({ items: [{ productId: refillProductId, quantity: 1.5, unitPrice: "10.00" }] }),
      );

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("número entero");
  });

  test("rejects an order with no items", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ items: [] }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("al menos un ítem");
  });

  // status is owned by the routes module; accepting it here would let the
  // office skip a route and mark an order delivered from the web.
  test("refuses a body that tries to set status", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ status: OrderStatus.DELIVERED }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("status");
  });

  test("refuses a body that tries to set createdById", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ createdById: MISSING_UUID }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("createdById");
  });

  test("rejects a malformed delivery date", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ deliveryDate: "25/08/2026" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("AAAA-MM-DD");
  });

  test("rejects a well-formed but impossible delivery date", async () => {
    const response = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validOrder({ deliveryDate: "2026-02-31" }));

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("no es una fecha válida");
  });
});

describe("GET /api/v1/orders", () => {
  let cancelledId: string;

  beforeAll(async () => {
    await createOrder(adminToken, { deliveryDate: "2026-09-01" });
    await createOrder(adminToken, { deliveryDate: "2026-09-05" });
    await createOrder(adminToken, { customerId: otherCustomerId, deliveryDate: "2026-09-10" });
    cancelledId = await createOrder(adminToken, { deliveryDate: "2026-09-15" });
    await request(server())
      .patch(`/api/v1/orders/${cancelledId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
  });

  test("paginates and never returns everything", async () => {
    const response = await request(server())
      .get("/api/v1/orders?page=1&limit=2")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.total).toBeGreaterThan(2);
    expect(response.body.totalPages).toBe(Math.ceil(response.body.total / 2));
    // Items and customer travel with the list, so the web needs no N+1.
    expect(response.body.data[0].items.length).toBeGreaterThan(0);
    expect(response.body.data[0].customer.name).toEqual(expect.any(String));
  });

  test("rejects a page size above the cap", async () => {
    const response = await request(server())
      .get("/api/v1/orders?limit=5000")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("100");
  });

  test("filters by status", async () => {
    const response = await request(server())
      .get("/api/v1/orders?status=CANCELLED&limit=100")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);
    for (const order of response.body.data) {
      expect(order.status).toBe(OrderStatus.CANCELLED);
    }
    expect(response.body.data.map((order: { id: string }) => order.id)).toContain(cancelledId);
  });

  test("rejects a status that is not an order status", async () => {
    const response = await request(server())
      .get("/api/v1/orders?status=ENTREGADO")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("estado");
  });

  test("filters by customer", async () => {
    const response = await request(server())
      .get(`/api/v1/orders?customerId=${otherCustomerId}&limit=100`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);
    for (const order of response.body.data) {
      expect(order.customerId).toBe(otherCustomerId);
    }
  });

  test("filters an inclusive delivery-date range", async () => {
    const response = await request(server())
      .get("/api/v1/orders?deliveryDateFrom=2026-09-05&deliveryDateTo=2026-09-10&limit=100")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const dates = response.body.data.map((order: { deliveryDate: string }) => order.deliveryDate);
    expect(dates).toContain("2026-09-05");
    expect(dates).toContain("2026-09-10");
    expect(dates).not.toContain("2026-09-01");
    expect(dates).not.toContain("2026-09-15");
  });

  test("rejects an inverted date range", async () => {
    const response = await request(server())
      .get("/api/v1/orders?deliveryDateFrom=2026-09-30&deliveryDateTo=2026-09-01")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("posterior");
  });

  test("rejects an unknown query parameter", async () => {
    const response = await request(server())
      .get("/api/v1/orders?createdById=x")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("createdById");
  });
});

describe("GET /api/v1/orders/:id", () => {
  test("returns the order with its items", async () => {
    const orderId = await createOrder(adminToken);

    const response = await request(server())
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(orderId);
    expect(response.body.items[0].quantity).toBe(3);
    expect(response.body.items[0].unitPrice).toBe("12.50");
  });

  test("an unknown id is rejected with 404", async () => {
    const response = await request(server())
      .get(`/api/v1/orders/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(messagesOf(response)).toContain("no existe");
  });

  test("a malformed id is rejected with 400", async () => {
    const response = await request(server())
      .get("/api/v1/orders/not-a-uuid")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/v1/orders/:id/cancel", () => {
  test("cancels a PENDING order and the row survives", async () => {
    const orderId = await createOrder(sellerToken);

    const response = await request(server())
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(OrderStatus.CANCELLED);

    const detail = await request(server())
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe(OrderStatus.CANCELLED);
    expect(detail.body.items).toHaveLength(1);
  });

  test("refuses to cancel an order that is no longer PENDING", async () => {
    const orderId = await createOrder(adminToken);
    await request(server())
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const second = await request(server())
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(second.status).toBe(409);
    expect(messagesOf(second)).toContain(OrderStatus.CANCELLED);
  });

  // The routes module is what moves an order to ON_ROUTE; simulated here so
  // the guard is proven against the state a real route would leave behind.
  test("refuses to cancel an order a route already picked up", async () => {
    const orderId = await createOrder(adminToken);
    const prisma = ctx.app.get(PrismaService);
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.ON_ROUTE },
    });

    const response = await request(server())
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain(OrderStatus.ON_ROUTE);
  });

  test("an unknown id is rejected with 404", async () => {
    const response = await request(server())
      .patch(`/api/v1/orders/${MISSING_UUID}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(messagesOf(response)).toContain("no existe");
  });
});

describe("role guard", () => {
  test("DRIVER is refused on every orders route", async () => {
    const list = await request(server())
      .get("/api/v1/orders")
      .set("Authorization", `Bearer ${driverToken}`);
    expect(list.status).toBe(403);

    const create = await request(server())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${driverToken}`)
      .send(validOrder());
    expect(create.status).toBe(403);

    const detail = await request(server())
      .get(`/api/v1/orders/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${driverToken}`);
    expect(detail.status).toBe(403);

    const cancel = await request(server())
      .patch(`/api/v1/orders/${MISSING_UUID}/cancel`)
      .set("Authorization", `Bearer ${driverToken}`);
    expect(cancel.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/orders");

    expect(response.status).toBe(401);
  });
});
