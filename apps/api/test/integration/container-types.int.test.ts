import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let driverToken: string;

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
  sellerToken = await createUserAndLogin("vendedor-tipos-envase", "SELLER");
  driverToken = await createUserAndLogin("repartidor-tipos-envase", "DRIVER");
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/container-types", () => {
  test("returns the seeded catalog", async () => {
    const response = await request(server())
      .get("/api/v1/container-types")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(response.status).toBe(200);
    const names = response.body.map((containerType: { name: string }) => containerType.name);
    expect(names).toEqual(expect.arrayContaining(["Con caño", "Sin caño"]));
    for (const containerType of response.body) {
      expect(containerType).toMatchObject({ id: expect.any(String), active: true });
    }
  });

  test("defaults to active-only, and the active filter excludes/includes accordingly", async () => {
    const prisma = ctx.app.get(PrismaService);
    const withdrawn = await prisma.containerType.create({
      data: { name: "Retirado en integración", active: false },
    });

    const defaultResponse = await request(server())
      .get("/api/v1/container-types")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const defaultIds = defaultResponse.body.map(
      (containerType: { id: string }) => containerType.id,
    );
    expect(defaultIds).not.toContain(withdrawn.id);

    const inactiveResponse = await request(server())
      .get("/api/v1/container-types?active=false")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const inactiveIds = inactiveResponse.body.map(
      (containerType: { id: string }) => containerType.id,
    );
    expect(inactiveIds).toContain(withdrawn.id);
    for (const containerType of inactiveResponse.body) {
      expect(containerType.active).toBe(false);
    }

    await prisma.containerType.delete({ where: { id: withdrawn.id } });
  });

  test("rejects a non-boolean active filter with 400", async () => {
    const response = await request(server())
      .get("/api/v1/container-types?active=quizas")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });
});

describe("role guard", () => {
  test("DRIVER is refused on the container-types route", async () => {
    const response = await request(server())
      .get("/api/v1/container-types")
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/container-types");

    expect(response.status).toBe(401);
  });
});
