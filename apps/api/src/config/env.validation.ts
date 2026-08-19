// class-transformer's @Type() needs Reflect.getMetadata; this file is
// sometimes the first thing loaded (e.g. by its own unit test), so it can't
// rely on some other module having imported reflect-metadata first.
import "reflect-metadata";
import { Type, plainToInstance } from "class-transformer";
import { IsInt, IsNotEmpty, IsString, Matches, Max, Min, validateSync } from "class-validator";

// Prisma resolves DIRECT_URL eagerly too (it's declared in the datasource
// block), so a malformed/missing value must fail the same way as DATABASE_URL.
const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/.+/;

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
