import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { adminApi, driverWithRouteToday, refillProduct } from "./support/api";
import type { DriverRoute } from "./support/api";
import { signIn } from "./support/session";

// «Mi ruta» en el celular (ítem 6 de docs/plan-cierre-piloto.md): dos choferes
// con una ruta de hoy cada uno, para que «la ruta ajena no se ve» mida algo.

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

let api: APIRequestContext;
let mine: DriverRoute;
let theirs: DriverRoute;

test.beforeAll(async () => {
  api = await adminApi();
  const unique = String(Date.now());
  mine = await driverWithRouteToday(api, "a", unique);
  theirs = await driverWithRouteToday(api, "b", unique);
});

test.afterAll(async () => {
  await api.dispose();
});

test("el chofer entra, ve SU ruta de hoy y no la del otro chofer", async ({ page }) => {
  await signIn(page, mine.driver);

  await expect(page).toHaveURL(/\/my-route$/);
  await expect(page.getByRole("heading", { name: "Mi ruta", level: 1 })).toBeVisible();
  await expect(page.getByRole("article", { name: `Parada 1: ${mine.customerName}` })).toBeVisible();
  await expect(page.getByText(theirs.customerName)).toHaveCount(0);

  // Lo que se lee en 360 px no se sale de la pantalla.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("el chofer no llega a las pantallas de la oficina", async ({ page }) => {
  await signIn(page, mine.driver);

  await page.goto("/customers");

  await expect(page).toHaveURL(/\/my-route$/);
});

test("el chofer registra una entrega desde el celular", async ({ page }) => {
  const product = await refillProduct(api);
  await signIn(page, mine.driver);

  const stop = page.getByRole("article", { name: `Parada 1: ${mine.customerName}` });
  await stop.getByRole("button", { name: "Registrar la parada 1" }).click();
  const form = page.getByRole("form", { name: `Registrar la parada de ${mine.customerName}` });
  await form.getByRole("combobox", { name: "Producto 1" }).click();
  await page.getByRole("option", { name: product.name }).click();
  await expect(form.getByLabel("Precio cobrado del producto 1")).toHaveCount(0);
  await form.getByRole("button", { name: "Registrar la parada" }).click();

  await expect(stop.getByText("Entregada")).toBeVisible();
  const truck = page.getByRole("group", { name: "Queda arriba del camión" });
  await expect(truck).toContainText(`2 × ${product.containerType.name}`);
});
