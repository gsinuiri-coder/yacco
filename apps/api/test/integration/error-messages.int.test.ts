import request from "supertest";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;

function server() {
  return ctx.app.getHttpServer();
}

beforeAll(async () => {
  ctx = await startTestApp();
  const response = await request(server())
    .post("/api/v1/auth/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    .expect(200);
  adminToken = response.body.accessToken;
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

const BROKEN_LINK_MESSAGE = "No encontramos lo que buscas. Revisa el enlace.";

describe("AllExceptionsFilter", () => {
  // ParseUUIDPipe's own "Validation failed (uuid is expected)" — Nest's
  // English message, translated by the filter. Status stays 400.
  test("a malformed id is 400 with the translated message, not Nest's English one", async () => {
    const response = await request(server())
      .get("/api/v1/customers/no-es-un-uuid")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(BROKEN_LINK_MESSAGE);
  });

  // The router's own "Cannot GET /..." 404 for a route that matches nothing
  // — also Nest's English message, also translated. Status stays 404.
  test("an unknown route is 404 with the translated message, not Nest's English one", async () => {
    const response = await request(server())
      .get("/api/v1/ruta-que-no-existe")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(BROKEN_LINK_MESSAGE);
  });

  // A domain message CustomersService already writes in Spanish must reach
  // the client untouched — the filter must not overwrite it.
  test("a domain 404 message (already Spanish) reaches the client intact", async () => {
    const unknownId = "00000000-0000-4000-8000-000000000000";
    const response = await request(server())
      .get(`/api/v1/customers/${unknownId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(`El cliente "${unknownId}" no existe`);
  });

  // class-validator failures must keep arriving as an array of Spanish
  // messages, not get collapsed or translated by the filter.
  test("class-validator errors still arrive as an array of Spanish messages", async () => {
    const response = await request(server())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(Array.isArray(response.body.message)).toBe(true);
    expect(response.body.message).toEqual(
      expect.arrayContaining(["El nombre es obligatorio", "El teléfono es obligatorio"]),
    );
  });
});
