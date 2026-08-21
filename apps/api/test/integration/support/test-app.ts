import { execSync } from "node:child_process";
import { INestApplication, RequestMethod, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";

export interface TestAppContext {
  app: INestApplication;
  container: StartedPostgreSqlContainer;
}

/**
 * Starts a real Postgres container, migrates + seeds it, then boots the full
 * Nest app against it — mirrors seed.smoke.int.test.ts's bootstrap so the
 * auth/users integration tests exercise the same migrate+seed path.
 */
export async function startTestApp(): Promise<TestAppContext> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const databaseUrl = container.getConnectionUri();
  // A plain Testcontainers Postgres has no pooler in front of it, so the
  // pooled and direct endpoints are the same connection.
  const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  execSync("pnpm exec prisma db seed", { env, stdio: "inherit" });

  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
  process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
  process.env.JWT_REFRESH_EXPIRES_IN ??= "30d";
  process.env.PORT ??= "0";

  // Dynamic import, deferred until after the env vars above are set:
  // app.module.ts's @Module() decorator evaluates ConfigModule.forRoot()
  // (and therefore our env validation) as soon as the module is loaded, so a
  // static top-level import here would validate against whatever the
  // ambient/.env values were at test-file load time, not these overrides.
  const { AppModule } = await import("../../../src/app.module.js");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  // Mirrors main.ts's exclude list (health checks stay unversioned there too).
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "health/db", method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();

  return { app, container };
}

export async function stopTestApp(context: TestAppContext | undefined): Promise<void> {
  await context?.app.close();
  await context?.container.stop();
}
