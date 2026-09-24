import { defineConfig, devices } from "@playwright/test";

/**
 * Lo que solo se ve en el build de producción: hoy, la CSP (config/csp.ts),
 * que en `nuxt dev` está apagada. Sirve `.output` —el mismo Nitro que corre en
 * Vercel— en el 3001; hay que construirlo antes (`pnpm build`).
 *
 * Solo páginas públicas: el proxy del build apunta a la API de demo (D-011) y
 * estos tests no tienen credenciales de ahí. El shell, los bundles, las fuentes
 * y los íconos son los mismos en todas las pantallas.
 */
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e-prod",
  testMatch: "**/*.test.ts",
  workers: 1,
  forbidOnly: CI,
  reporter: "list",
  use: { baseURL: "http://localhost:3001" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node .output/server/index.mjs",
    url: "http://localhost:3001/login",
    env: { PORT: "3001" },
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
