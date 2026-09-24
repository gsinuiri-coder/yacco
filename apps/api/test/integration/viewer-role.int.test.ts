import request from "supertest";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// VIEWER (ítem 3 de docs/plan-endurecimiento.md): la cuenta técnica del smoke
// del deploy. Su credencial vive en Secret Manager y la lee CI, así que si se
// filtra tiene que leer lo MENOS posible: los catálogos, que no tienen datos
// de clientes, y su propio /auth/me. Nada del padrón, los pedidos, las rutas
// ni los reportes. Cada 403 tiene su 200 de control con ADMIN: sin él, un 403
// podría venir de una ruta mal escrita y no del rol.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const VIEWER_USERNAME = "smoke-viewer";
const VIEWER_PASSWORD = "smoke-viewer-password";

let ctx: TestAppContext;
let adminToken: string;
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

function get(path: string, token: string): request.Test {
  return request(server()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  await request(server())
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Verificación automática del sistema",
      username: VIEWER_USERNAME,
      password: VIEWER_PASSWORD,
      roles: ["VIEWER"],
    })
    .expect(201);
  viewerToken = await login(VIEWER_USERNAME, VIEWER_PASSWORD);
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("lo que VIEWER NO lee", () => {
  test.each([
    "/customers",
    "/orders",
    "/routes",
    "/reports/debt",
    "/reports/loaned-containers",
    "/reports/production?dateFrom=2026-07-01&dateTo=2026-07-31",
    "/users",
    "/zones",
    "/payments",
    "/production-batches",
    "/container-movements",
    "/container-balances",
    "/container-reconciliation",
  ])("GET %s: 403 para VIEWER, 200 para ADMIN", async (path) => {
    expect((await get(path, viewerToken)).status).toBe(403);
    expect((await get(path, adminToken)).status).toBe(200);
  });
});

describe("lo que VIEWER sí lee", () => {
  test.each(["/products", "/container-types", "/payment-methods"])("GET %s: 200", async (path) => {
    expect((await get(path, viewerToken)).status).toBe(200);
  });

  test("GET /auth/me devuelve quién es, con su rol", async () => {
    const response = await get("/auth/me", viewerToken);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ username: VIEWER_USERNAME, roles: ["VIEWER"] });
    expect(typeof response.body.id).toBe("string");
  });

  test("GET /auth/me sin token: 401", async () => {
    expect((await request(server()).get("/api/v1/auth/me")).status).toBe(401);
  });
});

describe("VIEWER no escribe ni en los catálogos que lee", () => {
  test("POST /container-types: 403", async () => {
    const response = await request(server())
      .post("/api/v1/container-types")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ name: "Intento del smoke" });
    expect(response.status).toBe(403);
  });
});
