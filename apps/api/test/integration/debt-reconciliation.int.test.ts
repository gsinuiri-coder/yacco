import request from "supertest";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SalesService } from "../../src/modules/sales/sales.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;
let adminId: string;
let sellerToken: string;
let driverToken: string;
let cashId: string;
let yapeId: string;
let customerSeq = 0;

function server() {
  return ctx.app.getHttpServer();
}

function prisma(): PrismaService {
  return ctx.app.get(PrismaService);
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
 * Un cliente con 40.00 de cargo de apertura (el camino real del padrón), un
 * cobro en efectivo de 15.00 (CONFIRMED) y un Yape de 10.00 que queda por
 * confirmar (PENDING). Su deuda es 25.00. El Yape pendiente está a propósito:
 * si el cuadre lo restara, este cliente aparecería descuadrado en 15.00.
 */
async function customerWithActivity(): Promise<{ id: string; name: string; locationId: string }> {
  customerSeq += 1;
  const name = `Cuadre Dinero ${customerSeq}`;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name,
      phone: `98700${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Cuadre 1",
      addressReference: "Portón azul",
    })
    .expect(201);
  await ctx.app
    .get(SalesService)
    .createOpeningCharge(
      { customerId: customer.body.id, amount: "40.00", soldAt: new Date("2026-09-01T15:00:00Z") },
      adminId,
    );
  await request(server())
    .post("/api/v1/payments")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ customerId: customer.body.id, paymentMethodId: cashId, amount: "15.00" })
    .expect(201);
  // Un Yape cobrado en la calle queda PENDING hasta que la oficina lo ve
  // llegar, y mientras tanto no toca la deuda. La oficina solo registra
  // cobros ya confirmados, así que la fila se escribe como la deja una parada.
  await prisma().payment.create({
    data: {
      customerId: customer.body.id,
      paymentMethodId: yapeId,
      paidAt: new Date("2026-09-03T15:00:00Z"),
      amount: new Prisma.Decimal("10.00"),
      status: "PENDING",
      recordedById: adminId,
    },
  });
  const location = await prisma().customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  return { id: customer.body.id, name, locationId: location.id };
}

function getReconciliation(token: string) {
  return request(server())
    .get("/api/v1/debt-reconciliation")
    .set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  adminId = (await prisma().user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } })).id;
  sellerToken = await createUserAndLogin("vendedor-cuadre-dinero", "SELLER");
  driverToken = await createUserAndLogin("chofer-cuadre-dinero", "DRIVER");
  cashId = (await prisma().paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } })).id;
  yapeId = (await prisma().paymentMethod.findFirstOrThrow({ where: { name: "Yape" } })).id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/debt-reconciliation", () => {
  test("a debt written only through the real paths matches: pending payments and voided sales do not count", async () => {
    const customer = await customerWithActivity();
    // Una venta anulada con su monto: si el cuadre la sumara, el cliente
    // aparecería con 99.00 de más.
    await prisma().sale.create({
      data: {
        locationId: customer.locationId,
        soldAt: new Date("2026-09-02T15:00:00Z"),
        total: new Prisma.Decimal("99.00"),
        recordedById: adminId,
        voidedAt: new Date("2026-09-02T16:00:00Z"),
        voidedById: adminId,
        voidReason: "Anotada en el cliente equivocado",
      },
    });
    expect(
      (
        await prisma().customer.findUniqueOrThrow({ where: { id: customer.id } })
      ).debtBalance.toFixed(2),
    ).toBe("25.00");

    const response = await getReconciliation(adminToken).expect(200);

    expect(response.body.discrepancies).toEqual([]);
    expect(response.body.discrepancyCount).toBe(0);
  });

  // Dos clientes con la misma historia; a uno solo se le pisa el saldo
  // guardado. Tiene que aparecer ese y no el otro.
  test("a materialized debt that drifted from its sales and payments is reported, with its difference as money text", async () => {
    const intact = await customerWithActivity();
    const drifted = await customerWithActivity();
    await prisma().customer.update({
      where: { id: drifted.id },
      data: { debtBalance: new Prisma.Decimal("20.00") },
    });

    const response = await getReconciliation(adminToken).expect(200);

    expect(response.body.discrepancyCount).toBe(1);
    expect(response.body.discrepancies).toEqual([
      {
        customerId: drifted.id,
        customerName: drifted.name,
        ledgerBalance: "25.00",
        materializedBalance: "20.00",
        difference: "5.00",
      },
    ]);
    expect(
      response.body.discrepancies.map((d: { customerId: string }) => d.customerId),
    ).not.toContain(intact.id);

    await prisma().customer.update({
      where: { id: drifted.id },
      data: { debtBalance: new Prisma.Decimal("25.00") },
    });
  });

  test("only an administrator runs it", async () => {
    await getReconciliation(sellerToken).expect(403);
    await getReconciliation(driverToken).expect(403);
  });
});
