import request from "supertest";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// The zones catalog: the grouping the owner walks the container audit by.
// Managed from the office (no seed, no hand-written INSERT), withdrawn
// never deleted, and creatable BEFORE routing has decided delivery days.

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

function createZone(token: string, body: Record<string, unknown>) {
  return request(server()).post("/api/v1/zones").set("Authorization", `Bearer ${token}`).send(body);
}

function updateZone(token: string, id: string, body: Record<string, unknown>) {
  return request(server())
    .patch(`/api/v1/zones/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function listZones(token: string, queryString = "") {
  return request(server())
    .get(`/api/v1/zones${queryString}`)
    .set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-zonas", "SELLER");
  driverToken = await createUserAndLogin("repartidor-zonas", "DRIVER");
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("POST /api/v1/zones", () => {
  test("creates a zone with delivery days", async () => {
    const response = await createZone(adminToken, {
      name: "Norte",
      deliveryDays: ["MONDAY", "THURSDAY"],
    }).expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      name: "Norte",
      deliveryDays: ["MONDAY", "THURSDAY"],
      active: true,
    });
  });

  test("creates a zone WITHOUT delivery days: routing has not decided them yet", async () => {
    const omitted = await createZone(adminToken, { name: "Sur" }).expect(201);
    expect(omitted.body).toMatchObject({ name: "Sur", deliveryDays: [], active: true });

    const empty = await createZone(adminToken, { name: "Este", deliveryDays: [] }).expect(201);
    expect(empty.body).toMatchObject({ name: "Este", deliveryDays: [] });
  });

  test("rejects a duplicate name with a clear message", async () => {
    await createZone(adminToken, { name: "Centro" }).expect(201);

    const response = await createZone(adminToken, { name: "Centro" }).expect(400);

    expect(response.body.message).toBe('Ya existe una zona con el nombre "Centro"');
  });

  test("rejects a day that is not a weekday, and a repeated day", async () => {
    const invalid = await createZone(adminToken, {
      name: "Inválida",
      deliveryDays: ["LUNES"],
    }).expect(400);
    expect(JSON.stringify(invalid.body.message)).toContain(
      "Uno de los días de reparto no es válido",
    );

    const repeated = await createZone(adminToken, {
      name: "Repetida",
      deliveryDays: ["MONDAY", "MONDAY"],
    }).expect(400);
    expect(JSON.stringify(repeated.body.message)).toContain("Un día de reparto no puede repetirse");
  });

  test("rejects an empty name", async () => {
    await createZone(adminToken, { name: "" }).expect(400);
  });
});

describe("GET /api/v1/zones", () => {
  test("SELLER lists the active zones, ordered by name", async () => {
    const response = await listZones(sellerToken).expect(200);

    const names = response.body.map((zone: { name: string }) => zone.name);
    expect(names).toEqual(expect.arrayContaining(["Centro", "Este", "Norte", "Sur"]));
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    for (const zone of response.body) {
      expect(zone).toMatchObject({ id: expect.any(String), active: true });
    }
  });

  test("GET :id returns one zone and 404 for an unknown id", async () => {
    const created = await createZone(adminToken, { name: "Oeste" }).expect(201);

    const found = await request(server())
      .get(`/api/v1/zones/${created.body.id}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
    expect(found.body).toEqual(created.body);

    await request(server())
      .get("/api/v1/zones/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);
  });

  test("rejects a non-boolean active filter with 400", async () => {
    await listZones(adminToken, "?active=quizas").expect(400);
  });
});

describe("PATCH /api/v1/zones/:id", () => {
  test("renames a zone, and refuses renaming onto an existing name", async () => {
    const created = await createZone(adminToken, { name: "Provisional" }).expect(201);

    const renamed = await updateZone(adminToken, created.body.id, { name: "Definitiva" }).expect(
      200,
    );
    expect(renamed.body).toMatchObject({ id: created.body.id, name: "Definitiva" });

    const clash = await updateZone(adminToken, created.body.id, { name: "Norte" }).expect(400);
    expect(clash.body.message).toBe('Ya existe una zona con el nombre "Norte"');
  });

  test("adds delivery days to a zone created without them", async () => {
    const created = await createZone(adminToken, { name: "Sin días" }).expect(201);
    expect(created.body.deliveryDays).toEqual([]);

    const updated = await updateZone(adminToken, created.body.id, {
      deliveryDays: ["WEDNESDAY", "SATURDAY"],
    }).expect(200);

    expect(updated.body.deliveryDays).toEqual(["WEDNESDAY", "SATURDAY"]);
    expect(updated.body.name).toBe("Sin días");
  });

  test("rejects a repeated day on update", async () => {
    const created = await createZone(adminToken, { name: "Días repetidos" }).expect(201);

    await updateZone(adminToken, created.body.id, {
      deliveryDays: ["FRIDAY", "FRIDAY"],
    }).expect(400);
  });

  test("withdraws a zone, hides it from the default list, shows it with active=false, and reactivates it", async () => {
    const created = await createZone(adminToken, { name: "Para retirar" }).expect(201);
    const id: string = created.body.id;

    const withdrawn = await updateZone(adminToken, id, { active: false }).expect(200);
    expect(withdrawn.body.active).toBe(false);

    const defaultList = await listZones(adminToken).expect(200);
    expect(defaultList.body.map((zone: { id: string }) => zone.id)).not.toContain(id);

    const inactiveList = await listZones(adminToken, "?active=false").expect(200);
    expect(inactiveList.body.map((zone: { id: string }) => zone.id)).toContain(id);
    for (const zone of inactiveList.body) expect(zone.active).toBe(false);

    const reactivated = await updateZone(adminToken, id, { active: true }).expect(200);
    expect(reactivated.body.active).toBe(true);
  });

  test("returns 404 for an unknown id", async () => {
    await updateZone(adminToken, "00000000-0000-4000-8000-000000000000", { name: "X" }).expect(404);
  });

  test("there is no DELETE route", async () => {
    const created = await createZone(adminToken, { name: "No se borra" }).expect(201);

    await request(server())
      .delete(`/api/v1/zones/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);
  });
});

describe("roles", () => {
  test("SELLER can read but not write", async () => {
    await listZones(sellerToken).expect(200);
    await createZone(sellerToken, { name: "Vendedor" }).expect(403);

    const created = await createZone(adminToken, { name: "Solo lectura" }).expect(201);
    await updateZone(sellerToken, created.body.id, { name: "Cambiada" }).expect(403);
  });

  test("DRIVER is refused on read", async () => {
    await listZones(driverToken).expect(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    await request(server()).get("/api/v1/zones").expect(401);
    await request(server()).post("/api/v1/zones").send({ name: "Anónima" }).expect(401);
  });
});
