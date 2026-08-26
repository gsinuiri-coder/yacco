import request from "supertest";
import { RouteStatus, StopOrigin, StopStatus } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// HU-17 (spec §2.4 Épica C): "Dado una ruta finalizada, cuando la liquido,
// entonces el sistema concilia: llenos salidos = entregados + vendidos
// completos + retornados; vacíos recogidos = descargados; total vendido =
// cobrado + fiado; y toda diferencia queda registrada." — never blocks on a
// mismatch, never blocks on a payment still PENDING.

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
let sellerToken: string;
let driverToken: string;
let driverId: string;
let zoneId: string;
let containerTypeId: string;
let refillProductId: string;
let containerSaleProductId: string;
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

let customerSeq = 0;
async function createFreshLocation(): Promise<{ customerId: string; locationId: string }> {
  customerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Liquidación ${customerSeq}`,
      phone: `98700${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Liquidación 1",
      addressReference: "Casa celeste",
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
      code: `LOTE-LIQUIDACION-${batchCounter}`,
      date: "2026-08-01",
      items: [{ containerTypeId, producedQty }],
    })
    .expect(201);
  return response.body.items[0].id;
}

async function createRoute(): Promise<string> {
  const response = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ driverId, date: nextDate(), zoneId })
    .expect(201);
  return response.body.id;
}

async function addLoad(routeId: string, batchItemId: string, quantity: number): Promise<void> {
  await request(server())
    .post(`/api/v1/routes/${routeId}/loads`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ batchItemId, quantity })
    .expect(201);
}

async function addStop(routeId: string, locationId: string): Promise<string> {
  const response = await request(server())
    .post(`/api/v1/routes/${routeId}/stops`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ origin: StopOrigin.VAN_SALE, locationId })
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

