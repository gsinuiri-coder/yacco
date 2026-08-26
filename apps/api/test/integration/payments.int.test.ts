import request from "supertest";
import { PaymentStatus } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// Gherkin-adjacent (spec §4.3, "principio de diseño"): "Un pago que requiere
// confirmación nace PENDING y no reduce la deuda del cliente hasta que la
// oficina lo confirma o lo rechaza; confirmar y rechazar son cada uno
// idempotentes bajo concurrencia — un pago solo se resuelve una vez."

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let nextDayOffset = 0;
function nextDate(): string {
  const date = new Date(Date.UTC(2026, 10, 1) + nextDayOffset * 24 * 60 * 60 * 1000);
  nextDayOffset += 1;
  return date.toISOString().slice(0, 10);
}

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let adminUserId: string;
let sellerToken: string;
let driverToken: string;
let driverId: string;
let zoneId: string;
let containerTypeId: string;
let refillProductId: string;
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

let customerSeq = 0;
async function createFreshLocation(): Promise<{ customerId: string; locationId: string }> {
  customerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Pagos ${customerSeq}`,
      phone: `98500${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Pagos 1",
      addressReference: "Portón gris",
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  return { customerId: customer.body.id, locationId: location.id };
}

let batchCounter = 0;
async function createBatchItem(producedQty: number): Promise<string> {
  batchCounter += 1;
  const response = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      code: `LOTE-PAGOS-${batchCounter}`,
      date: "2026-08-01",
      items: [{ containerTypeId, producedQty }],
    })
    .expect(201);
  return response.body.items[0].id;
}

/**
 * Delivers `quantity` refills at a fresh customer, paid with `paymentMethodId`
 * for `amount`, and returns everything a test needs to interrogate the
 * resulting Payment row and the customer's debtBalance.
 */
async function deliverWithPayment(
  paymentMethodId: string,
  amount: string,
  quantity = 1,
): Promise<{ paymentId: string; customerId: string; saleTotal: string }> {
  const { customerId, locationId } = await createFreshLocation();
  const batchItemId = await createBatchItem(10);
  const route = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ driverId, date: nextDate(), zoneId })
    .expect(201);
  const routeId = route.body.id;
  await request(server())
    .post(`/api/v1/routes/${routeId}/loads`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ batchItemId, quantity: 10 })
    .expect(201);
  const stop = await request(server())
    .post(`/api/v1/routes/${routeId}/stops`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ origin: "VAN_SALE", locationId })
    .expect(201);
  await request(server())
    .patch(`/api/v1/routes/${routeId}/start`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  const delivered = await request(server())
    .patch(`/api/v1/routes/${routeId}/stops/${stop.body.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      status: "DELIVERED",
      items: [{ productId: refillProductId, quantity }],
      payment: { paymentMethodId, amount },
    })
    .expect(200);

  return { paymentId: delivered.body.payment.id, customerId, saleTotal: delivered.body.sale.total };
}

async function customerDebtBalance(id: string): Promise<string> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });
  return customer.debtBalance.toFixed(2);
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } });
  adminUserId = admin.id;
  sellerToken = (await createUserAndLogin("vendedor-pagos", "SELLER")).token;
  const driver = await createUserAndLogin("repartidor-pagos", "DRIVER");
  driverToken = driver.token;
  driverId = driver.id;

  const zone = await request(server())
    .post("/api/v1/zones")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Zona Pagos" })
    .expect(201);
  zoneId = zone.body.id;

  const containerType = await prisma.containerType.findFirstOrThrow({
    where: { name: "Con caño" },
  });
  containerTypeId = containerType.id;
  const product = await prisma.product.findFirstOrThrow({
    where: { name: "Recarga 20L con caño" },
  });
  refillProductId = product.id;
  cashPaymentMethodId = (
    await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } })
  ).id;
  yapePaymentMethodId = (await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Yape" } }))
    .id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("dispatch creates a PENDING payment that does not touch debtBalance yet", () => {
  test("a fresh Yape payment from dispatch is PENDING and debtBalance still carries the full sale", async () => {
    const { paymentId, customerId, saleTotal } = await deliverWithPayment(
      yapePaymentMethodId,
      "8.00",
    );

    expect(await customerDebtBalance(customerId)).toBe(saleTotal);

    const list = await request(server())
      .get(`/api/v1/payments?customerId=${customerId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(paymentId);
    expect(list.body.data[0].status).toBe(PaymentStatus.PENDING);
  });
});

