import request from "supertest";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;

beforeAll(async () => {
  ctx = await startTestApp();
  const login = await request(ctx.app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);
  adminToken = login.body.accessToken;
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
