import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// Tarjeta «Puesta en marcha» del Panel (ítem H de docs/plan-final.md): cada
// ítem aparece y desaparece por el camino real de la app, nunca escribiendo
// el estado a mano. Cada filtro se prueba con una fila que cuenta y otra
// que no, para que el test falle si el filtro no existe.

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const CHECKLIST = "/api/v1/reports/setup-checklist";

let ctx: TestAppContext;
let prisma: PrismaService;
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

async function checklist() {
  const response = await request(server())
    .get(CHECKLIST)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  return response.body;
}

function send(method: "post" | "patch", path: string, body: object, status: number) {
  return request(server())
    [method](`/api/v1${path}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(body)
    .expect(status);
}

let userSeq = 0;
async function createUser(name: string, role: string): Promise<string> {
  userSeq += 1;
  const response = await send(
    "post",
    "/users",
    { name, username: `checklist.${userSeq}`, password: "contrasena-1", roles: [role] },
    201,
  );
  return response.body.id;
}

let phoneSeq = 0;
async function createCustomer(name: string): Promise<{ id: string; locationId: string }> {
  phoneSeq += 1;
  const response = await send(
    "post",
    "/customers",
    {
      name,
      phone: `98720${String(phoneSeq).padStart(4, "0")}`,
      address: "Av. Puesta 1",
      addressReference: "Portón verde",
    },
    201,
  );
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: response.body.id, isPrimary: true },
  });
  return { id: response.body.id, locationId: location.id };
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login("admin", ADMIN_PASSWORD);
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /reports/setup-checklist — Puesta en marcha", () => {
  test("una zona activa sin días aparece; con días, o retirada, no", async () => {
    await send("post", "/zones", { name: "Con días", deliveryDays: ["MONDAY"] }, 201);
    const withoutDays = await send("post", "/zones", { name: "Sin días" }, 201);
    const withdrawn = await send("post", "/zones", { name: "Retirada" }, 201);
    await send("patch", `/zones/${withdrawn.body.id}`, { active: false }, 200);

    expect((await checklist()).zonesWithoutDeliveryDays).toEqual([
      { id: withoutDays.body.id, name: "Sin días" },
    ]);

    await send("patch", `/zones/${withoutDays.body.id}`, { deliveryDays: ["SATURDAY"] }, 200);

    expect((await checklist()).zonesWithoutDeliveryDays).toEqual([]);
  });

  test("cuenta choferes y vendedores activos; uno dado de baja no cuenta", async () => {
    const before = await checklist();
    expect(before.activeDrivers).toBe(0);
    expect(before.activeSellers).toBe(0);

    const inactiveDriver = await createUser("Chofer de baja", "DRIVER");
    await send("patch", `/users/${inactiveDriver}`, { active: false }, 200);
    const driver = await createUser("Chofer Uno", "DRIVER");
    const seller = await createUser("Oficina Uno", "SELLER");

    const after = await checklist();
    expect(after.activeDrivers).toBe(1);
    expect(after.activeSellers).toBe(1);

    await send("patch", `/users/${driver}`, { active: false }, 200);
    await send("patch", `/users/${seller}`, { active: false }, 200);

    const end = await checklist();
    expect(end.activeDrivers).toBe(0);
    expect(end.activeSellers).toBe(0);
  });

  test("una ubicación sin contar aparece y se va al contarla; la de un cliente de baja no cuenta", async () => {
    const start = (await checklist()).uncountedLocations;
    const counted = await createCustomer("Bodega Contada");
    await createCustomer("Bodega Sin Contar");
    const inactive = await createCustomer("Bodega de Baja");
    await send("patch", `/customers/${inactive.id}`, { active: false }, 200);

    expect((await checklist()).uncountedLocations).toBe(start + 2);

    const containerType = await prisma.containerType.findFirstOrThrow();
    await send(
      "post",
      "/container-counts",
      { locationId: counted.locationId, containerTypeId: containerType.id, countedQuantity: 0 },
      201,
    );

    expect((await checklist()).uncountedLocations).toBe(start + 1);
  });

  test("cuenta locales activos sin coordenadas de clientes activos", async () => {
    const start = (await checklist()).locationsWithoutCoordinates;
    const located = await createCustomer("Bodega Ubicada");
    await createCustomer("Bodega Sin Ubicación");
    const inactive = await createCustomer("Bodega Inactiva Sin Ubicación");

    await send(
      "patch",
      `/customers/${located.id}`,
      { latitude: "-12.046374", longitude: "-77.042793" },
      200,
    );
    await send("patch", `/customers/${inactive.id}`, { active: false }, 200);

    expect((await checklist()).locationsWithoutCoordinates).toBe(start + 1);
  });

  test("usuarios y clientes PRUEBA activos aparecen y se van al darlos de baja", async () => {
    const start = await checklist();
    const testUser = await createUser("PRUEBA Chofer", "DRIVER");
    await createUser("Chofer Real", "DRIVER");
    const testCustomer = await createCustomer("PRUEBA Planta");
    await createCustomer("Bodega Real");

    const during = await checklist();
    expect(during.activeTestUsers).toBe(start.activeTestUsers + 1);
    expect(during.activeTestCustomers).toBe(start.activeTestCustomers + 1);

    await send("patch", `/users/${testUser}`, { active: false }, 200);
    await send("patch", `/customers/${testCustomer.id}`, { active: false }, 200);

    const end = await checklist();
    expect(end.activeTestUsers).toBe(start.activeTestUsers);
    expect(end.activeTestCustomers).toBe(start.activeTestCustomers);
  });

  test("un precio de lista sale de la lista cuando se cambia desde «Productos»", async () => {
    const before = (await checklist()).productsWithInitialListPrice as { id: string }[];
    expect(before.length).toBeGreaterThanOrEqual(2);
    const changed = before[0] as { id: string };

    await send("patch", `/products/${changed.id}`, { listPrice: "9.50" }, 200);

    const after = (await checklist()).productsWithInitialListPrice as { id: string }[];
    expect(after.map((product) => product.id)).toEqual(
      before.slice(1).map((product) => product.id),
    );
  });

  test("solo el administrador la ve", async () => {
    await createUser("Oficina Dos", "SELLER");
    const sellerToken = await login(`checklist.${userSeq}`, "contrasena-1");

    await request(server())
      .get(CHECKLIST)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(403);
  });
});
