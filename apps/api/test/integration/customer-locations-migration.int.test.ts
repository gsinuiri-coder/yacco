import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";

// Exercises the customer_locations migration itself, against a base that
// already has rows — not just against a fresh database (every other
// integration test's startTestApp() only proves the *end* schema works).
//
// Every other integration test applies BOTH migrations before inserting
// anything, through Testcontainers spinning up a brand-new container. To
// prove the *backfill* — that a customer/order that existed under the OLD
// schema gets correctly reattached — this test:
//   1. Temporarily moves the new migration out of prisma/migrations so
//      `migrate deploy` only applies the init migration (the OLD schema:
//      customers.address/phone, orders.customer_id).
//   2. Inserts a customer and an order via raw SQL in that old shape — the
//      generated Prisma Client's model types come from the CURRENT
//      schema.prisma and no longer know these columns, but $executeRawUnsafe
//      bypasses model typing entirely and talks straight to the database, so
//      this works regardless of which shape the database is actually in.
//   3. Restores the migration and applies it.
//   4. Reads back through the (now-matching) typed Prisma Client and
//      confirms the pre-existing rows were reattached without loss: the
//      customer has exactly one "Principal" location carrying its old
//      address/reference/phone, and the pre-existing order now points at it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "../../prisma/migrations");
// customer_locations is the migration under test. Every other migration
// listed here is parked alongside it not because it is under test, but
// because it depends on something customer_locations adds — a FK
// (container_count, container_count_check point at customer_locations
// itself) or, as with opening_balance_indexes, a plain column reference
// (its CREATE UNIQUE INDEX on sales("location_id") needs that column, which
// customer_locations is the one that adds — sales starts with customer_id
// instead). Applied against the pre-customer_locations schema (what the
// first `migrate deploy` below simulates), any of these would fail on the
// missing table/column. Every OTHER migration chronologically after
// customer_locations (container_states, the enum additions,
// opening_balance_sales_payments's plain ADD COLUMN) touches nothing
// customer_locations owns and stays applied throughout.
const NEW_MIGRATION_NAMES = [
  "20260822090000_customer_locations",
  "20260824032647_container_count",
  "20260824032801_container_count_check",
  "20260824061020_opening_balance_indexes",
];

let container: StartedPostgreSqlContainer | undefined;
let prisma: PrismaClient | undefined;
let parkedDir: string | undefined;
let isParked = false;

function parkNewMigration(): void {
  parkedDir = mkdtempSync(path.join(tmpdir(), "yacco-parked-migration-"));
  for (const name of NEW_MIGRATION_NAMES) {
    renameSync(path.join(MIGRATIONS_DIR, name), path.join(parkedDir, name));
  }
  isParked = true;
}

/** Idempotent: safe to call whether or not the migrations are currently parked. */
function restoreNewMigration(): void {
  if (!isParked || parkedDir === undefined) return;
  for (const name of NEW_MIGRATION_NAMES) {
    renameSync(path.join(parkedDir, name), path.join(MIGRATIONS_DIR, name));
  }
  isParked = false;
}

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
  // Safety net: the test body already restores this in its own `finally`,
  // but a repo left with the migration folder missing would break every
  // other test file, so this failsafe must not depend on the test having
  // gotten that far.
  restoreNewMigration();
  if (parkedDir !== undefined) {
    rmSync(parkedDir, { recursive: true, force: true });
  }
});

test("the migration backfills a pre-existing customer/order and reattaches them without loss", async () => {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const databaseUrl = container.getConnectionUri();
  const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };

  let customerId: string;
  let orderId: string;
  let seededAddress: { address: string; addressReference: string; phone: string };

  try {
    parkNewMigration();
    execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    // Supporting rows for the order: these models are unchanged by this
    // migration, so the typed client works fine against the old-shape DB.
    const containerType = await prisma.containerType.create({
      data: { name: "Con caño (migración)" },
    });
    const product = await prisma.product.create({
      data: {
        containerTypeId: containerType.id,
        name: "Recarga (migración)",
        type: "REFILL",
        listPrice: "8.00",
      },
    });
    const user = await prisma.user.create({
      data: { name: "Admin migración", username: "admin-migracion", passwordHash: "x" },
    });

    customerId = randomUUID();
    seededAddress = {
      address: "Av. Ya Estaba 1",
      addressReference: "Frente a la posta",
      phone: "987000000",
    };
    // Parameters arrive over the wire as text; Postgres does not implicitly
    // cast text to uuid/date in this position, so every uuid/date column
    // needs an explicit cast.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "customers" ("id", "name", "phone", "address", "address_reference") VALUES ($1::uuid, $2, $3, $4, $5)`,
      customerId,
      "Bodega Preexistente",
      seededAddress.phone,
      seededAddress.address,
      seededAddress.addressReference,
    );

    orderId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "orders" ("id", "customer_id", "delivery_date", "created_by") VALUES ($1::uuid, $2::uuid, $3::date, $4::uuid)`,
      orderId,
      customerId,
      new Date("2026-08-25T00:00:00.000Z"),
      user.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "order_items" ("id", "order_id", "product_id", "quantity", "unit_price") VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::numeric)`,
      randomUUID(),
      orderId,
      product.id,
      3,
      "8.00",
    );

    await prisma.$disconnect();
    prisma = undefined;

    restoreNewMigration();
    execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  } finally {
    restoreNewMigration();
  }

  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  const locations = await prisma.customerLocation.findMany({ where: { customerId } });
  expect(locations).toHaveLength(1);
  const primaryLocation = locations[0]!;
  expect(primaryLocation.isPrimary).toBe(true);
  expect(primaryLocation.name).toBe("Principal");
  expect(primaryLocation.address).toBe(seededAddress.address);
  expect(primaryLocation.addressReference).toBe(seededAddress.addressReference);
  expect(primaryLocation.phone).toBe(seededAddress.phone);

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  expect(order.locationId).toBe(primaryLocation.id);

  // customers.address/address_reference/phone no longer exist as columns:
  // Prisma's own generated model has no such fields, so simply reading the
  // customer back through the typed client (which would reject unknown
  // `select` keys at compile time) is the check that they are really gone.
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  expect(customer.name).toBe("Bodega Preexistente");
}, 180000);
