import assert from "node:assert/strict";
import { test } from "node:test";

import { ENV_KEYS } from "./env-keys.mjs";
import { buildApiEnv } from "./env-local.mjs";

test("la configuración exige las dos coordenadas de la planta", () => {
  const requiredKeys = new Set(
    ENV_KEYS.filter((entry) => entry.required === true).map((entry) => entry.key),
  );
  assert.ok(requiredKeys.has("PLANT_LATITUDE"));
  assert.ok(requiredKeys.has("PLANT_LONGITUDE"));
});

test("env:local copia las coordenadas sin convertir sus decimales", () => {
  const contents = buildApiEnv({
    localUrl: "postgresql://local-only",
    env: {
      JWT_ACCESS_SECRET: "access",
      JWT_ACCESS_EXPIRES_IN: "15m",
      JWT_REFRESH_SECRET: "refresh",
      JWT_REFRESH_EXPIRES_IN: "30d",
      PLANT_LATITUDE: "-12.046374",
      PLANT_LONGITUDE: "-77.042793",
    },
  });

  assert.match(contents, /^PLANT_LATITUDE=-12\.046374$/m);
  assert.match(contents, /^PLANT_LONGITUDE=-77\.042793$/m);
});
