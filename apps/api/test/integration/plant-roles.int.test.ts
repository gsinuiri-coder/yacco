import request from "supertest";
import { ContainerMovementType, ContainerState, UserRole } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
let supervisorToken: string;
let operatorAToken: string;
let operatorBToken: string;
let operatorSellerToken: string;

let operatorAUserId: string;
let operatorBUserId: string;

let containerTypeId: string;

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

async function createUser(
  username: string,
  roles: UserRole[],
): Promise<{ token: string; id: string }> {
  const password = `${username}-pass-1234`;
  const res = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: `Usuario ${username}`,
      username,
      password,
      roles,
    })
    .expect(201);
  const token = await login(username, password);
  return { token, id: res.body.id };
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);

  const containerType = await prisma.containerType.findFirstOrThrow({
    where: { active: true },
  });
  containerTypeId = containerType.id;

  const supervisor = await createUser("test-plant-supervisor", [UserRole.PLANT_SUPERVISOR]);
  supervisorToken = supervisor.token;

  const operatorA = await createUser("test-plant-op-a", [UserRole.PLANT_OPERATOR]);
  operatorAToken = operatorA.token;
  operatorAUserId = operatorA.id;

  const operatorB = await createUser("test-plant-op-b", [UserRole.PLANT_OPERATOR]);
  operatorBToken = operatorB.token;
  operatorBUserId = operatorB.id;

  const operatorSeller = await createUser("test-plant-op-seller", [
    UserRole.PLANT_OPERATOR,
    UserRole.SELLER,
  ]);
  operatorSellerToken = operatorSeller.token;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("Supervisor de planta — Matriz de permisos", () => {
  test("Endpoints permitidos responden 200/201", async () => {
    // 1. GET /auth/me
    const meRes = await request(server())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(200);
    expect(meRes.body.roles).toContain("PLANT_SUPERVISOR");

    // 2. GET /container-types
    await request(server())
      .get("/api/v1/container-types")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(200);

    // 3. GET /production-batches/code-proposals
    await request(server())
      .get("/api/v1/production-batches/code-proposals?date=2026-10-12")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(200);

    // 4. GET /production-batches
    await request(server())
      .get("/api/v1/production-batches")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(200);

    // 5. GET /container-movements/inventory
    await request(server())
      .get("/api/v1/container-movements/inventory")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(200);

    // 6. GET /container-movements
    await request(server())
      .get("/api/v1/container-movements")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(200);

    // 7. POST /container-movements (ingreso de envases a la flota)
    await request(server())
      .post("/api/v1/container-movements")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        type: ContainerMovementType.FLEET_ENTRY,
        containerTypeId,
        quantity: 50,
        toState: ContainerState.EMPTY_AT_PLANT,
      })
      .expect(201);

    // 8. POST /container-counts/plant (conteo físico de la planta)
    await request(server())
      .post("/api/v1/container-counts/plant")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        containerTypeId,
        state: ContainerState.EMPTY_AT_PLANT,
        countedQuantity: 50,
      })
      .expect(201);
  });

  test("Endpoints prohibidos dan 403", async () => {
    // Dinero
    await request(server())
      .get("/api/v1/reports/debt")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(403);

    await request(server())
      .get("/api/v1/payments")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(403);

    // Clientes
    await request(server())
      .get("/api/v1/customers")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(403);

    await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ name: "Cliente Prohibido", phone: "999888777", address: "Av. Falsa 123" })
      .expect(403);

    // Rutas
    await request(server())
      .get("/api/v1/routes")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(403);

    // Pedidos
    await request(server())
      .get("/api/v1/orders")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(403);

    // Usuarios
    await request(server())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(403);
  });
});

describe("Operador de planta — Matriz de permisos", () => {
  test("Endpoints permitidos responden 200/201", async () => {
    // 1. GET /auth/me
    const meRes = await request(server())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(200);
    expect(meRes.body.roles).toContain("PLANT_OPERATOR");

    // 2. GET /container-types
    await request(server())
      .get("/api/v1/container-types")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(200);

    // 3. GET /production-batches/code-proposals
    await request(server())
      .get("/api/v1/production-batches/code-proposals?date=2026-10-12")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(200);

    // 4. GET /production-batches
    await request(server())
      .get("/api/v1/production-batches")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(200);

    // 5. GET /container-movements/inventory
    await request(server())
      .get("/api/v1/container-movements/inventory")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(200);
  });

  test("Endpoints prohibidos dan 403 (incluye movimientos y conteos)", async () => {
    // Movimientos de envases (solo supervisor)
    await request(server())
      .get("/api/v1/container-movements")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(403);

    await request(server())
      .post("/api/v1/container-movements")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .send({
        type: ContainerMovementType.FLEET_ENTRY,
        containerTypeId,
        quantity: 10,
        toState: ContainerState.EMPTY_AT_PLANT,
      })
      .expect(403);

    // Conteo en planta (solo supervisor/admin)
    await request(server())
      .post("/api/v1/container-counts/plant")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .send({
        containerTypeId,
        state: ContainerState.EMPTY_AT_PLANT,
        countedQuantity: 10,
      })
      .expect(403);

    // Dinero
    await request(server())
      .get("/api/v1/reports/debt")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(403);

    // Clientes
    await request(server())
      .get("/api/v1/customers")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(403);

    // Rutas
    await request(server())
      .get("/api/v1/routes")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(403);

    // Usuarios
    await request(server())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(403);
  });
});

