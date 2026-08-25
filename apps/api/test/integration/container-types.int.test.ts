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

describe("POST / PATCH / GET :id — managing the catalog", () => {
  function createType(token: string, body: Record<string, unknown>) {
    return request(server())
      .post("/api/v1/container-types")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  function updateType(token: string, id: string, body: Record<string, unknown>) {
    return request(server())
      .patch(`/api/v1/container-types/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  test("ADMIN creates a type, renames it, withdraws it and reactivates it", async () => {
    const created = await createType(adminToken, { name: "Bidón (V)" }).expect(201);
    expect(created.body).toMatchObject({ id: expect.any(String), name: "Bidón (V)", active: true });
    const id: string = created.body.id;

    const renamed = await updateType(adminToken, id, { name: "Bidón (R)" }).expect(200);
    expect(renamed.body).toMatchObject({ id, name: "Bidón (R)", active: true });

    const withdrawn = await updateType(adminToken, id, { active: false }).expect(200);
    expect(withdrawn.body).toMatchObject({ id, name: "Bidón (R)", active: false });

    const fetched = await request(server())
      .get(`/api/v1/container-types/${id}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ id, name: "Bidón (R)", active: false });

    const reactivated = await updateType(adminToken, id, { active: true }).expect(200);
    expect(reactivated.body).toMatchObject({ id, active: true });
  });

  test("a duplicate name is rejected with a clear Spanish message, on create and on rename", async () => {
    const first = await createType(adminToken, { name: "Bidón duplicado" }).expect(201);
    const other = await createType(adminToken, { name: "Bidón otro" }).expect(201);

    const duplicate = await createType(adminToken, { name: "Bidón duplicado" }).expect(400);
    expect(duplicate.body.message).toBe(
      'Ya existe un tipo de envase con el nombre "Bidón duplicado"',
    );

    const collision = await updateType(adminToken, other.body.id, {
      name: "Bidón duplicado",
    }).expect(400);
    expect(collision.body.message).toContain("Ya existe un tipo de envase");
    expect(first.body.id).not.toBe(other.body.id);
  });

  test("GET :id of an unknown type is 404, and a non-uuid id is 400", async () => {
    await request(server())
      .get("/api/v1/container-types/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);
    await request(server())
      .get("/api/v1/container-types/no-es-uuid")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });

  test("PATCH of an unknown type is 404", async () => {
    await updateType(adminToken, "00000000-0000-4000-8000-000000000000", { active: false }).expect(
      404,
    );
  });

  test("rejects a body with unknown fields or an empty name", async () => {
    await createType(adminToken, { name: "" }).expect(400);
    await createType(adminToken, { name: "Con campo extra", capacity: 20 }).expect(400);
  });

  // Writing is an office decision (what can be counted and inventoried);
  // reading stays open to whoever registers movements against the catalog.
  test("SELLER gets 403 on create and on update, but 200 on list and on GET :id", async () => {
    await createType(sellerToken, { name: "Intento vendedor" }).expect(403);

    const created = await createType(adminToken, { name: "Solo lectura vendedor" }).expect(201);
    await updateType(sellerToken, created.body.id, { active: false }).expect(403);

    await request(server())
      .get("/api/v1/container-types")
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
    await request(server())
      .get(`/api/v1/container-types/${created.body.id}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
  });

  // Withdrawing does not erase what is already out there: the balance a
  // customer holds in that type keeps resolving it, and the reconciliation
  // routine keeps a clean sheet — nothing was damaged, only offered no more.
  test("a withdrawn type still appears in the balance of a customer holding it, and the ledger still reconciles", async () => {
    const prisma = ctx.app.get(PrismaService);
    const created = await createType(adminToken, { name: "Bidón por retirar" }).expect(201);
    const containerTypeId: string = created.body.id;

    const customer = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Bodega Tipo Retirado",
        phone: "987000777",
        address: "Av. Retiro 1",
        addressReference: "Portón rojo",
      })
      .expect(201);
    const location = await prisma.customerLocation.findFirstOrThrow({
      where: { customerId: customer.body.id, isPrimary: true },
    });

    await request(server())
      .post("/api/v1/container-movements")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        type: "LOAN_DELIVERY",
        containerTypeId,
        fromState: "FULL_ON_ROUTE",
        toState: "WITH_CUSTOMER",
        locationId: location.id,
        quantity: 5,
      })
      .expect(201);

    await updateType(adminToken, containerTypeId, { active: false }).expect(200);

    const balance = await prisma.customerContainerBalance.findUniqueOrThrow({
      where: { locationId_containerTypeId: { locationId: location.id, containerTypeId } },
      include: { containerType: true },
    });
    expect(balance.quantity).toBe(5);
    expect(balance.containerType).toMatchObject({ name: "Bidón por retirar", active: false });

    const reconciliation = await request(server())
      .get("/api/v1/container-reconciliation")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const finding = reconciliation.body.discrepancies.find(
      (d: { containerTypeId: string }) => d.containerTypeId === containerTypeId,
    );
    expect(finding).toBeUndefined();
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