async function deliverStop(
  routeId: string,
  stopId: string,
  body: Record<string, unknown>,
): Promise<request.Test> {
  return request(server())
    .patch(`/api/v1/routes/${routeId}/stops/${stopId}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: StopStatus.DELIVERED, ...body });
}

function getSettlement(routeId: string, token = adminToken): request.Test {
  return request(server())
    .get(`/api/v1/routes/${routeId}/settlement`)
    .set("Authorization", `Bearer ${token}`);
}

function postSettlement(
  routeId: string,
  body: Record<string, unknown>,
  token = adminToken,
): request.Test {
  return request(server())
    .post(`/api/v1/routes/${routeId}/settlement`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

/** A fresh FINISHED route with one delivered stop and no payment — enough
 * to settle, without caring about the exact money/container numbers. */
async function freshFinishedRoute(): Promise<{ routeId: string }> {
  const { locationId } = await createFreshLocation();
  const batchItemId = await createBatchItem(5);
  const routeId = await createRoute();
  await addLoad(routeId, batchItemId, 5);
  const stopId = await addStop(routeId, locationId);
  await startRoute(routeId);
  await deliverStop(routeId, stopId, { items: [{ productId: refillProductId, quantity: 2 }] }).then(
    (r) => expect(r.status).toBe(200),
  );
  await finishRoute(routeId);
  return { routeId };
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } });
  adminUserId = admin.id;
  sellerToken = (await createUserAndLogin("vendedor-liquidacion", "SELLER")).token;
  const driver = await createUserAndLogin("repartidor-liquidacion", "DRIVER");
  driverToken = driver.token;
  driverId = driver.id;

  const zone = await request(server())
    .post("/api/v1/zones")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Zona Liquidación" })
    .expect(201);
  zoneId = zone.body.id;

  const containerType = await prisma.containerType.findFirstOrThrow({
    where: { name: "Con caño" },
  });
  containerTypeId = containerType.id;
  const refill = await prisma.product.create({
    data: {
      containerTypeId,
      name: "Recarga 20L (liquidación)",
      type: "REFILL",
      listPrice: "8.00",
    },
  });
  refillProductId = refill.id;
  const containerSale = await prisma.product.create({
    data: {
      containerTypeId,
      name: "Bidón 20L (liquidación)",
      type: "CONTAINER_SALE",
      listPrice: "30.00",
    },
  });
  containerSaleProductId = containerSale.id;

  cashPaymentMethodId = (
    await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } })
  ).id;
  yapePaymentMethodId = (await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Yape" } }))
    .id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("full reconciliation: LOAN_DELIVERY + FULL_SALE + a rejected payment", () => {
  test("cuadra exacto: differences en cero, la identidad de envases se cumple, y REJECTED no cuenta", async () => {
    const a = await createFreshLocation();
    const b = await createFreshLocation();
    const c = await createFreshLocation();
    const batchItemId = await createBatchItem(10);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 10);
    const stopA = await addStop(routeId, a.locationId);
    const stopB = await addStop(routeId, b.locationId);
    const stopC = await addStop(routeId, c.locationId);
    await startRoute(routeId);

    // Stop A: 3 refills at a price override (8.33 instead of 8.00, so the
    // totals below are never round numbers), canje completo (3 returned),
    // paid partially in cash (20.00 of 24.99) -> CONFIRMED.
    const deliverA = await deliverStop(routeId, stopA, {
      items: [{ productId: refillProductId, quantity: 3, unitPrice: "8.33" }],
      priceOverrideAuthorizedById: adminUserId,
      containersReturned: [{ containerTypeId, quantity: 3 }],
      payment: { paymentMethodId: cashPaymentMethodId, amount: "20.00" },
    });
    expect(deliverA.status).toBe(200);
    expect(deliverA.body.sale.total).toBe("24.99");

    // Stop B: 2 bidones (FULL_SALE, leaves the fleet) at list price, paid by
    // Yape -> PENDING, still counts in totalCollected but not in cash.
    const deliverB = await deliverStop(routeId, stopB, {
      items: [{ productId: containerSaleProductId, quantity: 2 }],
      payment: { paymentMethodId: yapePaymentMethodId, amount: "60.00" },
    });
    expect(deliverB.status).toBe(200);
    expect(deliverB.body.payment.status).toBe("PENDING");

    // Stop C: 1 refill, no canje (envase queda de deuda), paid by Yape ->
    // PENDING, then REJECTED before the route even finishes: this money
    // never counts anywhere in the settlement.
    const deliverC = await deliverStop(routeId, stopC, {
      items: [{ productId: refillProductId, quantity: 1 }],
      payment: { paymentMethodId: yapePaymentMethodId, amount: "8.00" },
    });
    expect(deliverC.status).toBe(200);
    await request(server())
      .post(`/api/v1/payments/${deliverC.body.payment.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "El Yape nunca llegó a la cuenta" })
      .expect(200);

    await finishRoute(routeId);

    // fullOut=10, fullDelivered=3(A)+1(C)=4, fullSold=2(B) -> fullReturned=4
    // for the identity to hold exactly. emptiesCollected ledger = 3 (only A
    // returned containers) -> entering 3 matches exactly too.
    const response = await postSettlement(routeId, { fullReturned: 4, emptiesCollected: 3 });

    expect(response.status).toBe(201);
    expect(response.body.differences).toEqual({ containers: 0, empties: 0 });

    const settlement = response.body.settlement;
    expect(settlement.fullOut).toBe(10);
    expect(settlement.fullDelivered).toBe(4);
    expect(settlement.fullSold).toBe(2);
    expect(settlement.fullReturned).toBe(4);
    expect(settlement.emptiesCollected).toBe(3);
    // 24.99 + 60.00 + 8.00 (the rejected sale still happened and still counts
    // as sold, even though its payment does not)
    expect(settlement.totalSold).toBe("92.99");
    // 20.00 cash + 60.00 Yape-pending; the REJECTED 8.00 never lands here
    expect(settlement.totalCollected).toBe("80.00");
    expect(settlement.totalCashCollected).toBe("20.00");
    expect(settlement.totalPendingConfirmation).toBe("60.00");
    expect(settlement.totalOnCredit).toBe("12.99");
    expect(settlement.settledById).toBe(adminUserId);
    // totalSold = totalCollected + totalOnCredit, exactly, with cents
    expect((Number(settlement.totalCollected) + Number(settlement.totalOnCredit)).toFixed(2)).toBe(
      settlement.totalSold,
    );

    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe(RouteStatus.SETTLED);
  });
});

describe("a container shortfall settles anyway and reports it", () => {
  test("liquida igual con un faltante de envases", async () => {
    const { locationId } = await createFreshLocation();
    const batchItemId = await createBatchItem(5);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 5);
    const stopId = await addStop(routeId, locationId);
    await startRoute(routeId);
    await deliverStop(routeId, stopId, {
      items: [{ productId: refillProductId, quantity: 3 }],
    }).then((r) => expect(r.status).toBe(200));
    await finishRoute(routeId);

    // fullOut=5, fullDelivered=3, fullSold=0 -> a matching fullReturned would
    // be 2; entering 0 leaves a shortfall of 2 unaccounted for.
    const response = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: 0 });

    expect(response.status).toBe(201);
    expect(response.body.differences.containers).toBe(2);

    const route = await prisma.route.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.status).toBe(RouteStatus.SETTLED);
  });
});

