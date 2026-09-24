import { defineConfig, devices } from "@playwright/test";

/**
 * El ciclo de revisión contra un preview de `yacco-web` desplegado (apunta a la
 * API de demo, D-011). No levanta nada: se le pasa la URL.
 *
 *   PREVIEW_URL=https://yacco-<hash>-….vercel.app
 *   VERCEL_OIDC_TOKEN=…   (atraviesa la protección de Vercel del preview)
 *   DEMO_ADMIN_PASSWORD=… (de Secret Manager, nunca impreso)
 *
 * Crea datos en demo a propósito: un chofer, un pedido y una ruta de hoy.
 */
const baseURL = process.env.PREVIEW_URL;
if (!baseURL) throw new Error("Falta PREVIEW_URL");
const oidc = process.env.VERCEL_OIDC_TOKEN;

export default defineConfig({
  testDir: "./e2e-preview",
  testMatch: "**/*.test.ts",
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL,
    extraHTTPHeaders: oidc ? { "x-vercel-trusted-oidc-idp-token": oidc } : {},
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
