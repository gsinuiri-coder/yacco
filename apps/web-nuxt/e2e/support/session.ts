import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const ADMIN = {
  username: "admin",
  // La del seed (`SEED_ADMIN_PASSWORD`, con el mismo valor por defecto que usan
  // los tests de integración de la API). Nunca la de un entorno real.
  password: process.env.SEED_ADMIN_PASSWORD ?? "admin123",
};

/** Espera a que la página responda a clics: hasta hidratar, nada tiene manejador. */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const app = document.querySelector("#__nuxt") as { __vue_app__?: unknown } | null;
    return app?.__vue_app__ !== undefined;
  });
  await page.waitForLoadState("networkidle");
}

export async function signIn(page: Page, user = ADMIN): Promise<void> {
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel("Usuario").fill(user.username);
  await page.getByLabel("Contraseña").fill(user.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