describe("«Solo las suyas» — Aislamiento de llenadas entre operadores", () => {
  const testDate = "2026-10-13";

  test("Dos operadores llenan el mismo lote con cantidades distintas: cada uno ve solo la suya y el supervisor ve las dos", async () => {
    // Operador A registra 12 unidades
    const resA = await request(server())
      .post("/api/v1/production-batches")
      .set("Authorization", `Bearer ${operatorAToken}`)
      .send({
        date: testDate,
        items: [{ containerTypeId, producedQty: 12 }],
      })
      .expect(201);
    const batchId = resA.body.id;

    // Operador B registra 28 unidades en la misma fecha (se suma al lote existente)
    await request(server())
      .post("/api/v1/production-batches")
      .set("Authorization", `Bearer ${operatorBToken}`)
      .send({
        date: testDate,
        items: [{ containerTypeId, producedQty: 28 }],
      })
      .expect(201);

    // 1. Operador A consulta el listado: ve SOLO su llenada de 12
    const listA = await request(server())
      .get(`/api/v1/production-batches?dateFrom=${testDate}&dateTo=${testDate}`)
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(200);
    expect(listA.body.data).toHaveLength(1);
    const batchForA = listA.body.data[0];
    expect(batchForA.id).toBe(batchId);
    expect(batchForA.items).toHaveLength(1);
    expect(batchForA.items[0].producedQty).toBe(12);
    expect(batchForA.items[0].recordedById).toBe(operatorAUserId);

    // Operador A consulta findOne: ve SOLO su llenada de 12
    const singleA = await request(server())
      .get(`/api/v1/production-batches/${batchId}`)
      .set("Authorization", `Bearer ${operatorAToken}`)
      .expect(200);
    expect(singleA.body.items).toHaveLength(1);
    expect(singleA.body.items[0].producedQty).toBe(12);

    // 2. Operador B consulta el listado: ve SOLO su llenada de 28
    const listB = await request(server())
      .get(`/api/v1/production-batches?dateFrom=${testDate}&dateTo=${testDate}`)
      .set("Authorization", `Bearer ${operatorBToken}`)
      .expect(200);
    expect(listB.body.data).toHaveLength(1);
    const batchForB = listB.body.data[0];
    expect(batchForB.id).toBe(batchId);
    expect(batchForB.items).toHaveLength(1);
    expect(batchForB.items[0].producedQty).toBe(28);
    expect(batchForB.items[0].recordedById).toBe(operatorBUserId);

    // Operador B consulta findOne: ve SOLO su llenada de 28
    const singleB = await request(server())
      .get(`/api/v1/production-batches/${batchId}`)
      .set("Authorization", `Bearer ${operatorBToken}`)
      .expect(200);
    expect(singleB.body.items).toHaveLength(1);
    expect(singleB.body.items[0].producedQty).toBe(28);

    // 3. Supervisor consulta el listado: ve las DOS llenadas (12 y 28)
    const listSupervisor = await request(server())
      .get(`/api/v1/production-batches?dateFrom=${testDate}&dateTo=${testDate}`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .expect(200);
    expect(listSupervisor.body.data).toHaveLength(1);
    const batchForSup = listSupervisor.body.data[0];
    expect(batchForSup.items).toHaveLength(2);
    const quantities = batchForSup.items.map((i: { producedQty: number }) => i.producedQty);
    expect(quantities).toContain(12);
    expect(quantities).toContain(28);
  });
});

describe("Roles sumados — Operador + Vendedor", () => {
  const testDate = "2026-10-13";

  test("Usuario con roles PLANT_OPERATOR y SELLER ve las llenadas de todos los operadores", async () => {
    const listOpSeller = await request(server())
      .get(`/api/v1/production-batches?dateFrom=${testDate}&dateTo=${testDate}`)
      .set("Authorization", `Bearer ${operatorSellerToken}`)
      .expect(200);
    expect(listOpSeller.body.data).toHaveLength(1);
    const batch = listOpSeller.body.data[0];
    // Como también es SELLER, sus permisos se suman y ve todas las llenadas del lote
    expect(batch.items.length).toBeGreaterThanOrEqual(2);
  });
});
