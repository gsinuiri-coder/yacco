import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;
let containerTypeId: string;
let customerSeq = 0;

function server() {
  return ctx.app.getHttpServer();
}

function prisma(): PrismaService {
  return ctx.app.get(PrismaService);
}

async function freshLocation(): Promise<string> {
  customerSeq += 1;
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Concurrencia ${customerSeq}`,
      phone: `98800${String(customerSeq).padStart(4, "0")}`,
      address: "Av. Concurrencia 1",
      addressReference: "Portón rojo",
    })
    .expect(201);
  const location = await prisma().customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id },
  });
  return location.id;
}

async function balanceOf(locationId: string): Promise<number> {
  const balance = await prisma().customerContainerBalance.findUnique({
    where: { locationId_containerTypeId: { locationId, containerTypeId } },
  });
  return balance?.quantity ?? 0;
}

beforeAll(async () => {
  ctx = await startTestApp();
  const login = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);
  adminToken = login.body.accessToken;
  containerTypeId = (await prisma().containerType.findFirstOrThrow({ orderBy: { name: "asc" } }))
    .id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("customer_container_balances under concurrent writes", () => {
  // Doce entregas de 1 a la misma ubicación, todas a la vez. Leyendo el saldo
  // y escribiendo el absoluto, dos que leen el mismo valor base se pisan y el
  // saldo termina por debajo de 12 (o una falla por la clave duplicada).
  test("concurrent deliveries to one location all add up", async () => {
    const locationId = await freshLocation();

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(server())
          .post("/api/v1/container-movements")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            type: "LOAN_DELIVERY",
            fromState: "FULL_ON_ROUTE",
            toState: "WITH_CUSTOMER",
            containerTypeId,
            locationId,
            quantity: 1,
          }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(12).fill(201));
    expect(await balanceOf(locationId)).toBe(12);
    const reconciliation = await request(server())
      .get("/api/v1/container-reconciliation")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(reconciliation.body.discrepancyCount).toBe(0);
  });

  // El mismo conteo enviado dos veces a la vez (un doble clic): el segundo
  // tiene que ver lo que dejó el primero y no ajustar de nuevo.
  test("two identical counts at once adjust once", async () => {
    const locationId = await freshLocation();

    const responses = await Promise.all(
      [0, 1].map(() =>
        request(server())
          .post("/api/v1/container-counts")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ locationId, containerTypeId, countedQuantity: 5 }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(await balanceOf(locationId)).toBe(5);
    const adjustments = await prisma().containerMovement.findMany({
      where: { locationId, type: "COUNT_ADJUSTMENT" },
    });
    expect(adjustments.map((movement) => movement.quantity)).toEqual([5]);
  });
});
