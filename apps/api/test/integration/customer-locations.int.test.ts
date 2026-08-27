import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let customerId: string;
let primaryLocationId: string;

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

async function createUserAndLogin(username: string, role: string): Promise<string> {
  const password = `${username}-password`;
  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: username, username, password, roles: [role] })
    .expect(201);
  return login(username, password);
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-ubicaciones", "SELLER");
  driverToken = await createUserAndLogin("repartidor-ubicaciones", "DRIVER");

  const created = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Bodega Con Ubicaciones",
      phone: "987654321",
      address: "Av. Los Alamos 452",
      addressReference: "Portón azul",
    })
    .expect(201);
  customerId = created.body.id;

  const prisma = ctx.app.get(PrismaService);
  const primary = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId, isPrimary: true },
  });
  primaryLocationId = primary.id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/customers/:customerId/locations", () => {
  test("devuelve al menos la ubicación principal creada con el cliente", async () => {
    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/locations`)
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(response.status).toBe(200);
    const ids = response.body.map((location: { id: string }) => location.id);
    expect(ids).toContain(primaryLocationId);
    const primary = response.body.find(
      (location: { id: string }) => location.id === primaryLocationId,
    );
    expect(primary).toMatchObject({
      name: "Principal",
      address: "Av. Los Alamos 452",
      addressReference: "Portón azul",
      phone: "987654321",
      isPrimary: true,
      active: true,
    });
  });

  test("una segunda ubicación del mismo cliente también aparece, ordenada tras la principal", async () => {
    const prisma = ctx.app.get(PrismaService);
    const second = await prisma.customerLocation.create({
      data: {
        customerId,
        name: "Sucursal Norte",
        address: "Jr. Norte 100",
        addressReference: "Esquina",
        phone: "987654322",
      },
    });

    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/locations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.map((location: { id: string }) => location.id)).toEqual([
      primaryLocationId,
      second.id,
    ]);

    await prisma.customerLocation.delete({ where: { id: second.id } });
  });

  test("no devuelve ubicaciones de otro cliente", async () => {
    const otherCustomer = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Otro Cliente Con Ubicaciones",
        phone: "987654323",
        address: "Jr. Otro 1",
        addressReference: "Al lado",
      })
      .expect(201);

    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/locations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const ids = response.body.map((location: { id: string }) => location.id);
    const prisma = ctx.app.get(PrismaService);
    const otherLocation = await prisma.customerLocation.findFirstOrThrow({
      where: { customerId: otherCustomer.body.id, isPrimary: true },
    });
    expect(ids).not.toContain(otherLocation.id);
  });

  test("defaults to active-only, and the active filter excludes/includes accordingly", async () => {
    const prisma = ctx.app.get(PrismaService);
    const withdrawn = await prisma.customerLocation.create({
      data: {
        customerId,
        name: "Retirada en integración",
        address: "Jr. Retirado 1",
        addressReference: "N/A",
        phone: "987654324",
        active: false,
      },
    });

    const defaultResponse = await request(server())
      .get(`/api/v1/customers/${customerId}/locations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const defaultIds = defaultResponse.body.map((location: { id: string }) => location.id);
    expect(defaultIds).not.toContain(withdrawn.id);

    const inactiveResponse = await request(server())
      .get(`/api/v1/customers/${customerId}/locations?active=false`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const inactiveIds = inactiveResponse.body.map((location: { id: string }) => location.id);
    expect(inactiveIds).toContain(withdrawn.id);
    for (const location of inactiveResponse.body) {
      expect(location.active).toBe(false);
    }

    await prisma.customerLocation.delete({ where: { id: withdrawn.id } });
  });

  test("un id de cliente inexistente es rechazado con 404", async () => {
    const response = await request(server())
      .get(`/api/v1/customers/${MISSING_UUID}/locations`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  test("rejects a non-boolean active filter with 400", async () => {
    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/locations?active=quizas`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });
});

describe("role guard", () => {
  test("DRIVER is refused on the customer-locations route", async () => {
    const response = await request(server())
      .get(`/api/v1/customers/${customerId}/locations`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get(`/api/v1/customers/${customerId}/locations`);

    expect(response.status).toBe(401);
  });
});
