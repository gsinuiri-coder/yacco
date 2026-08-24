import request from "supertest";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SalesService } from "../../src/modules/sales/sales.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// Gherkin, spec §2.4 (apertura monetaria): "Dado un cliente que arrastra
// deuda o saldo a favor del cuaderno, cuando el cargador registra su cargo o
// abono de apertura, entonces el sistema lo refleja en debtBalance con un
// asiento fechado que lo respalda — nunca como un número suelto."

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;
let recordedById: string;
let paymentMethodId: string;
let customerSeq = 0;

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

async function createCustomer(overrides: Record<string, unknown> = {}): Promise<string> {
  customerSeq += 1;
  const response = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Cliente Apertura ${customerSeq}`,
      phone: `98700${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Apertura 1",
      addressReference: "Portón blanco",
      ...overrides,
    })
    .expect(201);
  return response.body.id;
}

async function unsetPrimaryLocation(customerId: string): Promise<void> {
  const prisma = ctx.app.get(PrismaService);
  await prisma.customerLocation.updateMany({
    where: { customerId },
    data: { isPrimary: false },
  });
}

/**
 * Inserted directly, bypassing SalesService: simulates an opening charge
 * that landed on a customer's non-primary location, to prove
 * assertNoOpeningBalanceExists finds it across every location the customer
 * has, not just the one this call would target.
 */
async function insertOpeningChargeOnLocation(locationId: string): Promise<void> {
  const prisma = ctx.app.get(PrismaService);
  await prisma.sale.create({
    data: {
      locationId,
      soldAt: new Date(),
      total: new Prisma.Decimal("10.00"),
      isOpeningBalance: true,
      recordedById,
    },
  });
}

async function customerDebtBalance(customerId: string): Promise<string> {
  const prisma = ctx.app.get(PrismaService);
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  return customer.debtBalance.toFixed(2);
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);

  const prisma = ctx.app.get(PrismaService);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } });
  recordedById = admin.id;
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow();
  paymentMethodId = paymentMethod.id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("SalesService.createOpeningCharge", () => {
  test("creates the charge, leaves debtBalance equal to the total, and the sale has no items", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();

    const sale = await sales.createOpeningCharge(
      { customerId, amount: "125.50", soldAt: new Date("2026-01-10T05:00:00.000Z") },
      recordedById,
    );

    expect(await customerDebtBalance(customerId)).toBe("125.50");
    expect(sale.isOpeningBalance).toBe(true);

    const prisma = ctx.app.get(PrismaService);
    const items = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
    expect(items).toHaveLength(0);
  });

  test("a second opening charge for the same customer is rejected, even one pointing at another of their locations", async () => {
    const sales = ctx.app.get(SalesService);
    const prisma = ctx.app.get(PrismaService);
    const customerId = await createCustomer();
    const secondaryLocation = await prisma.customerLocation.create({
      data: {
        customerId,
        name: "Sucursal",
        address: "Jr. Sucursal 200",
        addressReference: "Al fondo",
        phone: "987000999",
      },
    });
    await insertOpeningChargeOnLocation(secondaryLocation.id);

    await expect(
      sales.createOpeningCharge({ customerId, amount: "50.00", soldAt: new Date() }, recordedById),
    ).rejects.toThrow(BadRequestException);
  });

  test("a customer with no primary location fails with a clear message", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();
    await unsetPrimaryLocation(customerId);

    await expect(
      sales.createOpeningCharge({ customerId, amount: "50.00", soldAt: new Date() }, recordedById),
    ).rejects.toThrow(/locación principal/);
  });

  test("rejects an unknown customer", async () => {
    const sales = ctx.app.get(SalesService);

    await expect(
      sales.createOpeningCharge(
        { customerId: "00000000-0000-4000-8000-000000000000", amount: "10.00", soldAt: new Date() },
        recordedById,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects an inactive customer", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer({ active: false });

    await expect(
      sales.createOpeningCharge({ customerId, amount: "10.00", soldAt: new Date() }, recordedById),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a zero amount", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();

    await expect(
      sales.createOpeningCharge({ customerId, amount: "0.00", soldAt: new Date() }, recordedById),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a negative amount", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();

    await expect(
      sales.createOpeningCharge({ customerId, amount: "-5.00", soldAt: new Date() }, recordedById),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a future soldAt", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();
    const future = new Date(Date.now() + 60_000);

    await expect(
      sales.createOpeningCharge({ customerId, amount: "10.00", soldAt: future }, recordedById),
    ).rejects.toThrow(BadRequestException);
  });

  test("persists a backdated soldAt as-is", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();
    const backdated = new Date("2025-06-15T05:00:00.000Z");

    const sale = await sales.createOpeningCharge(
      { customerId, amount: "10.00", soldAt: backdated },
      recordedById,
    );

    expect(sale.soldAt).toEqual(backdated);
  });
});

describe("SalesService.createOpeningCredit", () => {
  test("creates the credit and leaves debtBalance negative by exactly the amount", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();

    await sales.createOpeningCredit(
      {
        customerId,
        paymentMethodId,
        amount: "80.25",
        paidAt: new Date("2026-01-10T05:00:00.000Z"),
      },
      recordedById,
    );

    expect(await customerDebtBalance(customerId)).toBe("-80.25");
  });

  test("a second opening credit for the same customer is rejected", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();
    await sales.createOpeningCredit(
      { customerId, paymentMethodId, amount: "20.00", paidAt: new Date() },
      recordedById,
    );

    await expect(
      sales.createOpeningCredit(
        { customerId, paymentMethodId, amount: "5.00", paidAt: new Date() },
        recordedById,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a zero amount", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();

    await expect(
      sales.createOpeningCredit(
        { customerId, paymentMethodId, amount: "0.00", paidAt: new Date() },
        recordedById,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a negative amount", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();

    await expect(
      sales.createOpeningCredit(
        { customerId, paymentMethodId, amount: "-5.00", paidAt: new Date() },
        recordedById,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a future paidAt", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();
    const future = new Date(Date.now() + 60_000);

    await expect(
      sales.createOpeningCredit(
        { customerId, paymentMethodId, amount: "10.00", paidAt: future },
        recordedById,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("persists a backdated paidAt as-is", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();
    const backdated = new Date("2025-06-15T05:00:00.000Z");

    const payment = await sales.createOpeningCredit(
      { customerId, paymentMethodId, amount: "10.00", paidAt: backdated },
      recordedById,
    );

    expect(payment.paidAt).toEqual(backdated);
  });
});

describe("mutual exclusion between an opening charge and an opening credit", () => {
  test("a customer with an opening charge rejects an opening credit", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();
    await sales.createOpeningCharge(
      { customerId, amount: "30.00", soldAt: new Date() },
      recordedById,
    );

    await expect(
      sales.createOpeningCredit(
        { customerId, paymentMethodId, amount: "10.00", paidAt: new Date() },
        recordedById,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  test("a customer with an opening credit rejects an opening charge", async () => {
    const sales = ctx.app.get(SalesService);
    const customerId = await createCustomer();
    await sales.createOpeningCredit(
      { customerId, paymentMethodId, amount: "30.00", paidAt: new Date() },
      recordedById,
    );

    await expect(
      sales.createOpeningCharge({ customerId, amount: "10.00", soldAt: new Date() }, recordedById),
    ).rejects.toThrow(BadRequestException);
  });
});
