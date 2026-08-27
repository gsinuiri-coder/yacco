import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// external_code is the key the roster loader will match on to stay
// idempotent across re-runs — set only by the loader (writing straight to
// Prisma, never through the public API). These tests cover the DB
// constraint the migration adds and the DTO guard that keeps the field
// off every public write route.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;

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

function validCustomer(overrides: Record<string, unknown> = {}) {
  return {
    name: "Bodega Santa Rosa",
    phone: "987654321",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul frente al parque",
    ...overrides,
  };
}

async function createCustomerWithLocation(
  prisma: PrismaService,
  name: string,
  externalCode: string | null,
) {
  return prisma.customer.create({
    data: {
      name,
      externalCode,
      locations: {
        create: {
          name: "Principal",
          address: "Av. Siempre Viva 123",
          addressReference: "Portón verde",
          phone: "900000000",
          isPrimary: true,
          externalCode,
        },
      },
    },
    include: { locations: true },
  });
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("customers.external_code", () => {
  test("two customers with external_code NULL coexist without violating the unique index", async () => {
    const prisma = ctx.app.get(PrismaService);

    const first = await prisma.customer.create({
      data: {
        name: "Cliente Sin Código A",
        locations: {
          create: {
            name: "Principal",
            address: "Av. A 1",
            addressReference: "Ref A",
            phone: "911111111",
            isPrimary: true,
          },
        },
      },
    });
    const second = await prisma.customer.create({
      data: {
        name: "Cliente Sin Código B",
        locations: {
          create: {
            name: "Principal",
            address: "Av. B 1",
            addressReference: "Ref B",
            phone: "922222222",
            isPrimary: true,
          },
        },
      },
    });

    expect(first.externalCode).toBeNull();
    expect(second.externalCode).toBeNull();
  });

  test("two customers with the same non-null external_code fail", async () => {
    const prisma = ctx.app.get(PrismaService);

    await createCustomerWithLocation(prisma, "Cliente Con Código A", "FS-CUST-1");

    await expect(
      createCustomerWithLocation(prisma, "Cliente Con Código B", "FS-CUST-1"),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  test("POST /api/v1/customers with externalCode in the body is rejected with 400: it is loader-only", async () => {
    const response = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(validCustomer({ externalCode: "FS-SHOULD-FAIL" }))
      .expect(400);

    const message = Array.isArray(response.body.message)
      ? response.body.message.join(" | ")
      : (response.body.message ?? "");
    expect(message).toContain("externalCode");
  });

  test("GET /api/v1/customers/:id exposes externalCode read-only, passed through as-is", async () => {
    const prisma = ctx.app.get(PrismaService);
    const created = await createCustomerWithLocation(
      prisma,
      "Cliente Con Código Visible",
      "FS-CUST-VISIBLE",
    );

    const response = await request(server())
      .get(`/api/v1/customers/${created.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.externalCode).toBe("FS-CUST-VISIBLE");
  });
});

describe("customer_locations.external_code", () => {
  test("two locations with external_code NULL coexist without violating the unique index", async () => {
    const prisma = ctx.app.get(PrismaService);
    const customer = await prisma.customer.create({
      data: {
        name: "Cliente Dos Ubicaciones",
        locations: {
          create: {
            name: "Principal",
            address: "Av. Principal 1",
            addressReference: "Ref principal",
            phone: "933333333",
            isPrimary: true,
          },
        },
      },
    });

    const first = await prisma.customerLocation.create({
      data: {
        customerId: customer.id,
        name: "Sucursal 1",
        address: "Av. S1 1",
        addressReference: "Ref S1",
        phone: "944444444",
      },
    });
    const second = await prisma.customerLocation.create({
      data: {
        customerId: customer.id,
        name: "Sucursal 2",
        address: "Av. S2 1",
        addressReference: "Ref S2",
        phone: "955555555",
      },
    });

    expect(first.externalCode).toBeNull();
    expect(second.externalCode).toBeNull();
  });

  test("two locations with the same non-null external_code fail", async () => {
    const prisma = ctx.app.get(PrismaService);
    const customer = await prisma.customer.create({
      data: {
        name: "Cliente Ubicaciones Duplicadas",
        locations: {
          create: {
            name: "Principal",
            address: "Av. Principal 2",
            addressReference: "Ref principal 2",
            phone: "966666666",
            isPrimary: true,
          },
        },
      },
    });

    await prisma.customerLocation.create({
      data: {
        customerId: customer.id,
        name: "Sucursal A",
        address: "Av. A 2",
        addressReference: "Ref A2",
        phone: "977777777",
        externalCode: "FS-LOC-1",
      },
    });

    await expect(
      prisma.customerLocation.create({
        data: {
          customerId: customer.id,
          name: "Sucursal B",
          address: "Av. B 2",
          addressReference: "Ref B2",
          phone: "988888888",
          externalCode: "FS-LOC-1",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  test("GET .../locations exposes externalCode read-only for each location", async () => {
    const prisma = ctx.app.get(PrismaService);
    const customer = await prisma.customer.create({
      data: {
        name: "Cliente Ubicación Visible",
        locations: {
          create: {
            name: "Principal",
            address: "Av. Principal 3",
            addressReference: "Ref principal 3",
            phone: "999999901",
            isPrimary: true,
            externalCode: "FS-LOC-PRIMARY",
          },
        },
      },
    });

    const response = await request(server())
      .get(`/api/v1/customers/${customer.id}/locations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({ isPrimary: true, externalCode: "FS-LOC-PRIMARY" }),
    ]);
  });
});
