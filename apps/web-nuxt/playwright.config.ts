import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de navegador contra el stack real: la API compilada (`apps/api/dist`)
 * en el 3100, que es donde el proxy de desarrollo de Nuxt la busca
 * (`config/api-proxy.ts`, LOCAL_API_ORIGIN), y `nuxt dev` en el 3000.
 *
 * `nuxt dev` y no un build: el build de producción apunta el proxy a la demo
 * de Cloud Run (D-011), y estos tests escriben datos.
 *
 * Fuera de CI se reutiliza lo que ya esté corriendo (`pnpm dev:api` con
 * PORT=3100 y el dev de Nuxt). En CI el job levanta los dos con la base `e2e`
 * del Postgres de servicio (.github/workflows/ci.yml).
 */
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.test.ts",
  // Los tests comparten una base: en serie, para que un conteo no dependa del
  // orden en que terminan otros.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  // `nuxt dev` compila cada página la primera vez que se pide.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node ../api/dist/main.js",
      url: "http://localhost:3100/health",
      env: { PORT: "3100" },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: "pnpm exec nuxt dev --port 3000",
      url: "http://localhost:3000/login",
      reuseExistingServer: !CI,
      timeout: 240_000,
    },
  ],
});
