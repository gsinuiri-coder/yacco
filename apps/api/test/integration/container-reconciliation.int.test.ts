import request from "supertest";
import { ContainerMovementType, ContainerState } from "@prisma/client";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { ContainerMovementsService } from "../../src/modules/container-movements/container-movements.service.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

let ctx: TestAppContext;
let adminToken: string;
let sellerToken: string;
let driverToken: string;
let containerTypeA: string;
let containerTypeB: string;
let locationA: string;
let locationB: string;

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

function createMovement(token: string, overrides: Record<string, unknown>) {
  return request(server())
    .post("/api/v1/container-movements")
    .set("Authorization", `Bearer ${token}`)
    .send(overrides);
}

function createCount(token: string, overrides: Record<string, unknown>) {
  return request(server())
    .post("/api/v1/container-counts")
    .set("Authorization", `Bearer ${token}`)
    .send(overrides);
}

function getReconciliation(token: string) {
  return request(server())
    .get("/api/v1/container-reconciliation")
    .set("Authorization", `Bearer ${token}`);
}

interface Discrepancy {
  locationId: string;
  containerTypeId: string;
  ledgerQuantity: number;
  materializedQuantity: number;
  difference: number;
}

function findDiscrepancy(
  discrepancies: Discrepancy[],
  locationId: string,
  containerTypeId: string,
): Discrepancy | undefined {
  return discrepancies.find(
    (d) => d.locationId === locationId && d.containerTypeId === containerTypeId,
  );
}

/**
 * OPENING_BALANCE only enters through `createWithinTransaction` (no public
 * route, no roster loader yet — a later PR), so this test seeds one the same
 * way that future loader will: calling the service directly inside its own
 * transaction.
 */
async function createOpeningBalance(
  locationId: string,
  containerTypeId: string,
  quantity: number,
): Promise<void> {
  const prisma = ctx.app.get(PrismaService);
  const movements = ctx.app.get(ContainerMovementsService);
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: ADMIN_USERNAME } });
  await prisma.$transaction((tx) =>
    movements.createWithinTransaction(
      tx,
      {
        type: ContainerMovementType.OPENING_BALANCE,
        containerTypeId,
        quantity,
        toState: ContainerState.WITH_CUSTOMER,
        locationId,
      },
      admin.id,
    ),
  );
}

async function createCustomerLocation(name: string, phone: string): Promise<string> {
  const prisma = ctx.app.get(PrismaService);
  const customer = await request(server())
    .post("/api/v1/customers")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name, phone, address: "Av. Reconciliación 1", addressReference: "Portón gris" })
    .expect(201);
  const location = await prisma.customerLocation.findFirstOrThrow({
    where: { customerId: customer.body.id, isPrimary: true },
  });
  return location.id;
}

