import "reflect-metadata";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { isEntryPointMatch } from "./load-roster.js";
import { assertLocalDatabaseUrl } from "./test-data-plan.js";

/**
 * `pnpm demo:prueba` (ítem K de docs/plan-final.md): carga los datos de
 * prueba en la base LOCAL de Docker por los servicios de la app, en proceso,
 * igual que load-roster.ts. Idempotente: ver TestDataSeeder.
 *
 * Imprime las contraseñas de los usuarios que crea. Puede hacerlo porque
 * antes de abrir una sola conexión rechaza cualquier base que no esté en
 * esta máquina: nunca corre contra Neon ni producción.
 *
 * Nunca rechaza: reporta y deja `process.exitCode`, así un test de
 * integración puede llamar a `main()` y mirar la salida.
 */
export async function main(): Promise<void> {
  try {
    // El mismo .env que lee ConfigModule al arrancar la app, cargado acá para
    // que la barrera mire la base de verdad. No pisa lo que ya venga del
    // entorno, igual que ConfigModule.
    loadDotEnv();
    assertLocalDatabaseUrl(process.env.DATABASE_URL);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  // Import diferido, como en load-roster.ts: AppModule valida el entorno al
  // cargarse, y eso tiene que pasar después de la barrera de arriba.
  const { AppModule } = await import("../app.module.js");
  const { TestDataSeeder } = await import("./test-data-seeder.js");

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
  } catch {
    console.error("No se pudo conectar con la base local. ¿Corriste «pnpm demo:up»?");
    process.exitCode = 1;
    return;
  }

  try {
    // El admin que siembra prisma/seed.ts queda como autor de todo lo cargado.
    const report = await new TestDataSeeder(app, "admin").run();
    console.log("Datos de prueba en la base local:");
    for (const line of report.lines) console.log(`  ${line}`);
    if (report.createdUsers.length > 0) {
      console.log("\nContraseñas de los usuarios nuevos (solo se muestran esta vez):");
      for (const user of report.createdUsers) {
        console.log(`  ${user.name} — usuario ${user.username} — contraseña ${user.password}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  process.loadEnvFile(".env");
}

if (isEntryPointMatch(fileURLToPath(import.meta.url), process.argv[1])) {
  void main();
}
