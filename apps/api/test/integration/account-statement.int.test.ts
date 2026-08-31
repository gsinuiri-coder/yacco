import { Prisma } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// HU-18 E1 (spec §2.4): "Dado un cliente con deuda, cuando registro un abono
// en la web, entonces su deuda disminuye y el abono aparece en el estado de
// cuenta." This suite covers the second clause — the first is already
// covered by payments.int.test.ts.

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

let customerSeq = 0;
async function createFreshLocation(): Promise<{ customerId: string; locationId: string }> {
  customerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Estado de Cuenta ${customerSeq}`,
      phone: `98800${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Estado de Cuenta 1",
      addressReference: "Portón amarillo",
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  return { customerId: customer.body.id, locationId: location.id };
}

let batchCounter = 0;
/**
 * Cada lote nace UN DÍA MÁS VIEJO que el anterior, a propósito. `POST
 * /routes/:id/loads` exige el lote más antiguo con unidades disponibles de
 * ese tipo de envase (FIFO), y estos tests comparten un único
 * `containerTypeId`: con una fecha fija, el sobrante de un test anterior
 * sería la cabeza del FIFO y toda carga posterior se rechazaría. Fechándolos
 * hacia atrás, el lote recién creado es siempre el que la regla manda cargar,
 * que es justo lo que cada test quiere decir al pedirlo.
 *
 * La aritmética va en UTC, igual que `parseBusinessDate`/`formatBusinessDate`
 * de la API: construirla con partes locales dejaría que la zona horaria de
 * quien corre los tests corriera el día.
 */
function nextBatchDate(): string {
  const base = Date.UTC(2026, 7, 1);
  return new Date(base - batchCounter * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
async function createBatchItem(producedQty: number): Promise<string> {
  batchCounter += 1;
  const response = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      code: `LOTE-ESTADO-CUENTA-${batchCounter}`,
      date: nextBatchDate(),
      items: [{ containerTypeId, producedQty }],
    })
    .expect(201);
  return response.body.items[0].id;
}

/** Delivers `quantity` refills at `locationId` (fresh route/stop each call),
 * optionally with a payment, and returns the created sale/payment ids. */
async function deliver(
  locationId: string,
  quantity: number,
  payment?: { paymentMethodId: string; amount: string },
): Promise<{ saleId: string; paymentId: string | null; total: string }> {
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
      ...(payment !== undefined ? { payment } : {}),
    });
  expect(delivered.status).toBe(200);

  return {
    saleId: delivered.body.sale.id,
    paymentId: delivered.body.payment?.id ?? null,
    total: delivered.body.sale.total,
  };
}

async function officePayment(
  customerId: string,
  paymentMethodId: string,
  amount: string,
): Promise<string> {
  const response = await request(server())
    .post("/api/v1/payments")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ customerId, paymentMethodId, amount })
    .expect(201);
  return response.body.payment.id;
}

async function confirmPayment(paymentId: string): Promise<void> {
  await request(server())
    .post(`/api/v1/payments/${paymentId}/confirm`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
}

async function rejectPayment(paymentId: string): Promise<void> {
  await request(server())
    .post(`/api/v1/payments/${paymentId}/reject`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ reason: "El Yape nunca llegó a la cuenta" })
    .expect(200);
}

async function customerDebtBalance(id: string): Promise<string> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });
  return customer.debtBalance.toFixed(2);
}