beforeAll(async () => {
  ctx = await startTestApp();
  adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  sellerToken = await createUserAndLogin("vendedor-cuadre", "SELLER");
  driverToken = await createUserAndLogin("repartidor-cuadre", "DRIVER");

  const prisma = ctx.app.get(PrismaService);
  const containerTypes = await prisma.containerType.findMany({ orderBy: { name: "asc" } });
  containerTypeA = containerTypes[0]!.id;
  containerTypeB = containerTypes[1]!.id;

  locationA = await createCustomerLocation("Bodega Cuadre A", "987000001");
  locationB = await createCustomerLocation("Bodega Cuadre B", "987000002");

  // Pair 1 (locationA, containerTypeA): loan, pickup, loss — the ordinary
  // debt lifecycle. Ledger: +10 -4 -1 = 5.
  await createMovement(adminToken, {
    type: "LOAN_DELIVERY",
    containerTypeId: containerTypeA,
    fromState: "FULL_ON_ROUTE",
    toState: "WITH_CUSTOMER",
    locationId: locationA,
    quantity: 10,
  }).expect(201);
  await createMovement(adminToken, {
    type: "EMPTY_PICKUP",
    containerTypeId: containerTypeA,
    fromState: "WITH_CUSTOMER",
    toState: "EMPTY_ON_ROUTE",
    locationId: locationA,
    quantity: 4,
  }).expect(201);
  await createMovement(adminToken, {
    type: "LOSS_WRITE_OFF",
    containerTypeId: containerTypeA,
    fromState: "WITH_CUSTOMER",
    locationId: locationA,
    quantity: 1,
  }).expect(201);

  // Pair 2 (locationB, containerTypeB): opening balance + a count that finds
  // more than expected. Ledger: +8 (OPENING_BALANCE) +2 (COUNT_ADJUSTMENT) = 10.
  await createOpeningBalance(locationB, containerTypeB, 8);
  await createCount(adminToken, {
    locationId: locationB,
    containerTypeId: containerTypeB,
    countedQuantity: 10,
  }).expect(201);

  // Pair 3 (locationA, containerTypeB): delivered and picked back up in
  // full — case (d), a legitimate zero-quantity row. Ledger: +3 -3 = 0.
  await createMovement(adminToken, {
    type: "LOAN_DELIVERY",
    containerTypeId: containerTypeB,
    fromState: "FULL_ON_ROUTE",
    toState: "WITH_CUSTOMER",
    locationId: locationA,
    quantity: 3,
  }).expect(201);
  await createMovement(adminToken, {
    type: "EMPTY_PICKUP",
    containerTypeId: containerTypeB,
    fromState: "WITH_CUSTOMER",
    toState: "EMPTY_ON_ROUTE",
    locationId: locationA,
    quantity: 3,
  }).expect(201);

  // Pair 4 (locationB, containerTypeA): never touched at all — case (d), no
  // row on either side.
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

describe("GET /api/v1/container-reconciliation", () => {
  test("matches with a real history built through the services, across two locations and two container types", async () => {
    const response = await getReconciliation(adminToken).expect(200);

    expect(response.body.discrepancyCount).toBe(0);
    expect(response.body.discrepancies).toEqual([]);
  });

  test("case (d): a fully returned pair and an untouched pair never appear in the report", async () => {
    const response = await getReconciliation(adminToken).expect(200);

    expect(findDiscrepancy(response.body.discrepancies, locationA, containerTypeB)).toBeUndefined();
    expect(findDiscrepancy(response.body.discrepancies, locationB, containerTypeA)).toBeUndefined();
  });

  describe("after corrupting customer_container_balances directly", () => {
    test("detects a changed quantity", async () => {
      const prisma = ctx.app.get(PrismaService);
      await prisma.$executeRawUnsafe(
        `UPDATE "customer_container_balances" SET "quantity" = "quantity" + 100 WHERE "location_id" = $1::uuid AND "container_type_id" = $2::uuid`,
        locationA,
        containerTypeA,
      );

      const response = await getReconciliation(adminToken).expect(200);

      const found = findDiscrepancy(response.body.discrepancies, locationA, containerTypeA);
      expect(found).toMatchObject({
        ledgerQuantity: 5,
        materializedQuantity: 105,
        difference: -100,
      });
    });

    test("detects a balance row deleted out from under real movements", async () => {
      const prisma = ctx.app.get(PrismaService);
      await prisma.$executeRawUnsafe(
        `DELETE FROM "customer_container_balances" WHERE "location_id" = $1::uuid AND "container_type_id" = $2::uuid`,
        locationB,
        containerTypeB,
      );

      const response = await getReconciliation(adminToken).expect(200);

      const found = findDiscrepancy(response.body.discrepancies, locationB, containerTypeB);
      expect(found).toMatchObject({ ledgerQuantity: 10, materializedQuantity: 0, difference: 10 });
    });

    test("detects a balance row with no movements behind it at all", async () => {
      const prisma = ctx.app.get(PrismaService);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "customer_container_balances" ("location_id", "container_type_id", "quantity") VALUES ($1::uuid, $2::uuid, $3)`,
        locationB,
        containerTypeA,
        7,
      );

      const response = await getReconciliation(adminToken).expect(200);

      const found = findDiscrepancy(response.body.discrepancies, locationB, containerTypeA);
      expect(found).toMatchObject({ ledgerQuantity: 0, materializedQuantity: 7, difference: -7 });
    });
  });
});

describe("role guard", () => {
  test("SELLER is refused — this is ADMIN-only", async () => {
    const response = await getReconciliation(sellerToken);
    expect(response.status).toBe(403);
  });

  test("DRIVER is refused", async () => {
    const response = await getReconciliation(driverToken);
    expect(response.status).toBe(403);
  });

  test("an unauthenticated request is refused with 401", async () => {
    const response = await request(server()).get("/api/v1/container-reconciliation");
    expect(response.status).toBe(401);
  });
});
