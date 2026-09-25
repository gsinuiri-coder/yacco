import { execSync } from "node:child_process";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";

// Producción NO se vuelve a sembrar: la fila de `roles` para VIEWER tiene que
// llegar por la migración (20260925010100_role_viewer_row). Los demás tests
// de integración corren migraciones Y seed, y el seed también la inserta, así
// que ninguno notaría si la migración no la creara. Acá, sólo migraciones.

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const databaseUrl = container.getConnectionUri();
  const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
}, 180000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

test("las migraciones solas dejan la fila de VIEWER, y sólo esa", async () => {
  // Sin seed, ADMIN/SELLER/DRIVER no existen: si apareciera alguno, esta base
  // se habría sembrado y el test no probaría la migración.
  const roles = await prisma.role.findMany({ select: { name: true } });
  expect(roles.map((role) => role.name)).toEqual(["VIEWER"]);
});
