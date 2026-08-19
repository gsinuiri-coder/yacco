import { execSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { AppModule } from "../../../src/app.module.js";

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
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = container.getConnectionUri();
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
  execSync("pnpm exec prisma db seed", { env, stdio: "inherit" });

  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
  process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
  process.env.JWT_REFRESH_EXPIRES_IN ??= "30d";

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
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