describe("idempotency and route state guards", () => {
  test("a second POST is rejected with 409 and only one settlement row exists", async () => {
    const { routeId } = await freshFinishedRoute();

    const first = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: 0 });
    expect(first.status).toBe(201);

    const second = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: 0 });
    expect(second.status).toBe(409);

    const count = await prisma.routeSettlement.count({ where: { routeId } });
    expect(count).toBe(1);
  });

  test("a route still IN_PROGRESS is rejected with 409", async () => {
    const { locationId } = await createFreshLocation();
    const routeId = await createRoute();
    await addStop(routeId, locationId);
    await startRoute(routeId);

    const response = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: 0 });

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain("IN_PROGRESS");
  });

  test("a route still PLANNED is rejected with 409", async () => {
    const routeId = await createRoute();

    const response = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: 0 });

    expect(response.status).toBe(409);
    expect(messagesOf(response)).toContain("PLANNED");
  });

  test("an unknown route is rejected with 404 on both GET and POST", async () => {
    const getResponse = await getSettlement(MISSING_UUID);
    expect(getResponse.status).toBe(404);

    const postResponse = await postSettlement(MISSING_UUID, {
      fullReturned: 0,
      emptiesCollected: 0,
    });
    expect(postResponse.status).toBe(404);
  });
});

describe("validation", () => {
  test("a negative fullReturned is rejected with 400", async () => {
    const { routeId } = await freshFinishedRoute();

    const response = await postSettlement(routeId, { fullReturned: -1, emptiesCollected: 0 });

    expect(response.status).toBe(400);
  });

  test("a non-integer emptiesCollected is rejected with 400", async () => {
    const { routeId } = await freshFinishedRoute();

    const response = await postSettlement(routeId, { fullReturned: 0, emptiesCollected: 2.5 });

    expect(response.status).toBe(400);
  });
});

describe("roles", () => {
  test("a DRIVER is refused with 403 on POST", async () => {
    const { routeId } = await freshFinishedRoute();

    const response = await postSettlement(
      routeId,
      { fullReturned: 0, emptiesCollected: 0 },
      driverToken,
    );

    expect(response.status).toBe(403);
  });

  test("a SELLER can read the settlement screen but not settle it", async () => {
    const { routeId } = await freshFinishedRoute();

    const read = await getSettlement(routeId, sellerToken);
    expect(read.status).toBe(200);

    const write = await postSettlement(
      routeId,
      { fullReturned: 0, emptiesCollected: 0 },
      sellerToken,
    );
    expect(write.status).toBe(403);
  });
});

describe("GET .../settlement before and after settling", () => {
  test("before: expected is populated and settlement is null; after: both are", async () => {
    const { routeId } = await freshFinishedRoute();

    const before = await getSettlement(routeId);
    expect(before.status).toBe(200);
    expect(before.body.settlement).toBeNull();
    expect(before.body.expected.fullOut).toBe(5);
    expect(before.body.expected.fullDelivered).toBe(2);

    await postSettlement(routeId, { fullReturned: 3, emptiesCollected: 0 }).then((r) =>
      expect(r.status).toBe(201),
    );

    const after = await getSettlement(routeId);
    expect(after.status).toBe(200);
    expect(after.body.settlement).not.toBeNull();
    expect(after.body.settlement.fullReturned).toBe(3);
    expect(after.body.expected.fullOut).toBe(5);
  });

  test("unresolvedStops counts PENDING stops on the route", async () => {
    const a = await createFreshLocation();
    const b = await createFreshLocation();
    const batchItemId = await createBatchItem(5);
    const routeId = await createRoute();
    await addLoad(routeId, batchItemId, 5);
    const stopA = await addStop(routeId, a.locationId);
    await addStop(routeId, b.locationId);
    await startRoute(routeId);
    await deliverStop(routeId, stopA, {
      items: [{ productId: refillProductId, quantity: 1 }],
    }).then((r) => expect(r.status).toBe(200));

    const response = await getSettlement(routeId);

    expect(response.status).toBe(200);
    expect(response.body.unresolvedStops).toBe(1);
  });
});

describe("auth", () => {
  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get(`/api/v1/routes/${MISSING_UUID}/settlement`);

    expect(response.status).toBe(401);
  });
});
