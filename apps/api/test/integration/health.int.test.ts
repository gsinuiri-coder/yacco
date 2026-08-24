import request from "supertest";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// Simulates what Render injects into the service environment, set BEFORE
// the app boots because ConfigModule reads process.env at bootstrap. The
// null case (variable absent) is covered at the route by
// health.controller.test.ts without a database.
const DEPLOYED_COMMIT = "2fdd15c8aeb2f626e00e1345ef90499c7f28651a";

let ctx: TestAppContext;

beforeAll(async () => {
  process.env.RENDER_GIT_COMMIT = DEPLOYED_COMMIT;
  ctx = await startTestApp();
}, 180000);

afterAll(async () => {
  delete process.env.RENDER_GIT_COMMIT;
  await stopTestApp(ctx);
});

function server() {
  return ctx.app.getHttpServer();
}

test("GET /health is public, unversioned, returns 200 without a token and echoes the deployed commit", async () => {
  const response = await request(server()).get("/health").expect(200);
  expect(response.body).toEqual({ status: "ok", commit: DEPLOYED_COMMIT });
});

test("GET /health/db is public, unversioned, and confirms the database is reachable", async () => {
  const response = await request(server()).get("/health/db").expect(200);
  expect(response.body).toEqual({ status: "ok" });
});
