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
let viewerToken: string;

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
  viewerToken = await createUserAndLogin("lector-productos", "VIEWER");
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

describe("PATCH /api/v1/products/:id", () => {
  // A product of its own: the GET tests above read the seeded prices.
  let productId: string;

  beforeAll(async () => {
    const prisma = ctx.app.get(PrismaService);
    const containerType = await prisma.containerType.findFirstOrThrow();
    const product = await prisma.product.create({
      data: {
        containerTypeId: containerType.id,
        name: "Recarga para cambiar de precio",
        type: "REFILL",
        listPrice: "8.00",
      },
    });
    productId = product.id;
  });

  test("ADMIN sets the list price, and the catalog reads it back as a 2-decimal string", async () => {
    const response = await request(server())
      .patch(`/api/v1/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ listPrice: "9.5" });

    expect(response.status).toBe(200);
    expect(response.body.listPrice).toBe("9.50");

    const catalog = await request(server())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
    const read = catalog.body.find((product: { id: string }) => product.id === productId);
    expect(read.listPrice).toBe("9.50");
  });

  test.each([
    ["a JSON number", 9.5],
    ["three decimals", "9.505"],
    ["a negative amount", "-1.00"],
  ])("rejects %s with 400, in Spanish", async (_label, listPrice) => {
    const response = await request(server())
      .patch(`/api/v1/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ listPrice });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("El precio de lista");
  });

  test("a zero list price is refused: it would make every unpriced delivery free", async () => {
    const response = await request(server())
      .patch(`/api/v1/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ listPrice: "0.00" });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("mayor que 0");
  });

  test("SELLER, DRIVER and VIEWER read the catalog but cannot change a price", async () => {
    for (const token of [sellerToken, driverToken, viewerToken]) {
      const response = await request(server())
        .patch(`/api/v1/products/${productId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ listPrice: "1.00" });
      expect(response.status).toBe(403);
    }
  });

  test("an unknown product is a 404 in Spanish", async () => {
    const response = await request(server())
      .patch("/api/v1/products/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ listPrice: "1.00" });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain("no existe");
  });
});

describe("historial inmutable de precios de lista", () => {
  async function createProduct(listPrice = "8.00") {
    const prisma = ctx.app.get(PrismaService);
    const containerType = await prisma.containerType.findFirstOrThrow();
    return prisma.product.create({
      data: {
        containerTypeId: containerType.id,
        name: `Producto con historial ${crypto.randomUUID()}`,
        type: "REFILL",
        listPrice,
      },
    });
  }

  test("dos cambios seguidos guardan ambos valores anteriores y quién los hizo", async () => {
    const product = await createProduct();

    await request(server())
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ listPrice: "9.50" })
      .expect(200);
    await request(server())
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ listPrice: "10.25" })
      .expect(200);

    const history = await request(server())
      .get(`/api/v1/products/${product.id}/price-changes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(history.body).toEqual([
      expect.objectContaining({ previousPrice: "9.50", newPrice: "10.25" }),
      expect.objectContaining({ previousPrice: "8.00", newPrice: "9.50" }),
    ]);
    expect(history.body[0].changedBy).toEqual({ id: expect.any(String), name: expect.any(String) });
    expect(typeof history.body[0].changedAt).toBe("string");
  });

  test("repetir el mismo precio no agrega una fila al historial", async () => {
    const product = await createProduct("8.00");

    await request(server())
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ listPrice: "8.00" })
      .expect(200);

    const prisma = ctx.app.get(PrismaService);
    await expect(
      prisma.productPriceChange.count({ where: { productId: product.id } }),
    ).resolves.toBe(0);
  });

  test("si falla al escribir el historial, el precio y su fila se revierten juntos", async () => {
    const product = await createProduct("8.00");
    const prisma = ctx.app.get(PrismaService);
    const triggerName = `fail_price_change_${product.id.replaceAll("-", "_")}`;
    const functionName = `${triggerName}_fn`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falla intencional del historial'; END;
      $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON product_price_changes
      FOR EACH ROW WHEN (NEW.product_id = '${product.id}'::uuid)
      EXECUTE FUNCTION ${functionName}();
    `);

    try {
      await request(server())
        .patch(`/api/v1/products/${product.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ listPrice: "9.50" })
        .expect(500);

      const untouched = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(untouched.listPrice.toFixed(2)).toBe("8.00");
      await expect(
        prisma.productPriceChange.count({ where: { productId: product.id } }),
      ).resolves.toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON product_price_changes;`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}();`);
    }
  });

  test("SELLER no puede leer el historial", async () => {
    const product = await createProduct();

    await request(server())
      .get(`/api/v1/products/${product.id}/price-changes`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(403);
  });
});

describe("role guard", () => {
  // Desde «Mi ruta» (2026-09-24) el chofer lee el catálogo: su formulario de
  // parada lo necesita. Ver driver-scope.int.test.ts.
  test("DRIVER reads the products catalog", async () => {
    const response = await request(server())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(200);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/products");

    expect(response.status).toBe(401);
  });
});
