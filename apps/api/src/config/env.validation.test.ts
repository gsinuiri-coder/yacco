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

test("defaults WEB_ORIGIN to the local Vite dev server when unset", () => {
  const result = validateEnv(validConfig());
  expect(result.WEB_ORIGIN).toEqual(["http://localhost:5173"]);
});

describe("WEB_ORIGIN in production has no default", () => {
  // In production a silent default would not break CORS — it would make the
  // real API ACCEPT http://localhost:5173 with credentials, the origin D-013
  // removed on purpose. So the boot fails instead.
  test("APP_ENV=production without WEB_ORIGIN fails the boot, saying what is missing", () => {
    expect(() => validateEnv(validConfig({ APP_ENV: "production" }))).toThrow(
      /WEB_ORIGIN is required when APP_ENV=production/,
    );
  });

  test("APP_ENV=production with WEB_ORIGIN boots, with exactly that origin", () => {
    const result = validateEnv(
      validConfig({ APP_ENV: "production", WEB_ORIGIN: "https://yacco-web.vercel.app" }),
    );
    expect(result.WEB_ORIGIN).toEqual(["https://yacco-web.vercel.app"]);
  });

  // The one that keeps local development from breaking without anyone noticing.
  test("APP_ENV=local without WEB_ORIGIN boots with the development default", () => {
    const result = validateEnv(validConfig({ APP_ENV: "local" }));
    expect(result.WEB_ORIGIN).toEqual(["http://localhost:5173"]);
  });

  test("APP_ENV=demo without WEB_ORIGIN also keeps the development default", () => {
    const result = validateEnv(validConfig({ APP_ENV: "demo" }));
    expect(result.WEB_ORIGIN).toEqual(["http://localhost:5173"]);
  });
});

test("a single WEB_ORIGIN still works (today's deployed form)", () => {
  const result = validateEnv(validConfig({ WEB_ORIGIN: "https://app.yacco.pe" }));
  expect(result.WEB_ORIGIN).toEqual(["https://app.yacco.pe"]);
});

test("parses several comma-separated origins into a list", () => {
  const result = validateEnv(
    validConfig({ WEB_ORIGIN: "http://localhost:5173,https://app.yacco.pe" }),
  );
  expect(result.WEB_ORIGIN).toEqual(["http://localhost:5173", "https://app.yacco.pe"]);
});

test("trims whitespace around each origin", () => {
  const result = validateEnv(
    validConfig({ WEB_ORIGIN: " http://localhost:5173 , https://app.yacco.pe " }),
  );
  expect(result.WEB_ORIGIN).toEqual(["http://localhost:5173", "https://app.yacco.pe"]);
});

test("a trailing comma does not produce an empty origin", () => {
  const result = validateEnv(validConfig({ WEB_ORIGIN: "https://app.yacco.pe," }));
  expect(result.WEB_ORIGIN).toEqual(["https://app.yacco.pe"]);
});

test.each(["", ",", " , , "])("rejects a WEB_ORIGIN with no real origin (%j)", (webOrigin) => {
  expect(() => validateEnv(validConfig({ WEB_ORIGIN: webOrigin }))).toThrow(
    /WEB_ORIGIN must include at least one origin/,
  );
});