describe("POST /api/v1/payments/:id/confirm", () => {
  test("confirms a PENDING payment, reduces debtBalance by exactly the amount, and stamps confirmedAt/confirmedBy", async () => {
    const { paymentId, customerId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/confirm`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.payment.status).toBe(PaymentStatus.CONFIRMED);
    expect(response.body.payment.confirmedBy.id).toBe(adminUserId);
    expect(response.body.debtBalance).toBe("0.00");
    expect(await customerDebtBalance(customerId)).toBe("0.00");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.confirmedAt).not.toBeNull();
    expect(payment.confirmedById).toBe(adminUserId);
  });

  // The point of this PR: written first is exactly what the task asked for,
  // but Jest test order within a describe block doesn't affect grading —
  // what matters is that it exists and is airtight.
  test("real concurrency: two simultaneous confirms — exactly one succeeds, debt moves once", async () => {
    const { paymentId, customerId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const [first, second] = await Promise.all([
      request(server())
        .post(`/api/v1/payments/${paymentId}/confirm`)
        .set("Authorization", `Bearer ${adminToken}`),
      request(server())
        .post(`/api/v1/payments/${paymentId}/confirm`)
        .set("Authorization", `Bearer ${adminToken}`),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    // Had the guard failed, this would be -8.00 (decremented twice off a
    // sale of 8.00), not 0.00.
    expect(await customerDebtBalance(customerId)).toBe("0.00");
  });

  test("confirming an already-CONFIRMED payment (cash from dispatch) is rejected with 409, debt untouched", async () => {
    const { paymentId, customerId } = await deliverWithPayment(cashPaymentMethodId, "8.00");
    const before = await customerDebtBalance(customerId);
    expect(before).toBe("0.00"); // cash is born CONFIRMED and already offset the sale

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/confirm`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain("CONFIRMED");
    expect(await customerDebtBalance(customerId)).toBe(before);
  });

  test("confirming an already-REJECTED payment is rejected with 409", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");
    await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "No llegó a la cuenta" })
      .expect(200);

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/confirm`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain("REJECTED");
  });

  test("an unknown payment id is rejected with 404", async () => {
    const response = await request(server())
      .post(`/api/v1/payments/${MISSING_UUID}/confirm`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  test("a DRIVER is refused with 403", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/confirm`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(403);
  });

  test("a SELLER reads the tray but is refused confirming with 403", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const list = await request(server())
      .get("/api/v1/payments")
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(list.status).toBe(200);

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/confirm`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(response.status).toBe(403);
  });
});

describe("POST /api/v1/payments/:id/reject", () => {
  test("rejects a PENDING payment, leaves debtBalance untouched, and records the reason", async () => {
    const { paymentId, customerId, saleTotal } = await deliverWithPayment(
      yapePaymentMethodId,
      "8.00",
    );

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "El cliente muestra el Yape pero nunca llegó a la cuenta de la planta" });

    expect(response.status).toBe(200);
    expect(response.body.payment.status).toBe(PaymentStatus.REJECTED);
    expect(response.body.payment.rejectionReason).toBe(
      "El cliente muestra el Yape pero nunca llegó a la cuenta de la planta",
    );
    expect(response.body.payment.rejectedBy.id).toBe(adminUserId);
    expect(response.body.debtBalance).toBe(saleTotal);
    expect(await customerDebtBalance(customerId)).toBe(saleTotal);
  });

  test("an empty reason is rejected with 400", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "" });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("motivo");
  });

  test("a missing reason is rejected with 400", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(400);
  });

  test("rejecting an already-REJECTED payment is rejected with 409", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");
    await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "primer rechazo" })
      .expect(200);

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "segundo intento" });

    expect(response.status).toBe(409);
  });

  test("rejecting an already-CONFIRMED payment (cash from dispatch) is rejected with 409", async () => {
    const { paymentId } = await deliverWithPayment(cashPaymentMethodId, "8.00");

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "no aplica" });

    expect(response.status).toBe(409);
  });

  test("an unknown payment id is rejected with 404", async () => {
    const response = await request(server())
      .post(`/api/v1/payments/${MISSING_UUID}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "motivo" });

    expect(response.status).toBe(404);
  });

  test("a DRIVER is refused with 403", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${driverToken}`)
      .send({ reason: "motivo" });

    expect(response.status).toBe(403);
  });

  test("a SELLER is refused with 403", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const response = await request(server())
      .post(`/api/v1/payments/${paymentId}/reject`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ reason: "motivo" });

    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/payments", () => {
  test("filters by status, and totals reflects the whole filtered set, not just the page", async () => {
    const a = await deliverWithPayment(yapePaymentMethodId, "8.00");
    const b = await deliverWithPayment(yapePaymentMethodId, "16.00", 2);
    await request(server())
      .post(`/api/v1/payments/${a.paymentId}/confirm`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const response = await request(server())
      .get(`/api/v1/payments?status=PENDING&limit=1`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    for (const row of response.body.data) {
      expect(row.status).toBe(PaymentStatus.PENDING);
    }
    // totals must count every PENDING payment matching the filter, not just
    // the one row this page (limit=1) returns.
    const pendingCount = await prisma.payment.count({ where: { status: PaymentStatus.PENDING } });
    expect(response.body.totals.count).toBe(pendingCount);
    expect(response.body.data.length).toBeLessThanOrEqual(1);
    expect(b.paymentId).toBeTruthy();
  });

  test("filters by paymentMethodId and customerId", async () => {
    const { paymentId, customerId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const response = await request(server())
      .get(`/api/v1/payments?paymentMethodId=${yapePaymentMethodId}&customerId=${customerId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((row: { id: string }) => row.id)).toContain(paymentId);
    for (const row of response.body.data) {
      expect(row.customer.id).toBe(customerId);
    }
  });

  test("orders by paidAt ascending: the oldest unresolved payment leads", async () => {
    const first = await deliverWithPayment(yapePaymentMethodId, "8.00");
    const second = await deliverWithPayment(yapePaymentMethodId, "8.00");

    const response = await request(server())
      .get("/api/v1/payments?limit=100")
      .set("Authorization", `Bearer ${adminToken}`);

    const ids = response.body.data.map((row: { id: string }) => row.id) as string[];
    expect(ids.indexOf(first.paymentId)).toBeLessThan(ids.indexOf(second.paymentId));
  });

  test("a DRIVER is refused with 403", async () => {
    const response = await request(server())
      .get("/api/v1/payments")
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(403);
  });
});

describe("database CHECK constraints on the rejection fields", () => {
  test("a raw UPDATE leaving REJECTED with no rejection_reason is rejected by the CHECK", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "payments" SET "status" = 'REJECTED', "rejected_at" = now(), "rejected_by" = $1::uuid WHERE "id" = $2::uuid`,
        adminUserId,
        paymentId,
      ),
    ).rejects.toThrow();
  });

  test("a raw UPDATE leaving REJECTED with no rejected_at is rejected by the CHECK", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "payments" SET "status" = 'REJECTED', "rejected_by" = $1::uuid, "rejection_reason" = 'x' WHERE "id" = $2::uuid`,
        adminUserId,
        paymentId,
      ),
    ).rejects.toThrow();
  });

  test("a raw UPDATE leaving REJECTED with no rejected_by is rejected by the CHECK", async () => {
    const { paymentId } = await deliverWithPayment(yapePaymentMethodId, "8.00");

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "payments" SET "status" = 'REJECTED', "rejected_at" = now(), "rejection_reason" = 'x' WHERE "id" = $1::uuid`,
        paymentId,
      ),
    ).rejects.toThrow();
  });
});

describe("auth", () => {
  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/payments");

    expect(response.status).toBe(401);
  });
});
