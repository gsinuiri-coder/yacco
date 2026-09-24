import request from "supertest";
import { PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// Reportes post-MVP de la spec (§2.4): HU-19 deuda por cliente, HU-20 envases
// prestados, HU-21 producción por período. Solo lectura, solo ADMIN.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let sellerToken: string;
let adminId: string;
let cashMethodId: string;
let containerTypeA: { id: string; name: string };
let containerTypeB: { id: string; name: string };

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

let phoneSeq = 0;
/** Un cliente nuevo por la API, con su locación principal. */
async function createCustomer(name: string): Promise<{ id: string; locationId: string }> {
  phoneSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name,
      phone: `98710${String(phoneSeq).padStart(4, "0")}`,
      address: "Av. Reportes 1",
      addressReference: "Portón azul",
    })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id, isPrimary: true },
  });
  return { id: customer.body.id, locationId: location.id };
}

/**
 * Las ventas y los cobros son la ENTRADA del reporte, no lo que el reporte
 * produce: se escriben tal cual para fijar fechas exactas, que es lo que el
 * reporte tiene que leer.
 */
async function sale(locationId: string, soldAt: string, total: string, voided = false) {
  await prisma.sale.create({
    data: {
      locationId,
      soldAt: new Date(soldAt),
      total: new Prisma.Decimal(total),
      recordedById: adminId,
      ...(voided
        ? { voidedAt: new Date(soldAt), voidedById: adminId, voidReason: "mal anotada" }
        : {}),
    },
  });
}

async function payment(
  customerId: string,
  paidAt: string,
  amount: string,
  status: PaymentStatus = PaymentStatus.CONFIRMED,
) {
  await prisma.payment.create({
    data: {
      customerId,
      paymentMethodId: cashMethodId,
      paidAt: new Date(paidAt),
      amount: new Prisma.Decimal(amount),
      status,
      recordedById: adminId,
      // Un cobro confirmado lleva cuándo y quién (CHECK de la tabla).
      ...(status === PaymentStatus.CONFIRMED
        ? { confirmedAt: new Date(paidAt), confirmedById: adminId }
        : {}),
    },
  });
}

function get(path: string, token = adminToken) {
  return request(server()).get(`/api/v1/reports/${path}`).set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  adminId = (await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } })).id;
  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Vendedor reportes",
      username: "vendedor-reportes",
      password: "vendedor-reportes-password",
      roles: ["SELLER"],
    })
    .expect(201);
  sellerToken = await login("vendedor-reportes", "vendedor-reportes-password");
  cashMethodId = (await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } })).id;
  const types = await prisma.containerType.findMany({ orderBy: { name: "asc" } });
  containerTypeA = { id: types[0]!.id, name: types[0]!.name };
  containerTypeB = { id: types[1]!.id, name: types[1]!.name };
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/reports/debt (HU-19)", () => {
  test("deuda por cliente, total general y fecha del cargo más antiguo que sigue abierto", async () => {
    // Ana: un cargo ANULADO el 1/9 que no cuenta; debe desde el 3/9. Un cobro
    // PENDIENTE no la baja. Deuda 30.00 + 20.50 = 50.50.
    const ana = await createCustomer("Ana Reportes");
    await sale(ana.locationId, "2026-09-01T15:00:00Z", "99.00", true);
    await sale(ana.locationId, "2026-09-03T15:00:00Z", "30.00");
    await sale(ana.locationId, "2026-09-10T15:00:00Z", "20.50");
    await payment(ana.id, "2026-09-11T15:00:00Z", "10.00", PaymentStatus.PENDING);

    // Beto: llegó a cero el 5/9 (pagó todo lo del 2/9); lo que debe hoy nace
    // el 7/9. Deuda 12.00.
    const beto = await createCustomer("Beto Reportes");
    await sale(beto.locationId, "2026-09-02T15:00:00Z", "40.00");
    await payment(beto.id, "2026-09-05T15:00:00Z", "40.00");
    await sale(beto.locationId, "2026-09-07T15:00:00Z", "12.00");

    // Carla: al día. No aparece.
    const carla = await createCustomer("Carla Reportes");
    await sale(carla.locationId, "2026-09-04T15:00:00Z", "25.00");
    await payment(carla.id, "2026-09-06T15:00:00Z", "25.00");

    // Dani: un cargo a las 23:30 de Lima del 8/9, que en UTC ya es el 9/9.
    const dani = await createCustomer("Dani Reportes");
    await sale(dani.locationId, "2026-09-09T04:30:00Z", "7.25");

    const response = await get("debt");

    expect(response.status).toBe(200);
    expect(response.body.rows).toEqual([
      expect.objectContaining({
        customer: expect.objectContaining({ id: ana.id, name: "Ana Reportes" }),
        debt: "50.50",
        oldestChargeDate: "2026-09-03",
      }),
      expect.objectContaining({
        customer: expect.objectContaining({ id: beto.id }),
        debt: "12.00",
        oldestChargeDate: "2026-09-07",
      }),
      expect.objectContaining({
        customer: expect.objectContaining({ id: dani.id }),
        debt: "7.25",
        oldestChargeDate: "2026-09-08",
      }),
    ]);
    expect(response.body.total).toBe("69.75");
  });

  test("solo ADMIN", async () => {
    await get("debt", sellerToken).expect(403);
  });
});

