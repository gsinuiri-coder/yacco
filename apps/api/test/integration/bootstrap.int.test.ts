import { execSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import request from "supertest";

// Exercises the real process entrypoint (src/main.ts) directly, not the
// Test.createTestingModule() shortcut the other integration tests use — this
// is the only test that proves global prefix, ValidationPipe, and Swagger
// wiring in main.ts itself actually work end to end.

let container: StartedPostgreSqlContainer;
let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = container.getConnectionUri();
  const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  execSync("pnpm exec prisma db seed", { env, stdio: "inherit" });

  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.PORT = "0";
  process.env.JWT_ACCESS_SECRET ??= "bootstrap-test-access-secret";
  process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
  process.env.JWT_REFRESH_SECRET ??= "bootstrap-test-refresh-secret";
  process.env.JWT_REFRESH_EXPIRES_IN ??= "30d";

  // Dynamic import, deferred until after the env vars above are set — see
  // the same note in test-app.ts's startTestApp().
  const { bootstrap } = await import("../../src/main.js");
  app = await bootstrap();
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 180000);

afterAll(async () => {
  await app?.close();
  await container?.stop();
});

test("bootstrap: the real entrypoint wires the global prefix, validation, and login", async () => {
  const loginResponse = await request(baseUrl)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: process.env.SEED_ADMIN_PASSWORD ?? "admin123" })
    .expect(200);

  expect(typeof loginResponse.body.accessToken).toBe("string");
});

test("bootstrap: the global ValidationPipe rejects unknown fields", async () => {
  await request(baseUrl)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "whatever", extraField: "not allowed" })
    .expect(400);
});

test("bootstrap: Swagger docs are served at /api/docs", async () => {
  await request(baseUrl).get("/api/docs").expect(200);
});
