import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { RosterLoaderService } from "../../src/modules/roster-loader/roster-loader.service.js";
import type { RunRosterLoaderResult } from "../../src/modules/roster-loader/roster-loader.service.js";
import type { LoadSummary } from "../../src/modules/roster-loader/roster-loader.types.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

// CLAUDE.md — regla de catálogos: un catálogo se lee siempre de su propio
// endpoint; sin ese endpoint el campo no se ofrece en la UI. Esta suite
// prueba que /payment-methods cumple eso, y que el método sintético
// "Apertura" del cargador del padrón nunca aparece como una opción real.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../fixtures/roster");

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

let ctx: TestAppContext;
let prisma: PrismaService;
let adminToken: string;
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

function messagesOf(response: { body: { message?: string | string[] } }): string {
  const { message } = response.body;
  return Array.isArray(message) ? message.join(" | ") : (message ?? "");
}

function expectOk(
  result: RunRosterLoaderResult,
): asserts result is { ok: true; summary: LoadSummary } {
  if (!result.ok) {
    throw new Error(`expected ok:true, got issues: ${JSON.stringify(result.issues)}`);
  }
}

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  driverToken = await createUserAndLogin("repartidor-metodos", "DRIVER");
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/payment-methods", () => {
  test("by default returns only active methods", async () => {
    const response = await request(server())
      .get("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    for (const row of response.body) {
      expect(row.active).toBe(true);
    }
  });

  test("?active=false returns only inactive methods", async () => {
    const prismaService = ctx.app.get(PrismaService);
    await prismaService.paymentMethod.upsert({
      where: { name: "Apertura" },
      update: { active: false },
      create: { name: "Apertura", active: false },
    });

    const response = await request(server())
      .get("/api/v1/payment-methods?active=false")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    for (const row of response.body) {
      expect(row.active).toBe(false);
    }
    expect(response.body.map((row: { name: string }) => row.name)).toContain("Apertura");
  });

  test("?active=not-a-boolean is rejected with 400, not silently filtered to false", async () => {
    const response = await request(server())
      .get("/api/v1/payment-methods?active=cualquier-cosa")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(messagesOf(response)).toContain("verdadero o falso");
  });

  test("the four seeded methods appear with the correct requiresConfirmation", async () => {
    const response = await request(server())
      .get("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const byName = new Map(
      response.body.map((row: { name: string; requiresConfirmation: boolean }) => [
        row.name,
        row.requiresConfirmation,
      ]),
    );
    expect(byName.get("Efectivo")).toBe(false);
    expect(byName.get("Transferencia")).toBe(true);
    expect(byName.get("Yape")).toBe(true);
    expect(byName.get("Plin")).toBe(true);
  });

  test("is ordered by name ascending", async () => {
    const response = await request(server())
      .get("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${adminToken}`);

    const names = response.body.map((row: { name: string }) => row.name) as string[];
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  test("a DRIVER can read the catalog", async () => {
    const response = await request(server())
      .get("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(200);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/payment-methods");

    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/payment-methods/:id", () => {
  test("returns one method by id", async () => {
    const cash = await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } });

    const response = await request(server())
      .get(`/api/v1/payment-methods/${cash.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: cash.id,
      name: "Efectivo",
      requiresConfirmation: false,
    });
  });

  test("an unknown id is rejected with 404, in Spanish", async () => {
    const response = await request(server())
      .get(`/api/v1/payment-methods/${MISSING_UUID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(messagesOf(response)).toContain(MISSING_UUID);
  });

  test("a DRIVER can read one method by id", async () => {
    const cash = await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } });

    const response = await request(server())
      .get(`/api/v1/payment-methods/${cash.id}`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(response.status).toBe(200);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const cash = await prisma.paymentMethod.findFirstOrThrow({ where: { name: "Efectivo" } });

    const response = await request(server()).get(`/api/v1/payment-methods/${cash.id}`);

    expect(response.status).toBe(401);
  });
});

describe("data migration: wallet payment methods require confirmation", () => {
  // Guards the production discrepancy migration
  // 20260827180000_require_confirmation_wallet_payment_methods fixed: Neon
  // was seeded once before requiresConfirmation existed for these methods,
  // and Render's build runs `db:deploy` but never `db:seed`, so a stale
  // `false` never self-corrected on its own. Reads straight off
  // payment_methods (not the seed's output, not the controller's response)
  // so it goes red if that migration is ever reverted or edited.
  test("Transferencia, Yape and Plin require confirmation; Efectivo does not", async () => {
    const methods = await prisma.paymentMethod.findMany({
      where: { name: { in: ["Efectivo", "Transferencia", "Yape", "Plin"] } },
    });
    const byName = new Map(methods.map((method) => [method.name, method.requiresConfirmation]));
    expect(byName.get("Efectivo")).toBe(false);
    expect(byName.get("Transferencia")).toBe(true);
    expect(byName.get("Yape")).toBe(true);
    expect(byName.get("Plin")).toBe(true);
  });
});

describe("the roster loader's synthetic Apertura method", () => {
  test("after the loader runs, Apertura exists but does not appear in the default (active-only) listing", async () => {
    const loader = ctx.app.get(RosterLoaderService);
    const result = await loader.run({ dir: FIXTURES_DIR, cutoverDate: "2026-08-25", commit: true });
    expectOk(result);

    const apertura = await prisma.paymentMethod.findUniqueOrThrow({
      where: { name: "Apertura" },
    });
    expect(apertura.active).toBe(false);

    const response = await request(server())
      .get("/api/v1/payment-methods")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.body.map((row: { name: string }) => row.name)).not.toContain("Apertura");
  });
});
