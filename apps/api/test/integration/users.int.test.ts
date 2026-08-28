import request from "supertest";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;

async function login(username: string, password: string): Promise<string> {
  const response = await request(ctx.app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ username, password })
    .expect(200);
  return response.body.accessToken;
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

function server() {
  return ctx.app.getHttpServer();
}

// HU-22 §2.4 E1: "Dado el rol administrador, cuando creo un usuario con los
// roles vendedor y repartidor, entonces ese usuario accede a las funciones de
// ambos."

test("HU-22 E1: admin creates a user with SELLER and DRIVER roles, and both persist", async () => {
  const createResponse = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Multi Rol",
      username: "multi-rol",
      password: "multi-role-password",
      roles: ["SELLER", "DRIVER"],
    })
    .expect(201);

  expect(createResponse.body.roles.sort()).toEqual(["DRIVER", "SELLER"]);
  expect(createResponse.body).not.toHaveProperty("passwordHash");
  expect(JSON.stringify(createResponse.body)).not.toMatch(/passwordHash/);

  const listResponse = await request(server())
    .get("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);

  const persisted = listResponse.body.find(
    (user: { username: string }) => user.username === "multi-rol",
  );
  expect(persisted).toBeDefined();
  expect(persisted.roles.sort()).toEqual(["DRIVER", "SELLER"]);

  const patchResponse = await request(server())
    .patch(`/api/v1/users/${createResponse.body.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ roles: ["ADMIN"] })
    .expect(200);
  expect(patchResponse.body.roles).toEqual(["ADMIN"]);

  const listAfterPatch = await request(server())
    .get("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  const persistedAfterPatch = listAfterPatch.body.find(
    (user: { username: string }) => user.username === "multi-rol",
  );
  expect(persistedAfterPatch.roles).toEqual(["ADMIN"]);
});

test("create: a duplicate username is rejected with 409 Conflict", async () => {
  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Primero",
      username: "duplicate-username",
      password: "first-password",
      roles: ["SELLER"],
    })
    .expect(201);

  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Segundo",
      username: "duplicate-username",
      password: "second-password",
      roles: ["DRIVER"],
    })
    .expect(409);
});

test("update: an unknown user id is rejected with 404 Not Found", async () => {
  await request(server())
    .patch("/api/v1/users/00000000-0000-0000-0000-000000000000")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ active: false })
    .expect(404);
});

describe("GET /users filters", () => {
  let deactivatedDriverId: string;

  beforeAll(async () => {
    await request(server())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Chofer Activo",
        username: "chofer-filtro-activo",
        password: "chofer-activo-password",
        roles: ["DRIVER"],
      })
      .expect(201);

    const deactivatedDriver = await request(server())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Chofer Desactivado",
        username: "chofer-filtro-desactivado",
        password: "chofer-desactivado-password",
        roles: ["DRIVER"],
      })
      .expect(201);
    deactivatedDriverId = deactivatedDriver.body.id;

    await request(server())
      .patch(`/api/v1/users/${deactivatedDriverId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);
  });

  test("role=DRIVER brings the active driver but not the deactivated one nor the admin", async () => {
    const response = await request(server())
      .get("/api/v1/users?role=DRIVER")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const usernames = response.body.map((user: { username: string }) => user.username);
    expect(usernames).toContain("chofer-filtro-activo");
    expect(usernames).not.toContain("chofer-filtro-desactivado");
    expect(usernames).not.toContain(ADMIN_USERNAME);
  });

  test("role=DRIVER&active=false brings the deactivated driver and not the active one", async () => {
    const response = await request(server())
      .get("/api/v1/users?role=DRIVER&active=false")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const usernames = response.body.map((user: { username: string }) => user.username);
    expect(usernames).toContain("chofer-filtro-desactivado");
    expect(usernames).not.toContain("chofer-filtro-activo");
  });

  test("role=CHOFER is rejected with 400 and the Spanish message", async () => {
    const response = await request(server())
      .get("/api/v1/users?role=CHOFER")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);

    expect(JSON.stringify(response.body.message)).toContain("El rol no es un rol válido");
  });

  test("without params, deactivated users are no longer listed", async () => {
    const response = await request(server())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const usernames = response.body.map((user: { username: string }) => user.username);
    expect(usernames).toContain("chofer-filtro-activo");
    expect(usernames).not.toContain("chofer-filtro-desactivado");
  });

  test("a SELLER can GET /users (200) but gets 403 on POST /users", async () => {
    const sellerToken = await (async () => {
      const username = "vendedor-filtro-users";
      const password = `${username}-password`;
      await request(server())
        .post("/api/v1/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Vendedor Filtro", username, password, roles: ["SELLER"] })
        .expect(201);
      return login(username, password);
    })();

    await request(server())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);

    await request(server())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Rechazado",
        username: "rechazado-por-seller",
        password: "rechazado-password",
        roles: ["DRIVER"],
      })
      .expect(403);
  });
});
