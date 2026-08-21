import { execSync } from "node:child_process";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient, UserRole } from "@prisma/client";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const databaseUrl = container.getConnectionUri();
  // Explicit env so the container URL is used regardless of the ambient
  // DATABASE_URL. A plain Testcontainers Postgres has no pooler in front of
  // it, so DIRECT_URL (needed by `prisma migrate deploy`) is the same value.
  const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  execSync("pnpm exec prisma db seed", { env, stdio: "inherit" });
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
});

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

test("migrations apply and seed produces the baseline rows", async () => {
  expect(await prisma.role.count()).toBe(3);
  expect(await prisma.containerType.count()).toBe(2);
  expect(await prisma.paymentMethod.count()).toBe(4);

  const admin = await prisma.user.findUnique({
    where: { username: "admin" },
    include: { roles: { include: { role: true } } },
  });
  expect(admin).not.toBeNull();
  expect(admin?.roles.map((assignment) => assignment.role.name)).toContain(UserRole.ADMIN);
});

test("seed is idempotent: re-running it does not duplicate rows", async () => {
  const seedDatabaseUrl = container.getConnectionUri();
  execSync("pnpm exec prisma db seed", {
    env: { ...process.env, DATABASE_URL: seedDatabaseUrl, DIRECT_URL: seedDatabaseUrl },
    stdio: "inherit",
  });
  expect(await prisma.role.count()).toBe(3);
  expect(await prisma.containerType.count()).toBe(2);
  expect(await prisma.paymentMethod.count()).toBe(4);
  expect(await prisma.user.count()).toBe(1);
});
