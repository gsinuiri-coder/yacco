import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import request from "supertest";
import { main } from "../../src/cli/seed-test-data.js";
import { TestDataSeeder } from "../../src/cli/test-data-seeder.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

let ctx: TestAppContext;
// Nunca el archivo real de .local/: un test no pisa las contraseñas de quien lo corre.
const credentialsDir = mkdtempSync(path.join(tmpdir(), "demo-prueba-"));
let prisma: PrismaService;

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
}, 180000);

afterAll(async () => {
  rmSync(credentialsDir, { recursive: true, force: true });
  await stopTestApp(ctx);
});

/** Corre main() sin ensuciar la salida del test y devuelve lo que imprimió. */
async function runMain(credentialsPath: string): Promise<string> {
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    await main(credentialsPath);
    return log.mock.calls.map((call) => String(call[0])).join("\n");
  } finally {
    log.mockRestore();
  }
}

/** Las filas del archivo de credenciales, sin el encabezado: [nombre, usuario, contraseña]. */
function readCredentials(credentialsPath: string): string[][] {
  const rows = readFileSync(credentialsPath, "utf8").trim().split("\n").slice(1);
  return rows.map((row) => row.split("\t"));
}

function login(username: string, password: string) {
  return request(ctx.app.getHttpServer()).post("/api/v1/auth/login").send({ username, password });
}

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
  test("carga el día completo de PRUEBA Planta; las contraseñas van a un archivo, no a la consola", async () => {
    const credentialsPath = path.join(credentialsDir, "credenciales-prueba.txt");
    const printed = await runMain(credentialsPath);

    const credentials = readCredentials(credentialsPath);
    expect(credentials.map(([name, username]) => [name, username])).toEqual([
      ["PRUEBA Chofer 1", "prueba.chofer1"],
      ["PRUEBA Chofer 2", "prueba.chofer2"],
      ["PRUEBA Oficina", "prueba.oficina"],
    ]);
    for (const [, , password] of credentials) {
      expect(password?.length).toBeGreaterThanOrEqual(12);
      expect(printed).not.toContain(password);
    }
    expect(printed).toContain(`Las contraseñas de los usuarios PRUEBA están en ${credentialsPath}`);

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

  test("dos corridas seguidas: los mismos usuarios, y el archivo trae contraseñas que entran", async () => {
    const credentialsPath = path.join(credentialsDir, "credenciales-prueba.txt");
    const userRows = () =>
      prisma.user.findMany({
        where: { name: { startsWith: "PRUEBA" } },
        select: {
          id: true,
          name: true,
          username: true,
          active: true,
          roles: { select: { role: { select: { name: true } } } },
        },
        orderBy: { username: "asc" },
      });
    const usersBefore = await userRows();
    const previous = readCredentials(credentialsPath);

    const printed = await runMain(credentialsPath);

    expect(await userRows()).toEqual(usersBefore);
    expect(usersBefore).toHaveLength(3);
    const current = readCredentials(credentialsPath);
    expect(current.map(([name, username]) => [name, username])).toEqual(
      previous.map(([name, username]) => [name, username]),
    );
    for (const [index, [, username, password]] of current.entries()) {
      const [, , oldPassword] = previous[index] as string[];
      expect(password).not.toBe(oldPassword);
      expect(printed).not.toContain(password);
      await login(username as string, password as string).expect(200);
      await login(username as string, oldPassword as string).expect(401);
    }
    expect(printed).toContain("Usuario PRUEBA Chofer 1: ya existía, contraseña nueva.");
  });

  test("una segunda corrida no duplica nada", async () => {
    const before = await snapshot();

    const report = await new TestDataSeeder(ctx.app, "admin").run();

    expect(report.credentials).toHaveLength(3);
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
    const previousExitCode = process.exitCode;
    const credentialsPath = path.join(credentialsDir, "otra-ruta", "credenciales.txt");

    const printed = await runMain(credentialsPath);

    expect(printed).toContain("Datos de prueba en la base local:");
    expect(printed).toContain("Liquidación: ya estaba.");
    expect(existsSync(credentialsPath)).toBe(true);
    expect(process.exitCode).toBe(previousExitCode);
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
