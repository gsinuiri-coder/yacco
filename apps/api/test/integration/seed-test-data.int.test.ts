import { jest } from "@jest/globals";
import { main } from "../../src/cli/seed-test-data.js";
import { TestDataSeeder } from "../../src/cli/test-data-seeder.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

let ctx: TestAppContext;
let prisma: PrismaService;

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

/** Todo lo que la carga escribe, contado: dos corridas tienen que dar lo mismo. */
async function snapshot() {
  const [
    users,
    zones,
    fleetEntries,
    batches,
    customers,
    orders,
    routes,
    stops,
    loads,
    sales,
    payments,
    settlements,
    movements,
    priceChanges,
  ] = await Promise.all([
    prisma.user.count({ where: { name: { startsWith: "PRUEBA" } } }),
    prisma.zone.count(),
    prisma.containerMovement.count({ where: { type: "FLEET_ENTRY" } }),
    prisma.productionBatch.count(),
    prisma.customer.count(),
    prisma.order.count(),
    prisma.route.count(),
    prisma.routeStop.count(),
    prisma.routeLoad.count(),
    prisma.sale.count(),
    prisma.payment.count(),
    prisma.routeSettlement.count(),
    prisma.containerMovement.count(),
    prisma.productPriceChange.count(),
  ]);
  return {
    users,
    zones,
    fleetEntries,
    batches,
    customers,
    orders,
    routes,
    stops,
    loads,
    sales,
    payments,
    settlements,
    movements,
    priceChanges,
  };
}

describe("pnpm demo:prueba — datos de prueba en local (ítem K)", () => {
  test("carga el día completo de PRUEBA Planta por los servicios", async () => {
    const report = await new TestDataSeeder(ctx.app, "admin").run();

    expect(report.createdUsers.map((user) => user.name)).toEqual([
      "PRUEBA Chofer 1",
      "PRUEBA Chofer 2",
      "PRUEBA Oficina",
    ]);
    expect(report.createdUsers.every((user) => user.password.length >= 12)).toBe(true);

    const zones = await prisma.zone.findMany({ orderBy: { name: "asc" } });
    expect(zones.map((zone) => [zone.name, zone.deliveryDays])).toEqual([
      ["Casas Parque", ["WEDNESDAY", "SATURDAY"]],
      ["Parque", ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]],
      ["Surco", ["TUESDAY", "THURSDAY", "SATURDAY"]],
    ]);

    const fleet = await prisma.containerMovement.findMany({
      where: { type: "FLEET_ENTRY" },
      select: { quantity: true, containerType: { select: { name: true } } },
      orderBy: { quantity: "desc" },
    });
    expect(fleet.map((movement) => [movement.containerType.name, movement.quantity])).toEqual([
      ["Con caño", 200],
      ["Sin caño", 100],
    ]);

    const customer = await prisma.customer.findFirstOrThrow({
      where: { name: "PRUEBA Planta" },
      include: { zone: true },
    });
    expect(customer.zone?.name).toBe("Parque");
    // 40.00 vendido − 20.00 en efectivo − 15.00 por Yape.
    expect(customer.debtBalance.toFixed(2)).toBe("5.00");

    const route = await prisma.route.findFirstOrThrow({
      where: { driver: { name: "PRUEBA Chofer 1" } },
      include: { zone: true },
    });
    expect(route.status).toBe("SETTLED");
    expect(route.zone?.name).toBe("Parque");

    // Liquidada, el camión queda vacío: el lleno sobrante de cada tipo volvió
    // a la planta. Con dos tipos cargados, eso exige mandarlos por tipo.
    const onTruck = await prisma.containerMovement.groupBy({
      by: ["containerTypeId"],
      where: { routeId: route.id, fromState: "FULL_ON_ROUTE", type: "FULL_RETURN" },
      _sum: { quantity: true },
    });
    expect(onTruck.map((line) => line._sum.quantity)).toEqual([1, 1]);

    const order = await prisma.order.findFirstOrThrow({
      where: { location: { customerId: customer.id } },
    });
    expect(order.status).toBe("DELIVERED");

    const payments = await prisma.payment.findMany({
      where: { customerId: customer.id },
      select: { amount: true, status: true, paymentMethod: { select: { name: true } } },
      orderBy: { amount: "desc" },
    });
    expect(
      payments.map((payment) => [
        payment.paymentMethod.name,
        payment.amount.toFixed(2),
        payment.status,
      ]),
    ).toEqual([
      ["Efectivo", "20.00", "CONFIRMED"],
      ["Yape", "15.00", "CONFIRMED"],
    ]);

    // 4 con caño entregados − 3 vacíos devueltos; 1 sin caño − 1.
    const balances = await prisma.customerContainerBalance.findMany({
      where: { location: { customerId: customer.id } },
      select: { quantity: true, containerType: { select: { name: true } } },
    });
    const byType = Object.fromEntries(
      balances.map((balance) => [balance.containerType.name, balance.quantity]),
    );
    expect(byType).toEqual({ "Con caño": 1, "Sin caño": 0 });
  });

  test("una segunda corrida no duplica nada ni cambia contraseñas", async () => {
    const before = await snapshot();

    const report = await new TestDataSeeder(ctx.app, "admin").run();

    expect(report.createdUsers).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  test("un precio de lista distinto se vuelve a poner, y queda en su historial", async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { name: "Bidón 20L con caño" },
    });
    await prisma.product.update({ where: { id: product.id }, data: { listPrice: "35.00" } });
    const changesBefore = await prisma.productPriceChange.count({
      where: { productId: product.id },
    });

    const report = await new TestDataSeeder(ctx.app, "admin").run();

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.listPrice.toFixed(2)).toBe("30.00");
    expect(await prisma.productPriceChange.count({ where: { productId: product.id } })).toBe(
      changesBefore + 1,
    );
    expect(report.lines).toContain("Precios de lista: 1 cambiados, 3 ya estaban.");
  });

  test("main() imprime lo que hizo y termina sin error contra la base local", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const previousExitCode = process.exitCode;
    try {
      await main();

      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("Datos de prueba en la base local:");
      expect(printed).toContain("Liquidación: ya estaba.");
      expect(printed).not.toContain("Contraseñas de los usuarios nuevos");
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      log.mockRestore();
    }
  });

  test("main() se niega a correr contra una base que no es local", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const previousUrl = process.env.DATABASE_URL;
    const previousExitCode = process.exitCode;
    process.env.DATABASE_URL = "postgresql://owner:pw@ep-x.sa-east-1.aws.neon.tech/neondb";
    const usersBefore = await prisma.user.count();
    try {
      await main();

      expect(process.exitCode).toBe(1);
      expect(String(error.mock.calls[0]?.[0])).toMatch(/nunca en Neon ni en producción/);
      expect(await prisma.user.count()).toBe(usersBefore);
    } finally {
      process.env.DATABASE_URL = previousUrl;
      process.exitCode = previousExitCode;
      error.mockRestore();
    }
  });
});
