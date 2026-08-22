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
let containerTypeA: string;
let containerTypeB: string;
let batchCodeSeq = 0;

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

/**
 * Flattens the error payload so a test can assert *why* a request was
 * rejected. Nest sends an array of strings for validation failures and a
 * single string for the exceptions the service throws.
 */
function messagesOf(response: { body: { message?: string | string[] } }): string {
  const { message } = response.body;
  return Array.isArray(message) ? message.join(" | ") : (message ?? "");
}

function nextCode(): string {
  batchCodeSeq += 1;
  return `LOTE-TEST-${batchCodeSeq}`;
}

function createBatch(token: string, overrides: Record<string, unknown> = {}) {
  return request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${token}`)
    .send({
      code: nextCode(),
      date: "2026-08-22",
      items: [{ containerTypeId: containerTypeA, producedQty: 10 }],
      ...overrides,
    });
}

function createMovement(token: string, overrides: Record<string, unknown> = {}) {
  return request(server())
    .post("/api/v1/container-movements")
    .set("Authorization", `Bearer ${token}`)
    .send({ containerTypeId: containerTypeA, quantity: 1, ...overrides });
}

async function inventoryOf(token: string, containerTypeId: string, state: string): Promise<number> {
  const response = await request(server())
    .get("/api/v1/container-movements/inventory")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  const entry = response.body.find(
    (item: { containerTypeId: string; state: string }) =>
      item.containerTypeId === containerTypeId && item.state === state,
  );
  return entry.quantity;
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-lotes", "SELLER");
  driverToken = await createUserAndLogin("repartidor-lotes", "DRIVER");

  const prisma = ctx.app.get(PrismaService);
  const containerTypes = await prisma.containerType.findMany({ orderBy: { name: "asc" } });
  containerTypeA = containerTypes[0]!.id;
  containerTypeB = containerTypes[1]!.id;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

// Belt and suspenders on top of each test's own scoping: this suite owns the
// whole ledger and batch history in its own throwaway Testcontainers
// database, so a full reset between tests is safe and keeps the inventory
// and invariant assertions from being skewed by a previous test's leftovers.
afterEach(async () => {
  const prisma = ctx.app.get(PrismaService);
  await prisma.containerMovement.deleteMany({});
  await prisma.batchItem.deleteMany({});
  await prisma.productionBatch.deleteMany({});
});

describe("POST /api/v1/production-batches", () => {
  test("un lote de dos líneas emite DOS movimientos FILLING con las cantidades correctas y el batchId del lote", async () => {
    await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
      containerTypeId: containerTypeA,
      quantity: 100,
    }).expect(201);
    await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
      containerTypeId: containerTypeB,
      quantity: 100,
    }).expect(201);

    const response = await createBatch(adminToken, {
      items: [
        { containerTypeId: containerTypeA, producedQty: 60 },
        { containerTypeId: containerTypeB, producedQty: 25 },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.warnings).toEqual([]);
    expect(response.body.items).toHaveLength(2);
    for (const item of response.body.items) {
      expect(item.availableQty).toBe(item.producedQty);
    }

    const prisma = ctx.app.get(PrismaService);
    const movements = await prisma.containerMovement.findMany({
      where: { batchId: response.body.id },
      orderBy: { quantity: "desc" },
    });
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({
      type: "FILLING",
      containerTypeId: containerTypeA,
      quantity: 60,
      fromState: "EMPTY_AT_PLANT",
      toState: "FULL_AT_PLANT",
    });
    expect(movements[1]).toMatchObject({
      type: "FILLING",
      containerTypeId: containerTypeB,
      quantity: 25,
      fromState: "EMPTY_AT_PLANT",
      toState: "FULL_AT_PLANT",
    });
  });

  test("el inventario después del lote refleja el traslado: bajan los vacíos, suben los llenos, en lo producido", async () => {
    await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
      quantity: 100,
    }).expect(201);

    await createBatch(adminToken, {
      items: [{ containerTypeId: containerTypeA, producedQty: 60 }],
    }).expect(201);

    expect(await inventoryOf(adminToken, containerTypeA, "EMPTY_AT_PLANT")).toBe(40);
    expect(await inventoryOf(adminToken, containerTypeA, "FULL_AT_PLANT")).toBe(60);
  });

  // Business decision (spec, decided with the client): the plant really
  // filled those containers, so the batch is recorded anyway. The negative
  // means "fleet entries are missing" and is not a bug.
  test("producir más de los vacíos disponibles registra el lote igual, avisa con los números, y deja el inventario negativo", async () => {
    // No FLEET_ENTRY at all: every unit produced here outruns what's on the books.
    const response = await createBatch(adminToken, {
      items: [{ containerTypeId: containerTypeA, producedQty: 50 }],
    });

    expect(response.status).toBe(201);
    expect(response.body.warnings).toEqual([
      expect.objectContaining({
        containerTypeId: containerTypeA,
        emptyAvailable: 0,
        produced: 50,
      }),
    ]);
    expect(await inventoryOf(adminToken, containerTypeA, "EMPTY_AT_PLANT")).toBe(-50);
  });

  test("registrar después una entrada de envases hace que el negativo desaparezca", async () => {
    await createBatch(adminToken, {
      items: [{ containerTypeId: containerTypeA, producedQty: 50 }],
    }).expect(201);
    expect(await inventoryOf(adminToken, containerTypeA, "EMPTY_AT_PLANT")).toBe(-50);

    await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
      containerTypeId: containerTypeA,
      quantity: 50,
    }).expect(201);

    expect(await inventoryOf(adminToken, containerTypeA, "EMPTY_AT_PLANT")).toBe(0);
  });

  test("un código de lote duplicado da un error en español, no una violación cruda", async () => {
    const code = nextCode();
    await createBatch(adminToken, { code }).expect(201);

    const duplicate = await createBatch(adminToken, { code });

    expect(duplicate.status).toBe(409);
    expect(messagesOf(duplicate)).toContain("Ya existe");
  });

  // This documents the atomicity guarantee ("si algo falla a mitad, no debe
  // quedar ni el lote ni movimientos sueltos"): a doomed multi-line batch —
  // doomed only by its duplicate code — must leave nothing behind, not even
  // a batch shell or one of its two lines' movements.
  test("un fallo a mitad no deja lote ni movimientos huérfanos", async () => {
    const code = nextCode();
    await createBatch(adminToken, { code }).expect(201);

    const prisma = ctx.app.get(PrismaService);
    const [batchesBefore, itemsBefore, movementsBefore] = await Promise.all([
      prisma.productionBatch.count(),
      prisma.batchItem.count(),
      prisma.containerMovement.count(),
    ]);

    const failedAttempt = await createBatch(adminToken, {
      code,
      items: [
        { containerTypeId: containerTypeA, producedQty: 10 },
        { containerTypeId: containerTypeB, producedQty: 20 },
      ],
    });
    expect(failedAttempt.status).toBe(409);

    const [batchesAfter, itemsAfter, movementsAfter] = await Promise.all([
      prisma.productionBatch.count(),
      prisma.batchItem.count(),
      prisma.containerMovement.count(),
    ]);
    expect(batchesAfter).toBe(batchesBefore);
    expect(itemsAfter).toBe(itemsBefore);
    expect(movementsAfter).toBe(movementsBefore);
  });

  test("un tipo de envase repetido en dos líneas es rechazado", async () => {
    const response = await createBatch(adminToken, {
      items: [
        { containerTypeId: containerTypeA, producedQty: 10 },
        { containerTypeId: containerTypeA, producedQty: 20 },
      ],
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("repetirse");
  });

  test("un tipo de envase que no existe es rechazado", async () => {
    const response = await createBatch(adminToken, {
      items: [{ containerTypeId: MISSING_UUID, producedQty: 10 }],
    });

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("No existen");
  });

  test("EL INVARIANTE sigue en pie tras crear lotes, incluso con un estado en negativo", async () => {
    await createMovement(adminToken, {
      type: "FLEET_ENTRY",
      toState: "EMPTY_AT_PLANT",
      quantity: 40,
    }).expect(201);

    // Overshoots the 40 on the books by 20 — deliberately, to prove the
    // invariant holds even while EMPTY_AT_PLANT sits negative.
    await createBatch(adminToken, {
      items: [{ containerTypeId: containerTypeA, producedQty: 60 }],
    }).expect(201);

    const response = await request(server())
      .get("/api/v1/container-movements/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const forA = response.body.filter(
      (item: { containerTypeId: string }) => item.containerTypeId === containerTypeA,
    );
    const sumOfStates = forA.reduce(
      (sum: number, item: { quantity: number }) => sum + item.quantity,
      0,
    );
    const totalIn = 40;
    const totalOut = 0; // nothing sold, damaged or lost in this sequence
    expect(sumOfStates + totalOut).toBe(totalIn);
  });

  test("role guard: SELLER y DRIVER no pueden registrar lotes; ADMIN sí", async () => {
    const bySeller = await createBatch(sellerToken);
    expect(bySeller.status).toBe(403);

    const byDriver = await createBatch(driverToken);
    expect(byDriver.status).toBe(403);

    const byAdmin = await createBatch(adminToken);
    expect(byAdmin.status).toBe(201);
  });

  test("un usuario no autenticado es rechazado con 401", async () => {
    const response = await request(server())
      .post("/api/v1/production-batches")
      .send({
        code: nextCode(),
        date: "2026-08-22",
        items: [{ containerTypeId: containerTypeA, producedQty: 10 }],
      });

    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/production-batches", () => {
  test("lista lotes paginados, con sus líneas y el responsable anidado", async () => {
    const created = await createBatch(adminToken, {
      notes: "Turno mañana",
      items: [{ containerTypeId: containerTypeA, producedQty: 15 }],
    }).expect(201);

    const list = await request(server())
      .get("/api/v1/production-batches")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const entry = list.body.data.find((batch: { id: string }) => batch.id === created.body.id);
    expect(entry).toMatchObject({
      notes: "Turno mañana",
      filledBy: { id: expect.any(String), name: "Administrador" },
    });
    expect(entry.items).toHaveLength(1);
  });

  test("filtra por rango de fechas", async () => {
    await createBatch(adminToken, { date: "2026-08-01" }).expect(201);
    await createBatch(adminToken, { date: "2026-08-15" }).expect(201);

    const response = await request(server())
      .get("/api/v1/production-batches?dateFrom=2026-08-10&dateTo=2026-08-20")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data.every((batch: { date: string }) => batch.date === "2026-08-15")).toBe(
      true,
    );
  });
});

describe("GET /api/v1/production-batches/:id", () => {
  test("devuelve el lote con sus líneas", async () => {
    const created = await createBatch(adminToken, {
      items: [{ containerTypeId: containerTypeA, producedQty: 12 }],
    }).expect(201);

    const response = await request(server())
      .get(`/api/v1/production-batches/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ producedQty: 12, availableQty: 12 });
  });

  test("un id inexistente es rechazado con 404", async () => {
    const response = await request(server())
      .get(`/api/v1/production-batches/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