function getStatement(customerId: string, query = ""): request.Test {
  return request(server())
    .get(`/api/v1/customers/${customerId}/account-statement${query}`)
    .set("Authorization", `Bearer ${adminToken}`);
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  adminUserId = (await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } })).id;
  const driver = await createUserAndLogin("repartidor-estado-cuenta", "DRIVER");
  driverToken = driver.token;
  driverId = driver.id;

  const zone = await request(server())
    .post("/api/v1/zones")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Zona Estado de Cuenta" })
    .expect(201);
  zoneId = zone.body.id;

  const containerType = await prisma.containerType.findFirstOrThrow({
    where: { name: "Con caño" },
  });
  containerTypeId = containerType.id;
  const product = await prisma.product.create({
    data: {
      containerTypeId,
      name: "Recarga 20L (estado de cuenta)",
      type: "REFILL",
      listPrice: "8.33",
    },
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

describe("the reconstruction invariant: closingBalance matches customers.debtBalance", () => {
  test("across several sales and payments (CONFIRMED, PENDING, office, opening not involved)", async () => {
    const { customerId, locationId } = await createFreshLocation();

    // Charge 1: 3 units at 8.33 = 24.99, no payment (stays as debt).
    await deliver(locationId, 3);
    // Charge 2: 2 units at 8.33 = 16.66, paid in full by cash -> CONFIRMED.
    await deliver(locationId, 2, { paymentMethodId: cashPaymentMethodId, amount: "16.66" });
    // Charge 3: 1 unit at 8.33 = 8.33, paid by Yape -> PENDING, confirmed later.
    const charge3 = await deliver(locationId, 1, {
      paymentMethodId: yapePaymentMethodId,
      amount: "8.33",
    });
    await confirmPayment(charge3.paymentId as string);
    // An office collection on top of the remaining debt.
    await officePayment(customerId, cashPaymentMethodId, "10.00");

    const debtBalance = await customerDebtBalance(customerId);
    const response = await getStatement(customerId);

    expect(response.status).toBe(200);
    expect(response.body.closingBalance).toBe(debtBalance);
    expect(response.body.customer.debtBalance).toBe(debtBalance);
  });
});

describe("PENDING and REJECTED payments appear but do not move the balance", () => {
  test("a PENDING Yape shows up with runningBalance unchanged from the charge before it", async () => {
    const { locationId } = await createFreshLocation();
    const { paymentId } = await deliver(locationId, 1, {
      paymentMethodId: yapePaymentMethodId,
      amount: "8.33",
    });

    const response = await getStatement(
      (await prisma.customerLocation.findUniqueOrThrow({ where: { id: locationId } })).customerId,
    );

    expect(response.status).toBe(200);
    expect(response.body.entries).toHaveLength(2);
    const [charge, payment] = response.body.entries;
    expect(charge.type).toBe("CHARGE");
    expect(payment.type).toBe("PAYMENT");
    expect(payment.paymentId).toBe(paymentId);
    expect(payment.status).toBe("PENDING");
    expect(payment.runningBalance).toBe(charge.runningBalance);
  });

  test("a REJECTED Yape shows up with runningBalance unchanged, and confirming a fresh one moves it", async () => {
    const { customerId, locationId } = await createFreshLocation();
    const { paymentId } = await deliver(locationId, 1, {
      paymentMethodId: yapePaymentMethodId,
      amount: "8.33",
    });
    await rejectPayment(paymentId as string);

    const rejected = await getStatement(customerId);
    expect(rejected.body.entries).toHaveLength(2);
    const [charge, payment] = rejected.body.entries;
    expect(payment.status).toBe("REJECTED");
    expect(payment.runningBalance).toBe(charge.runningBalance);
    expect(rejected.body.closingBalance).toBe(charge.runningBalance);

    // A second delivery of the same amount, confirmed this time: its charge
    // (+8.33) and its own confirmed payment (-8.33) net to zero, so the
    // balance ends up back where the first (rejected) charge left it.
    const second = await deliver(locationId, 1, {
      paymentMethodId: yapePaymentMethodId,
      amount: "8.33",
    });
    await confirmPayment(second.paymentId as string);

    const afterConfirm = await getStatement(customerId);
    const lastEntry = afterConfirm.body.entries[afterConfirm.body.entries.length - 1];
    expect(lastEntry.status).toBe("CONFIRMED");
    expect(afterConfirm.body.closingBalance).toBe(charge.runningBalance);
  });
});

describe("entries interleave chronologically, not grouped by type", () => {
  test("a charge, an office payment, and another charge appear in that order", async () => {
    const { customerId, locationId } = await createFreshLocation();
    await deliver(locationId, 1);
    await officePayment(customerId, cashPaymentMethodId, "3.00");
    await deliver(locationId, 1);

    const response = await getStatement(customerId);

    const types = response.body.entries.map((entry: { type: string }) => entry.type);
    expect(types).toEqual(["CHARGE", "PAYMENT", "CHARGE"]);
  });
});

describe("date window with `from`", () => {
  test("openingBalance absorbs everything before the window, and closing still matches debtBalance", async () => {
    const { customerId, locationId } = await createFreshLocation();
    await deliver(locationId, 3); // 24.99, happens "now"

    // `from` set to tomorrow (Lima) puts every real-time delivery before the
    // window: entries is empty, and openingBalance carries the whole debt.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const debtBalance = await customerDebtBalance(customerId);

    const response = await getStatement(customerId, `?from=${tomorrow}`);

    expect(response.status).toBe(200);
    expect(response.body.entries).toEqual([]);
    expect(response.body.openingBalance).toBe(debtBalance);
    expect(response.body.closingBalance).toBe(debtBalance);
  });

  test("a `from` in the past includes today's activity and closingBalance still matches debtBalance", async () => {
    const { customerId, locationId } = await createFreshLocation();
    await deliver(locationId, 2);
    const debtBalance = await customerDebtBalance(customerId);

    const response = await getStatement(customerId, "?from=2020-01-01");

    expect(response.status).toBe(200);
    expect(response.body.openingBalance).toBe("0.00");
    expect(response.body.entries.length).toBeGreaterThan(0);
    expect(response.body.closingBalance).toBe(debtBalance);
  });
});

describe("a customer with no movements", () => {
  test("returns an empty statement at 0.00", async () => {
    const { customerId } = await createFreshLocation();

    const response = await getStatement(customerId);

    expect(response.status).toBe(200);
    expect(response.body.entries).toEqual([]);
    expect(response.body.openingBalance).toBe("0.00");
    expect(response.body.closingBalance).toBe("0.00");
  });
});

describe("validation and access", () => {
  test("an unknown customer is rejected with 404", async () => {
    const response = await getStatement(MISSING_UUID);

    expect(response.status).toBe(404);
  });

  test("a DRIVER is refused with 403", async () => {
    const { customerId } = await createFreshLocation();

    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/account-statement`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(403);
  });

  test("an invalid `from`/`to` combination is rejected with 400", async () => {
    const { customerId } = await createFreshLocation();

    const response = await getStatement(customerId, "?from=2026-08-31&to=2026-08-01");

    expect(response.status).toBe(400);
  });

  test("a limit above the maximum is rejected with 400", async () => {
    const { customerId } = await createFreshLocation();

    const response = await getStatement(customerId, "?limit=201");

    expect(response.status).toBe(400);
  });

  test("amounts and balances travel as 2-decimal strings", async () => {
    const { customerId, locationId } = await createFreshLocation();
    await deliver(locationId, 1);

    const response = await getStatement(customerId);

    expect(typeof response.body.openingBalance).toBe("string");
    expect(typeof response.body.closingBalance).toBe("string");
    expect(typeof response.body.customer.debtBalance).toBe("string");
    for (const entry of response.body.entries) {
      expect(typeof entry.amount).toBe("string");
      expect(typeof entry.runningBalance).toBe("string");
    }
  });
});

/**
 * Quien ESCRIBE una anulación es la operación de corrección, que todavía no
 * existe: acá el estado anulado se arma a mano, con un UPDATE que ningún
 * código de producción tiene permitido hacer. Es legítimo justamente porque lo
 * que se prueba es la aritmética de quien LEE el libro — y la base, que es la
 * que se niega a guardar una anulación a medias.
 */
describe("una venta y un cobro anulados", () => {
  async function markVoided(table: "sale" | "payment", id: string): Promise<Date> {
    const voidedAt = new Date();
    const data = { voidedAt, voidedById: adminUserId, voidReason: "Se anotó la parada equivocada" };
    if (table === "sale") {
      await prisma.sale.update({ where: { id }, data });
    } else {
      await prisma.payment.update({ where: { id }, data });
    }
    return voidedAt;
  }

  test("siguen apareciendo con su monto original, pero no mueven el saldo", async () => {
    const { customerId, locationId } = await createFreshLocation();
    const vigente = await deliver(locationId, 1);
    const anulada = await deliver(locationId, 3, {
      paymentMethodId: cashPaymentMethodId,
      amount: "5.00",
    });
    expect(anulada.paymentId).not.toBeNull();
    await markVoided("sale", anulada.saleId);
    await markVoided("payment", anulada.paymentId as string);

    const response = await getStatement(customerId);
    expect(response.status).toBe(200);

    const entries = response.body.entries as {
      saleId: string | null;
      paymentId: string | null;
      amount: string;
      runningBalance: string;
      voidedAt: string | null;
    }[];
    const vigenteEntry = entries.find((entry) => entry.saleId === vigente.saleId);
    const anuladaEntry = entries.find((entry) => entry.saleId === anulada.saleId);
    const cobroEntry = entries.find((entry) => entry.paymentId === anulada.paymentId);

    // Las tres filas se ven: nada se borra ni se esconde.
    expect(vigenteEntry?.voidedAt).toBeNull();
    expect(anuladaEntry?.voidedAt).not.toBeNull();
    expect(cobroEntry?.voidedAt).not.toBeNull();
    // Con su monto original, no en cero.
    expect(anuladaEntry?.amount).toBe(anulada.total);
    expect(cobroEntry?.amount).toBe("5.00");
    // Y el saldo reconstruido es solo el de la venta vigente.
    expect(response.body.closingBalance).toBe(vigente.total);
    expect(anuladaEntry?.runningBalance).toBe(vigente.total);
    expect(cobroEntry?.runningBalance).toBe(vigente.total);

    // Y acá se ve lo que a este PR le falta para ser la feature entera.
    // `debtBalance` sigue arrastrando la venta y el cobro anulados, porque
    // este test los anuló a mano y un UPDATE no es la operación de
    // corrección. La divergencia se afirma a propósito, en vez de dejarse
    // pasar: es el trabajo del PR 2, que tiene que mover `debtBalance` en la
    // MISMA transacción que escribe la anulación — el saldo materializado
    // siempre reconstruible desde su ledger (CLAUDE.md). El día que exista,
    // este expect se invierte a `toBe(response.body.closingBalance)`.
    expect(response.body.customer.debtBalance).not.toBe(response.body.closingBalance);
    expect(await customerDebtBalance(customerId)).toBe(
      new Prisma.Decimal(vigente.total).plus(anulada.total).minus("5.00").toFixed(2),
    );
  });

  test.each(["sale", "payment"] as const)(
    "la base rechaza una anulación de %s sin razón: las tres columnas van juntas",
    async (table) => {
      const { locationId } = await createFreshLocation();
      const { saleId, paymentId } = await deliver(locationId, 1, {
        paymentMethodId: cashPaymentMethodId,
        amount: "1.00",
      });
      const id = table === "sale" ? saleId : (paymentId as string);
      // Fecha y autor, sin razón: la fila quedaría anulada sin poder decir por
      // qué. El CHECK de la migración es quien lo impide, no la aplicación.
      const halfVoided = { voidedAt: new Date(), voidedById: adminUserId };

      const attempt =
        table === "sale"
          ? prisma.sale.update({ where: { id }, data: halfVoided })
          : prisma.payment.update({ where: { id }, data: halfVoided });

      await expect(attempt).rejects.toThrow(
        new RegExp(`${table === "sale" ? "sales" : "payments"}_voided_at_void_reason_check`),
      );
    },
  );
});
