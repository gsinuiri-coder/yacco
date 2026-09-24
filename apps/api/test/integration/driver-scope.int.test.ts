import request from "supertest";
import { StopOrigin } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// «Mi ruta» (ítem 6 de docs/plan-cierre-piloto.md): el chofer registra sus
// paradas desde el celular con el mismo formulario que la oficina, así que lee
// lo que ese formulario lee. Los catálogos, enteros; lo que es de un cliente
// (sus precios pactados, un pedido), SOLO si ese cliente o ese pedido están en
// una ruta suya. Dos choferes con una ruta cada uno, para que «ajeno» exista.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const ROUTE_DATE = "2026-10-05";

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let driverAToken: string;
let customerA: string;
let customerB: string;
let orderOnRouteA: string;
let orderOnRouteB: string;

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

async function createDriver(username: string): Promise<{ token: string; id: string }> {
  const password = `${username}-password`;
  const created = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: username, username, password, roles: ["DRIVER"] })
    .expect(201);
  return { token: await login(username, password), id: created.body.id };
}

async function createCustomer(name: string, phone: string): Promise<string> {
  const response = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name, phone, address: "Av. Alcance 1", addressReference: "Portón azul" })
    .expect(201);
  return response.body.id;
}

async function createOrder(customerId: string, productId: string): Promise<string> {
  const response = await request(server())
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      customerId,
      deliveryDate: ROUTE_DATE,
      items: [{ productId, quantity: 1, unitPrice: "12.50" }],
    })
    .expect(201);
  return response.body.id;
}

/** Una ruta del chofer con el pedido como parada. */
async function routeWithOrder(driverId: string, orderId: string): Promise<void> {
  const route = await request(server())
    .post("/api/v1/routes")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ driverId, date: ROUTE_DATE })
    .expect(201);
  await request(server())
    .post(`/api/v1/routes/${route.body.id}/stops`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ origin: StopOrigin.ORDER, orderId })
    .expect(201);
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const driverA = await createDriver("chofer-alcance-a");
  const driverB = await createDriver("chofer-alcance-b");
  driverAToken = driverA.token;

  const containerType = await prisma.containerType.findFirstOrThrow();
  const product = await prisma.product.create({
    data: {
      containerTypeId: containerType.id,
      name: "Recarga 20L (alcance)",
      type: "REFILL",
      listPrice: "12.50",
    },
  });

  customerA = await createCustomer("Bodega del chofer A", "986100001");
  customerB = await createCustomer("Bodega del chofer B", "986100002");
  orderOnRouteA = await createOrder(customerA, product.id);
  orderOnRouteB = await createOrder(customerB, product.id);
  await routeWithOrder(driverA.id, orderOnRouteA);
  await routeWithOrder(driverB.id, orderOnRouteB);
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

function asDriverA(path: string): request.Test {
  return request(server()).get(path).set("Authorization", `Bearer ${driverAToken}`);
}

describe("los catálogos del formulario de parada", () => {
  test("el chofer lee los productos", async () => {
    const response = await asDriverA("/api/v1/products");
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
  });

  test("el chofer lee los tipos de envase, pero no los crea", async () => {
    expect((await asDriverA("/api/v1/container-types")).status).toBe(200);
    const create = await request(server())
      .post("/api/v1/container-types")
      .set("Authorization", `Bearer ${driverAToken}`)
      .send({ name: "Intento del chofer" });
    expect(create.status).toBe(403);
  });
});

describe("lo que es de un cliente, solo si está en una ruta del chofer", () => {
  test("los precios pactados de un cliente de SU ruta, sí", async () => {
    const response = await asDriverA(`/api/v1/customers/${customerA}/effective-prices`);
    expect(response.status).toBe(200);
  });

  test("los precios pactados de un cliente de la ruta de OTRO chofer, no", async () => {
    const response = await asDriverA(`/api/v1/customers/${customerB}/effective-prices`);
    expect(response.status).toBe(403);
  });

  test("el pedido de una parada de SU ruta, sí", async () => {
    const response = await asDriverA(`/api/v1/orders/${orderOnRouteA}`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(orderOnRouteA);
  });

  test("el pedido de la ruta de OTRO chofer no existe para él", async () => {
    const response = await asDriverA(`/api/v1/orders/${orderOnRouteB}`);
    expect(response.status).toBe(404);
  });

  test("la lista de pedidos sigue siendo de la oficina", async () => {
    expect((await asDriverA("/api/v1/orders")).status).toBe(403);
  });
});
