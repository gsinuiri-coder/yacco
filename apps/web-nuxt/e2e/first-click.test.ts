import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { signIn, waitForHydration } from "./support/session";

// Defectos del recorrido de paridad (backlog, 2026-09-23): «el primer clic
// después de cerrar un desplegable, o de cargar una página, a veces no toma» y
// «Hydration completed but contains mismatches».

test("con un desplegable abierto, el clic en otro botón cierra el desplegable Y toma", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/routes");
  await waitForHydration(page);

  const plan = page.getByRole("link", { name: "Planificar ruta" }).first();
  const box = await plan.boundingBox();
  expect(box).not.toBeNull();

  await page.getByRole("combobox").first().click();
  await expect(page.getByRole("option").first()).toBeVisible();

  // Un clic de mouse de verdad sobre el botón, no `locator.click()`: ese
  // espera a que el elemento reciba eventos y escondería justo el defecto.
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  await expect(page).toHaveURL(/\/routes\/new$/);
});

test("el menú hidrata sin diferencias entre servidor y cliente", async ({ page }) => {
  await signIn(page);
  const mismatches: string[] = [];
  page.on("console", (message) => {
    if (/hydration/i.test(message.text())) mismatches.push(message.text());
  });

  // Carga completa (no navegación del cliente): es la que hidrata. Como ADMIN,
  // el menú tiene el enlace que solo ve ese rol.
  await page.goto("/routes");
  await waitForHydration(page);

  await expect(page.getByRole("link", { name: "Cuadre de envases" })).toBeVisible();
  expect(mismatches).toEqual([]);
});

// Sin el JavaScript de la app, la página queda como la sirvió el servidor:
// exactamente el estado de un clic que llega antes de hidratar. Se prueban por
// separado Enter y el clic en el botón, cada uno sobre una página recién
// cargada: el primer envío recarga el formulario vacío, y un segundo envío
// sobre esa página ya no tendría la contraseña que mirar.
for (const [how, send] of [
  ["con Enter", (page: Page) => page.getByLabel("Contraseña").press("Enter")],
  [
    "con el botón",
    (page: Page) => page.getByRole("button", { name: "Ingresar" }).click({ force: true }),
  ],
] as const) {
  test(`ingresar antes de que cargue la página nunca pone la contraseña en la URL (${how})`, async ({
    page,
  }) => {
    await page.route("**/_nuxt/**", (route) => route.abort());
    await page.goto("/login");
    await page.getByLabel("Usuario").fill("admin");
    await page.getByLabel("Contraseña").fill("secreto-que-no-viaja");

    // Si el navegador envía el formulario por su cuenta, navega: se espera esa
    // navegación (o que no llegue) antes de mirar la URL.
    const navigation = page.waitForEvent("framenavigated", { timeout: 5_000 }).catch(() => null);
    await send(page);
    await navigation;

    expect(page.url()).not.toContain("secreto-que-no-viaja");
  });
}
