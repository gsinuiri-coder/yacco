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
let typeCounter = 0;

function server() {
  return ctx.app.getHttpServer();
}

function prisma(): PrismaService {
  return ctx.app.get(PrismaService);
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

/** Un tipo de envase propio por test: el saldo de la planta es por tipo. */
async function newContainerType(): Promise<string> {
  typeCounter += 1;
  const response = await request(server())
    .post("/api/v1/container-types")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Bidón conteo planta ${typeCounter}` })
    .expect(201);
  return response.body.id;
}

async function fleetEntry(containerTypeId: string, quantity: number): Promise<void> {
  await request(server())
    .post("/api/v1/container-movements")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ type: "FLEET_ENTRY", toState: "EMPTY_AT_PLANT", containerTypeId, quantity })
    .expect(201);
}

async function batch(
  code: string,
  date: string,
  containerTypeId: string,
  producedQty: number,
): Promise<string> {
  const response = await request(server())
    .post("/api/v1/production-batches")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ code, date, items: [{ containerTypeId, producedQty }] })
    .expect(201);
  return response.body.id;
}

function countPlant(token: string, body: Record<string, unknown>) {
  return request(server())
    .post("/api/v1/container-counts/plant")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

/** La celda del inventario, leída de la API como la lee la pantalla. */
async function inventoryCell(containerTypeId: string, state: string): Promise<number> {
  const response = await request(server())
    .get("/api/v1/container-movements/inventory")
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  const cell = (
    response.body as { containerTypeId: string; state: string; quantity: number }[]
  ).find((row) => row.containerTypeId === containerTypeId && row.state === state);
  return cell?.quantity ?? 0;
}

async function availableOf(batchId: string, containerTypeId: string): Promise<number> {
  const item = await prisma().batchItem.findFirstOrThrow({ where: { batchId, containerTypeId } });
  return item.availableQty;
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-conteo-planta", "SELLER");
  driverToken = await createUserAndLogin("chofer-conteo-planta", "DRIVER");
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("POST /api/v1/container-counts/plant", () => {
  // El lote más viejo se inserta SEGUNDO y tiene el código que ordena último:
  // si el descuento siguiera el orden de inserción o el código, tomaría del
  // lote nuevo. La diferencia (8) cruza los dos lotes.
  test("HU-25 E3: fulls counted short are taken from the oldest batch first, one adjustment per batch, across two batches", async () => {
    const containerTypeId = await newContainerType();
    await fleetEntry(containerTypeId, 20);
    const newer = await batch("A-PLANTA-NUEVO", "2026-09-10", containerTypeId, 5);
    const older = await batch("Z-PLANTA-VIEJO", "2026-09-01", containerTypeId, 6);

    const response = await countPlant(adminToken, {
      containerTypeId,
      state: "FULL_AT_PLANT",
      countedQuantity: 3,
    }).expect(201);

    expect(response.body).toMatchObject({
      state: "FULL_AT_PLANT",
      expectedQuantity: 11,
      countedQuantity: 3,
    });
    expect(
      response.body.adjustments.map((a: { quantity: number; batch: { code: string } }) => [
        a.batch.code,
        a.quantity,
      ]),
    ).toEqual([
      ["Z-PLANTA-VIEJO", 6],
      ["A-PLANTA-NUEVO", 2],
    ]);
    expect(await availableOf(older, containerTypeId)).toBe(0);
    expect(await availableOf(newer, containerTypeId)).toBe(3);

    const movements = await prisma().containerMovement.findMany({
      where: { containerTypeId, type: "COUNT_ADJUSTMENT" },
      orderBy: { quantity: "desc" },
    });
    expect(movements).toMatchObject([
      { fromState: "FULL_AT_PLANT", toState: null, quantity: 6, batchId: older, locationId: null },
      { fromState: "FULL_AT_PLANT", toState: null, quantity: 2, batchId: newer, locationId: null },
    ]);

    // Reconstruible del libro: la celda del inventario y lo disponible en los
    // lotes dicen lo mismo, y ningún saldo de cliente se movió.
    expect(await inventoryCell(containerTypeId, "FULL_AT_PLANT")).toBe(3);
    expect(await inventoryCell(containerTypeId, "WITH_CUSTOMER")).toBe(0);
    const balances = await prisma().customerContainerBalance.count({ where: { containerTypeId } });
    expect(balances).toBe(0);
    const reconciliation = await request(server())
      .get("/api/v1/container-reconciliation")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(reconciliation.body.discrepancyCount).toBe(0);
  });

  test("HU-25 E2: empties counted from a negative balance enter the plant by the whole difference", async () => {
    const containerTypeId = await newContainerType();
    await fleetEntry(containerTypeId, 2);
    await batch("PLANTA-NEGATIVO", "2026-09-02", containerTypeId, 5);
    expect(await inventoryCell(containerTypeId, "EMPTY_AT_PLANT")).toBe(-3);

    const response = await countPlant(adminToken, {
      containerTypeId,
      state: "EMPTY_AT_PLANT",
      countedQuantity: 4,
    }).expect(201);

    expect(response.body).toMatchObject({ expectedQuantity: -3, countedQuantity: 4 });
    expect(response.body.adjustments).toEqual([
      { id: expect.any(String), quantity: 7, batch: null },
    ]);
    const movement = await prisma().containerMovement.findUniqueOrThrow({
      where: { id: response.body.adjustments[0].id },
    });
    expect(movement).toMatchObject({
      type: "COUNT_ADJUSTMENT",
      fromState: null,
      toState: "EMPTY_AT_PLANT",
      quantity: 7,
      batchId: null,
    });
    expect(await inventoryCell(containerTypeId, "EMPTY_AT_PLANT")).toBe(4);
    expect(await inventoryCell(containerTypeId, "FULL_AT_PLANT")).toBe(5);
  });

  test("HU-25 E1: empties counted short leave the plant by the difference", async () => {
    const containerTypeId = await newContainerType();
    await fleetEntry(containerTypeId, 20);

    const response = await countPlant(adminToken, {
      containerTypeId,
      state: "EMPTY_AT_PLANT",
      countedQuantity: 14,
    }).expect(201);

    const movement = await prisma().containerMovement.findUniqueOrThrow({
      where: { id: response.body.adjustments[0].id },
    });
    expect(movement).toMatchObject({ fromState: "EMPTY_AT_PLANT", toState: null, quantity: 6 });
    expect(await inventoryCell(containerTypeId, "EMPTY_AT_PLANT")).toBe(14);
  });

  test("HU-25 E5: a count that matches the ledger writes nothing", async () => {
    const containerTypeId = await newContainerType();
    await fleetEntry(containerTypeId, 5);
    const before = await prisma().containerMovement.count({ where: { containerTypeId } });

    const response = await countPlant(adminToken, {
      containerTypeId,
      state: "EMPTY_AT_PLANT",
      countedQuantity: 5,
    }).expect(201);

    expect(response.body).toMatchObject({
      expectedQuantity: 5,
      countedQuantity: 5,
      adjustments: [],
    });
    expect(await prisma().containerMovement.count({ where: { containerTypeId } })).toBe(before);
  });

  test("HU-25 E4: more fulls than the ledger has is rejected and nothing is written", async () => {
    const containerTypeId = await newContainerType();
    await fleetEntry(containerTypeId, 3);
    const batchId = await batch("PLANTA-DE-MAS", "2026-09-03", containerTypeId, 3);
    const before = await prisma().containerMovement.count({ where: { containerTypeId } });

    const response = await countPlant(adminToken, {
      containerTypeId,
      state: "FULL_AT_PLANT",
      countedQuantity: 5,
    }).expect(400);

    expect(response.body.message).toContain(
      "Los llenos que faltan se anotan como lote en Producción",
    );
    expect(await prisma().containerMovement.count({ where: { containerTypeId } })).toBe(before);
    expect(await availableOf(batchId, containerTypeId)).toBe(3);
  });

  test("HU-25 E4, with no movement of that type at all: counting fulls is rejected", async () => {
    const containerTypeId = await newContainerType();

    const response = await countPlant(adminToken, {
      containerTypeId,
      state: "FULL_AT_PLANT",
      countedQuantity: 2,
    }).expect(400);

    expect(response.body.message).toContain(
      "Los llenos que faltan se anotan como lote en Producción",
    );
    expect(await prisma().containerMovement.count({ where: { containerTypeId } })).toBe(0);
  });

  // No se puede llegar acá por la API (todo lleno entra por un lote): se
  // escribe a mano un lote con menos disponibles que el libro, para probar
  // que el conteo se frena en vez de inventar un lote.
  test("when the batches hold fewer fulls than the ledger, the count stops and writes nothing", async () => {
    const containerTypeId = await newContainerType();
    await fleetEntry(containerTypeId, 5);
    const batchId = await batch("PLANTA-DESFASADO", "2026-09-04", containerTypeId, 5);
    await prisma().batchItem.updateMany({
      where: { batchId, containerTypeId },
      data: { availableQty: 2 },
    });
    const before = await prisma().containerMovement.count({ where: { containerTypeId } });

    const response = await countPlant(adminToken, {
      containerTypeId,
      state: "FULL_AT_PLANT",
      countedQuantity: 0,
    }).expect(409);

    expect(response.body.message).toContain("Revise los lotes en Producción");
    expect(await prisma().containerMovement.count({ where: { containerTypeId } })).toBe(before);
    expect(await availableOf(batchId, containerTypeId)).toBe(2);
  });

  test("HU-25 E6: only an administrator counts the plant", async () => {
    const containerTypeId = await newContainerType();
    await fleetEntry(containerTypeId, 4);
    const body = { containerTypeId, state: "EMPTY_AT_PLANT", countedQuantity: 0 };

    await countPlant(sellerToken, body).expect(403);
    await countPlant(driverToken, body).expect(403);
    expect(await inventoryCell(containerTypeId, "EMPTY_AT_PLANT")).toBe(4);
  });

  test("a state that is not counted at the plant is rejected", async () => {
    const containerTypeId = await newContainerType();
    await countPlant(adminToken, {
      containerTypeId,
      state: "WITH_CUSTOMER",
      countedQuantity: 1,
    }).expect(400);
  });
});
