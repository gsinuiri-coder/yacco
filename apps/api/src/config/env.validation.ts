// class-transformer's @Type() needs Reflect.getMetadata; this file is
// sometimes the first thing loaded (e.g. by its own unit test), so it can't
// rely on some other module having imported reflect-metadata first.
import "reflect-metadata";
import { Transform, Type, plainToInstance } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from "class-validator";

// Prisma resolves DIRECT_URL eagerly too (it's declared in the datasource
// block), so a malformed/missing value must fail the same way as DATABASE_URL.
const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/.+/;

const WEB_ORIGIN_DEFAULT = "http://localhost:5173";

/**
 * WEB_ORIGIN is a comma-separated list, so a local Vite dev server and the
 * deployed frontend can both be allowed at once — pointing it only at the
 * deployed origin would break local development against production. The
 * single-origin form still works: it is just a list of one. Each value is
 * trimmed, and empty entries (a stray or trailing comma) are dropped rather
 * than becoming a "" origin. `undefined` (the variable unset) falls back to
 * the local dev default before parsing.
 */
export function parseWebOrigins(raw: string | undefined): string[] {
  const source = raw === undefined ? WEB_ORIGIN_DEFAULT : raw;
  return source
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export class EnvironmentVariables {
  @IsString()
  @Matches(POSTGRES_URL_PATTERN, {
    message: "DATABASE_URL must be a postgresql:// connection string",
  })
  DATABASE_URL!: string;

  @IsString()
  @Matches(POSTGRES_URL_PATTERN, {
    message: "DIRECT_URL must be a postgresql:// connection string",
  })
  DIRECT_URL!: string;

  @IsString()
  @IsNotEmpty({ message: "JWT_ACCESS_SECRET must not be empty" })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty({ message: "JWT_ACCESS_EXPIRES_IN must not be empty" })
  JWT_ACCESS_EXPIRES_IN!: string;

  @IsString()
  @IsNotEmpty({ message: "JWT_REFRESH_SECRET must not be empty" })
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsNotEmpty({ message: "JWT_REFRESH_EXPIRES_IN must not be empty" })
  JWT_REFRESH_EXPIRES_IN!: string;

  // 0 is a legitimate value (let the OS assign an ephemeral port), used by
  // tests that boot the real app against a random free port.
  @Type(() => Number)
  @IsInt({ message: "PORT must be an integer" })
  @Min(0)
  @Max(65535)
  PORT!: number;

  /**
   * Origins allowed by CORS (app.enableCors in main.ts), parsed from a
   * comma-separated string to a list. A silently empty list would let the
   * API start yet reject every browser request with no clear signal, so an
   * empty result after parsing (e.g. WEB_ORIGIN="" or ",,") fails the boot
   * instead — see parseWebOrigins above.
   */
  @Transform(({ value }: { value: unknown }) =>
    parseWebOrigins(typeof value === "string" ? value : undefined),
  )
  @IsArray({ message: "WEB_ORIGIN must be a comma-separated list of origins" })
  @ArrayNotEmpty({ message: "WEB_ORIGIN must include at least one origin" })
  @IsString({ each: true })
  WEB_ORIGIN: string[] = parseWebOrigins(undefined);

  /**
   * Injected by Render into the service environment: the git commit the
   * running build was made from. Surfaced by GET /health so what is deployed
   * can be compared against the tip of main in seconds — an auto-deploy that
   * silently never fired (it happened, 2026-08-24) is otherwise invisible
   * until some consequence shows up. Absent locally and in tests on purpose;
   * HealthService reports null then, never a guess.
   */
  @IsOptional()
  @IsString()
  RENDER_GIT_COMMIT?: string;
}

/**
 * Passed to ConfigModule.forRoot({ validate }) so a missing or malformed
 * required variable fails the Nest bootstrap itself — not the first request
 * or the first Prisma query that happens to touch it.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join("; "))
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return validated;
}
