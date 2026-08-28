import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const jwtService = new JwtService();

let ctx: TestAppContext;

beforeAll(async () => {
  ctx = await startTestApp();
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

function server() {
  return ctx.app.getHttpServer();
}

// HU-23 §2.4 E1: "Dado un usuario activo, cuando inicia sesión con
// credenciales válidas, entonces accede solo a las funciones de sus roles;
// con credenciales inválidas, el acceso se rechaza."

test("HU-23 E1: valid login grants access to role-scoped endpoints", async () => {
  const loginResponse = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);

  expect(typeof loginResponse.body.accessToken).toBe("string");
  expect(loginResponse.body.accessToken.split(".")).toHaveLength(3);
  expect(typeof loginResponse.body.refreshToken).toBe("string");

  const usersResponse = await request(server())
    .get("/api/v1/users")
    .set("Authorization", `Bearer ${loginResponse.body.accessToken}`)
    .expect(200);

  expect(
    usersResponse.body.some((user: { username: string }) => user.username === ADMIN_USERNAME),
  ).toBe(true);
});

test("HU-23 E1: invalid credentials are rejected", async () => {
  const response = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: "definitely-wrong" })
    .expect(401);

  expect(response.body.accessToken).toBeUndefined();
});

test("HU-23 E1: an inactive user is rejected even with the correct password", async () => {
  const adminLogin = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);
  const adminToken = adminLogin.body.accessToken as string;

  const created = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Cuenta Desactivada",
      username: "inactive-user",
      password: "throwaway-password",
      roles: ["SELLER"],
    })
    .expect(201);

  await request(server())
    .patch(`/api/v1/users/${created.body.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ active: false })
    .expect(200);

  await request(server())
    .post("/api/v1/auth/login")
    .send({ username: "inactive-user", password: "throwaway-password" })
    .expect(401);
});

test("refresh: a valid refresh token issues a new access token", async () => {
  const login = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);

  const refreshResponse = await request(server())
    .post("/api/v1/auth/refresh")
    .set("Authorization", `Bearer ${login.body.refreshToken}`)
    .expect(200);

  // Two tokens signed within the same second with identical claims are
  // byte-identical (deterministic HS256, second-granularity `iat`) — that's
  // not a bug, so this only asserts the refreshed token is well-formed and
  // itself grants access, which is what HU-23's refresh flow actually promises.
  const newAccessToken = refreshResponse.body.accessToken as string;
  expect(newAccessToken.split(".")).toHaveLength(3);

  await request(server())
    .get("/api/v1/users")
    .set("Authorization", `Bearer ${newAccessToken}`)
    .expect(200);
});

test("refresh: an access token cannot be used at /auth/refresh", async () => {
  const login = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);

  await request(server())
    .post("/api/v1/auth/refresh")
    .set("Authorization", `Bearer ${login.body.accessToken}`)
    .expect(401);
});

test("role guard: a SELLER-only user is denied ADMIN-only endpoints, and no token is rejected outright", async () => {
  const adminLogin = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);
  const adminToken = adminLogin.body.accessToken as string;

  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Solo Vendedor",
      username: "seller-only",
      password: "seller-password",
      roles: ["SELLER"],
    })
    .expect(201);

  const sellerLogin = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: "seller-only", password: "seller-password" })
    .expect(200);

  // POST /users sigue siendo solo ADMIN — GET /users ya no sirve como
  // ejemplo genérico de endpoint ADMIN-only porque este PR lo abre a SELLER
  // (necesario para el select de chofer al planificar rutas).
  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${sellerLogin.body.accessToken}`)
    .send({
      name: "Rechazado",
      username: "seller-cannot-create",
      password: "seller-cannot-create-password",
      roles: ["DRIVER"],
    })
    .expect(403);

  await request(server()).get("/api/v1/users").expect(401);
});

test("refresh: a user deactivated after issuing a refresh token loses access on refresh", async () => {
  const adminLogin = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);
  const adminToken = adminLogin.body.accessToken as string;

  const created = await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Se Desactiva Luego",
      username: "deactivated-after-refresh",
      password: "throwaway-password",
      roles: ["DRIVER"],
    })
    .expect(201);

  const driverLogin = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: "deactivated-after-refresh", password: "throwaway-password" })
    .expect(200);
  const driverRefreshToken = driverLogin.body.refreshToken as string;

  await request(server())
    .patch(`/api/v1/users/${created.body.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ active: false })
    .expect(200);

  await request(server())
    .post("/api/v1/auth/refresh")
    .set("Authorization", `Bearer ${driverRefreshToken}`)
    .expect(401);
});

// The strategies' `type` claim check is defense-in-depth beyond secret
// separation: forge a token with the RIGHT secret for its guard but the
// WRONG `type`, so the request only fails at the strategy's own check.

test("access guard: a token signed with the access secret but type=refresh is rejected", async () => {
  const forgedToken = jwtService.sign(
    { sub: "irrelevant", username: "irrelevant", roles: ["ADMIN"], type: "refresh" },
    { secret: process.env.JWT_ACCESS_SECRET as string, expiresIn: "15m" },
  );

  await request(server())
    .get("/api/v1/users")
    .set("Authorization", `Bearer ${forgedToken}`)
    .expect(401);
});

test("refresh guard: a token signed with the refresh secret but type=access is rejected", async () => {
  const forgedToken = jwtService.sign(
    { sub: "irrelevant", username: "irrelevant", roles: ["ADMIN"], type: "access" },
    { secret: process.env.JWT_REFRESH_SECRET as string, expiresIn: "30d" },
  );

  await request(server())
    .post("/api/v1/auth/refresh")
    .set("Authorization", `Bearer ${forgedToken}`)
    .expect(401);
});
