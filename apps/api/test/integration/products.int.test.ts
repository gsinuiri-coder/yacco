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
  sellerToken = await createUserAndLogin("vendedor-productos", "SELLER");
  driverToken = await createUserAndLogin("repartidor-productos", "DRIVER");
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/products", () => {
  test("returns the seeded catalog, with listPrice as a string and the container type nested", async () => {
    const response = await request(server())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(response.status).toBe(200);
    const names = response.body.map((product: { name: string }) => product.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Recarga 20L con caño",
        "Recarga 20L sin caño",
        "Bidón 20L con caño",
        "Bidón 20L sin caño",
      ]),
    );

    const refill = response.body.find(
      (product: { name: string }) => product.name === "Recarga 20L con caño",
    );
    // Money must never round-trip through a JSON number.
    expect(typeof refill.listPrice).toBe("string");
    expect(refill.listPrice).toBe("8.00");
    expect(refill.containerType).toEqual({ id: expect.any(String), name: "Con caño" });
    expect(refill.type).toBe("REFILL");
  });

  test("defaults to active-only, so the order form never offers a withdrawn product", async () => {
    const prisma = ctx.app.get(PrismaService);
    const containerType = await prisma.containerType.findFirstOrThrow();
    const withdrawn = await prisma.product.create({
      data: {
        containerTypeId: containerType.id,
        name: "Recarga descontinuada",
        type: "REFILL",
        listPrice: "9.00",
        active: false,
      },
    });

    const defaultResponse = await request(server())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const defaultIds = defaultResponse.body.map((product: { id: string }) => product.id);
    expect(defaultIds).not.toContain(withdrawn.id);

    const inactiveResponse = await request(server())
      .get("/api/v1/products?active=false")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const inactiveIds = inactiveResponse.body.map((product: { id: string }) => product.id);
    expect(inactiveIds).toContain(withdrawn.id);
    for (const product of inactiveResponse.body) {
      expect(product.active).toBe(false);
    }
  });

  test("rejects a non-boolean active filter with 400", async () => {
    const response = await request(server())
      .get("/api/v1/products?active=quizas")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });
});

describe("role guard", () => {
  test("DRIVER is refused on the products route", async () => {
    const response = await request(server())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/products");

    expect(response.status).toBe(401);
  });
});
