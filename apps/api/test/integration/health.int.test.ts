import request from "supertest";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

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

test("GET /health is public, unversioned, and returns 200 without a token", async () => {
  const response = await request(server()).get("/health").expect(200);
  expect(response.body).toEqual({ status: "ok" });
});

test("GET /health/db is public, unversioned, and confirms the database is reachable", async () => {
  const response = await request(server()).get("/health/db").expect(200);
  expect(response.body).toEqual({ status: "ok" });
});