describe("GET /api/v1/reports/loaned-containers (HU-20)", () => {
  function movement(body: Record<string, unknown>) {
    return request(server())
      .post("/api/v1/container-movements")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
  }
  function loan(locationId: string, containerTypeId: string, quantity: number) {
    return movement({
      type: "LOAN_DELIVERY",
      containerTypeId,
      fromState: "FULL_ON_ROUTE",
      toState: "WITH_CUSTOMER",
      locationId,
      quantity,
    });
  }
  function pickup(locationId: string, containerTypeId: string, quantity: number) {
    return movement({
      type: "EMPTY_PICKUP",
      containerTypeId,
      fromState: "WITH_CUSTOMER",
      toState: "EMPTY_ON_ROUTE",
      locationId,
      quantity,
    });
  }

  test("saldo por cliente y tipo, y el total cuadra con «en poder del cliente» del parque", async () => {
    const eli = await createCustomer("Eli Envases");
    await loan(eli.locationId, containerTypeA.id, 7);
    await pickup(eli.locationId, containerTypeA.id, 2);
    const fito = await createCustomer("Fito Envases");
    await loan(fito.locationId, containerTypeA.id, 3);
    await loan(fito.locationId, containerTypeB.id, 4);
    // Gina devolvió todo: saldo cero, no figura.
    const gina = await createCustomer("Gina Envases");
    await loan(gina.locationId, containerTypeB.id, 2);
    await pickup(gina.locationId, containerTypeB.id, 2);

    const response = await get("loaned-containers");

    expect(response.status).toBe(200);
    const rows = response.body.rows as Array<{
      customer: { id: string };
      containerType: { id: string };
      quantity: number;
    }>;
    const find = (customerId: string, typeId: string) =>
      rows.find((row) => row.customer.id === customerId && row.containerType.id === typeId)
        ?.quantity;
    expect(find(eli.id, containerTypeA.id)).toBe(5);
    expect(find(fito.id, containerTypeA.id)).toBe(3);
    expect(find(fito.id, containerTypeB.id)).toBe(4);
    expect(rows.some((row) => row.customer.id === gina.id)).toBe(false);

    // La comparación que pide HU-20: el total del reporte, tipo por tipo,
    // contra el estado WITH_CUSTOMER del inventario, que se lee del libro.
    const inventory = await request(server())
      .get("/api/v1/container-movements/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const withCustomer = (typeId: string) =>
      (inventory.body as Array<{ containerTypeId: string; state: string; quantity: number }>).find(
        (item) => item.containerTypeId === typeId && item.state === "WITH_CUSTOMER",
      )?.quantity ?? 0;
    const byType = response.body.byType as Array<{
      containerType: { id: string };
      quantity: number;
    }>;
    const reportOf = (typeId: string) =>
      byType.find((line) => line.containerType.id === typeId)?.quantity ?? 0;
    expect(reportOf(containerTypeA.id)).toBe(8);
    expect(reportOf(containerTypeA.id)).toBe(withCustomer(containerTypeA.id));
    expect(reportOf(containerTypeB.id)).toBe(withCustomer(containerTypeB.id));
    expect(response.body.total).toBe(
      withCustomer(containerTypeA.id) + withCustomer(containerTypeB.id),
    );
    expect(response.body.total).toBe(12);
  });

  test("solo ADMIN", async () => {
    await get("loaned-containers", sellerToken).expect(403);
  });
});

describe("GET /api/v1/reports/production (HU-21)", () => {
  async function batch(code: string, date: string, items: Array<[string, number]>) {
    await request(server())
      .post("/api/v1/production-batches")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code,
        date,
        items: items.map(([containerTypeId, producedQty]) => ({ containerTypeId, producedQty })),
      })
      .expect(201);
  }

  test("cantidades producidas por tipo y por lote, solo dentro del rango", async () => {
    await batch("REP-JUL-01", "2026-07-01", [
      [containerTypeA.id, 10],
      [containerTypeB.id, 5],
    ]);
    await batch("REP-JUL-31", "2026-07-31", [[containerTypeA.id, 3]]);
    await batch("REP-AGO-01", "2026-08-01", [[containerTypeA.id, 100]]);
    await batch("REP-JUN-30", "2026-06-30", [[containerTypeB.id, 50]]);

    const response = await get("production?dateFrom=2026-07-01&dateTo=2026-07-31");

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(18);
    expect(response.body.byType).toEqual(
      expect.arrayContaining([
        { containerType: containerTypeA, producedQty: 13 },
        { containerType: containerTypeB, producedQty: 5 },
      ]),
    );
    expect(response.body.byType).toHaveLength(2);
    expect(
      (response.body.batches as Array<{ code: string; date: string; total: number }>).map((row) => [
        row.code,
        row.date,
        row.total,
      ]),
    ).toEqual([
      ["REP-JUL-01", "2026-07-01", 15],
      ["REP-JUL-31", "2026-07-31", 3],
    ]);
  });

  test("el rango es obligatorio y no puede estar al revés", async () => {
    await get("production").expect(400);
    await get("production?dateFrom=2026-07-31&dateTo=2026-07-01").expect(400);
  });

  test("solo ADMIN", async () => {
    await get("production?dateFrom=2026-07-01&dateTo=2026-07-31", sellerToken).expect(403);
  });
});
