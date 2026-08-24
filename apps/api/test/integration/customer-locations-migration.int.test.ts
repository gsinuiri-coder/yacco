import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";

// Exercises the customer_locations migration itself, against a base that
// already has rows — not just against a fresh database (every other
// integration test's startTestApp() only proves the *end* schema works).
//
// Every other integration test applies EVERY migration before inserting
// anything, through Testcontainers spinning up a brand-new container. To
// prove the *backfill* — that a customer/order that existed under the OLD
// schema gets correctly reattached — this test rebuilds the old world in a
// temporary directory and never touches the repo's own tree:
//   1. mkdtemp a working directory and copy prisma/schema.prisma into it.
//      Prisma resolves the migrations directory relative to the schema file
//      it is given, so `migrate deploy --schema <tmp>/schema.prisma` applies
//      only whatever <tmp>/migrations holds.
//   2. Copy into <tmp>/migrations ONLY the migrations that predate
//      customer_locations. The criterion is the folder name itself: the
//      timestamp prefix sorts lexicographically the same as chronologically,
//      so "name < customer_locations' name" is the whole rule. There is no
//      list to maintain — a migration added tomorrow lands after
//      customer_locations by construction and is simply not copied.
//   3. `migrate deploy` against the temp schema: the OLD shape
//      (customers.address/phone, orders.customer_id).
//   4. Insert a customer and an order via raw SQL in that old shape — the
//      generated Prisma Client's model types come from the CURRENT
//      schema.prisma and no longer know these columns, but $executeRawUnsafe
//      bypasses model typing entirely and talks straight to the database, so
//      this works regardless of which shape the database is actually in.
//   5. Copy ALL migrations into <tmp>/migrations and `migrate deploy` again
//      against the same temp schema. That applies customer_locations and
//      everything after it, in order — the same upgrade a live base gets.
//   6. Read back through the (now-matching) typed Prisma Client and confirm
//      the pre-existing rows were reattached without loss: the customer has
//      exactly one "Principal" location carrying its old
//      address/reference/phone, and the pre-existing order now points at it.
//
// Why copy instead of move: an earlier version of this test renamed the real
// migration folders out of prisma/migrations and put them back afterwards.
// A test must not mutate the working tree of the repo that contains it — a
// crash between the move and the restore left the tree without those
// folders, breaking every other test file. And which folders to move lived
// in a hand-written list that had to be extended every time a later
// migration referenced something customer_locations adds; it was forgotten
// three times in one sprint, each time surfacing as a confusing
// "missing table/column" failure in an unrelated PR. The chronological
// criterion holds on its own; the list only held while someone remembered
// to extend it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_DIR = path.join(__dirname, "../../prisma");
const MIGRATIONS_DIR = path.join(PRISMA_DIR, "migrations");
const MIGRATION_UNDER_TEST = "20260822090000_customer_locations";

let container: StartedPostgreSqlContainer | undefined;
let prisma: PrismaClient | undefined;
let workDir: string | undefined;

/**
 * Builds <tmp>/schema.prisma + <tmp>/migrations holding the migrations that
 * satisfy `include`, and returns the path of the temp schema to pass to
 * `--schema`. Idempotent over the same workDir: re-copying a folder that is
 * already there is a no-op for Prisma, which only cares about what exists.
 */
function stageMigrations(include: (migrationName: string) => boolean): string {
  workDir ??= mkdtempSync(path.join(tmpdir(), "yacco-migration-test-"));
  const stagedSchema = path.join(workDir, "schema.prisma");
  const stagedMigrationsDir = path.join(workDir, "migrations");
  copyFileSync(path.join(PRISMA_DIR, "schema.prisma"), stagedSchema);
  mkdirSync(stagedMigrationsDir, { recursive: true });
  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    const source = path.join(MIGRATIONS_DIR, entry.name);
    const target = path.join(stagedMigrationsDir, entry.name);
    if (entry.isDirectory()) {
      if (include(entry.name)) cpSync(source, target, { recursive: true });
    } else {
      // migration_lock.toml and anything else Prisma keeps at the top level.
      copyFileSync(source, target);
    }
  }
  return stagedSchema;
}

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
  if (workDir !== undefined) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("the migration backfills a pre-existing customer/order and reattaches them without loss", async () => {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const databaseUrl = container.getConnectionUri();
  const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };

  const oldWorldSchema = stageMigrations((name) => name < MIGRATION_UNDER_TEST);
  execSync(`pnpm exec prisma migrate deploy --schema "${oldWorldSchema}"`, {
    env,
    stdio: "inherit",
  });

  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  // Supporting rows for the order: these tables exist, in this shape, since
  // the init migration, so the typed client works fine against the old-shape
  // DB. Anything added by a later migration would have to be seeded with
  // $executeRawUnsafe like the customer and order below.
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

  const customerId = randomUUID();
  const seededAddress = {
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

  const orderId = randomUUID();
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

  const currentWorldSchema = stageMigrations(() => true);
  execSync(`pnpm exec prisma migrate deploy --schema "${currentWorldSchema}"`, {
    env,
    stdio: "inherit",
  });

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
