import { validateEnv } from "./env.validation.js";

function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: "postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require",
    DIRECT_URL: "postgresql://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require",
    JWT_ACCESS_SECRET: "access-secret",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_SECRET: "refresh-secret",
    JWT_REFRESH_EXPIRES_IN: "30d",
    PORT: "3000",
    ...overrides,
  };
}

test("accepts a fully-populated, well-formed environment", () => {
  expect(() => validateEnv(validConfig())).not.toThrow();
});

test("coerces PORT from a string env value to a number", () => {
  const result = validateEnv(validConfig({ PORT: "8080" }));
  expect(result.PORT).toBe(8080);
});

test.each(["DATABASE_URL", "DIRECT_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"])(
  "rejects a missing %s",
  (key) => {
    const config = validConfig();
    delete config[key];
    expect(() => validateEnv(config)).toThrow(/Invalid environment configuration/);
  },
);

test("rejects a malformed DATABASE_URL", () => {
  expect(() => validateEnv(validConfig({ DATABASE_URL: "mysql://not-postgres" }))).toThrow(
    /DATABASE_URL must be a postgresql/,
  );
});

test("rejects a malformed DIRECT_URL", () => {
  expect(() => validateEnv(validConfig({ DIRECT_URL: "not-a-url-at-all" }))).toThrow(
    /DIRECT_URL must be a postgresql/,
  );
});

test("rejects a non-numeric PORT", () => {
  expect(() => validateEnv(validConfig({ PORT: "not-a-port" }))).toThrow(/PORT must be an integer/);
});
