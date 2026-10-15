import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { adminApi } from "./support/api";
import { signIn } from "./support/session";

let api: APIRequestContext;
let userId: string;
const unique = String(Date.now());

const person = {
  username: `sidebar-${"nombre-muy-largo-".repeat(4)}${unique}`,
  password: "clave-sidebar-responsive",
  name: "Nombre largo para probar la barra lateral",
};

test.beforeAll(async () => {
  api = await adminApi();
  const response = await api.post("users", { data: { ...person, roles: ["SELLER"] } });
  expect(response.status(), await response.text()).toBe(201);
  userId = ((await response.json()) as { id: string }).id;
});

test.afterAll(async () => {
  expect((await api.patch(`users/${userId}`, { data: { active: false } })).ok()).toBe(true);
  await api.dispose();
});

test("un nombre largo no tapa la salida y la barra se puede contraer", async ({ page }) => {
  await signIn(page, person);

  const sidebar = page.locator("[data-collapsed]").first();
  const username = sidebar.getByText(person.username, { exact: true });
  const logout = sidebar.getByRole("button", { name: "Cerrar sesión" });
  await expect(username).toBeVisible();
  await expect(logout).toBeVisible();

  const [sidebarBox, usernameBox, logoutBox] = await Promise.all([
    sidebar.boundingBox(),
    username.boundingBox(),
    logout.boundingBox(),
  ]);
  expect(sidebarBox).not.toBeNull();
  expect(usernameBox).not.toBeNull();
  expect(logoutBox).not.toBeNull();
  expect(usernameBox!.x + usernameBox!.width).toBeLessThanOrEqual(logoutBox!.x);
  expect(logoutBox!.x + logoutBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(logout).toBeVisible();
  await expect(username).not.toBeVisible();
});

test.describe("en móvil", () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test("el menú abre y permite navegar", async ({ page }) => {
    await signIn(page, person);

    await page.getByRole("button", { name: "Open sidebar" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("navigation", { name: "Principal" })).toBeVisible();
    await expect(drawer.getByText(person.username, { exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();

    await drawer.getByRole("link", { name: "Clientes", exact: true }).click();
    await expect(page).toHaveURL(/\/customers$/);
  });
});
