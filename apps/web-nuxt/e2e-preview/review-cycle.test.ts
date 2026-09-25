import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Ítem 9 de docs/plan-cierre-piloto.md: el ciclo entero en el preview, como lo
// haría la planta: pedido → ruta → «Mi ruta» del chofer → liquidación →
// reportes. Datos en demo; un chofer propio de esta corrida porque cada chofer
// tiene una sola ruta por día.
//
// Ítem 3 de docs/plan-piloto.md le suma el conteo de envases de un cliente que
// entra sin ninguno —como los 604 del padrón—: desde «Envases en poder de
// clientes», con la ubicación en 0, lo contado entra como ajuste.

const CUSTOMER = /Bodega Los Jazmines \(Demo\) · piloto/;
const REFILL = "Recarga 20L con caño";
// Por patrón: la «Ñ» del catálogo real puede venir en otra forma Unicode.
const TYPE = /BIDON 20L CA/;
const unique = Date.now().toString(36);
const newCustomer = `Cliente Conteo ${unique}`;
const driver = {
  name: `Chofer Revisión ${unique}`,
  username: `chofer.revision.${unique}`,
  password: randomBytes(12).toString("base64url"),
};
const violations: string[] = [];

async function login(page: Page, username: string, password: string) {
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeEnabled();
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function pick(page: Page, label: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("listbox").getByRole("option", { name: option }).first().click();
}

test("pedido → ruta → Mi ruta → liquidación → reportes, en el preview", async ({ browser }) => {
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
  test.skip(!adminPassword, "Falta DEMO_ADMIN_PASSWORD");
  const headers = test.info().project.use.extraHTTPHeaders;
  const office = await (await browser.newContext({ extraHTTPHeaders: headers })).newPage();
  await login(office, "admin", adminPassword!);

  // Un chofer para esta corrida, desde la pantalla de usuarios.
  await office.goto("/users");
  await office.getByRole("button", { name: "Nuevo usuario" }).click();
  const newUser = office.getByRole("form", { name: "Nuevo usuario" });
  await newUser.getByLabel("Nombre").fill(driver.name);
  await newUser.getByLabel("Usuario").fill(driver.username);
  await newUser.getByLabel("Contraseña").fill(driver.password);
  await newUser.getByRole("checkbox", { name: "Chofer" }).check();
  await newUser.getByRole("button", { name: "Crear usuario" }).click();
  await expect(office.getByText(driver.name)).toBeVisible();

  // Pedido.
  await office.goto("/orders/new");
  await office.getByRole("combobox", { name: "Cliente" }).fill("Jazmines");
  await office.getByRole("option", { name: CUSTOMER }).first().click();
  await pick(office, "Producto 1", REFILL);
  await office.getByLabel("Cantidad del producto 1").fill("2");
  await office.getByRole("button", { name: "Registrar pedido" }).click();
  // Guardar vuelve a la lista de pedidos, con el nuevo arriba.
  await expect(office).toHaveURL(/\/orders$/);
  await expect(
    office
      .getByRole("link", { name: /Ver pedido de Bodega Los Jazmines \(Demo\) · piloto/ })
      .first(),
  ).toBeVisible();

  // Ruta de hoy para el chofer, con el pedido y 2 llenos FIFO.
  await office.goto("/routes/new");
  await pick(office, "Chofer", driver.name);
  await office.getByRole("button", { name: "Planificar ruta" }).click();
  await expect(office).toHaveURL(/\/routes\/[0-9a-f-]{36}$/);
  const routeUrl = office.url();
  await office.getByRole("button", { name: "Agregar parada" }).click();
  await pick(office, "Pedido pendiente", CUSTOMER);
  await office
    .getByRole("form", { name: "Agregar parada" })
    .getByRole("button", { name: "Agregar parada" })
    .click();
  await expect(office.getByText(CUSTOMER).first()).toBeVisible();
  // Agregar la parada recarga la ruta y vuelve a montar la carga del camión;
  // se elige sobre la pantalla ya asentada (probado a mano: la misma secuencia
  // sin recargar funciona, el test solo iba más rápido que ese remontaje).
  await office.reload({ waitUntil: "networkidle" });
  await pick(office, "Tipo de envase", TYPE);
  await expect(office.getByRole("combobox", { name: "Tipo de envase" })).toContainText(TYPE);
  await office.getByLabel("Cantidad").fill("2");
  await office.getByRole("button", { name: "Cargar al camión" }).click();
  await expect(office.getByRole("group", { name: "Cargado en el camión" })).toContainText(
    /2 × BIDON 20L CA/,
  );

  // El chofer, en el celular: sale, entrega lo pedido y termina.
  const phone = await (
    await browser.newContext({
      extraHTTPHeaders: headers,
      viewport: { width: 360, height: 740 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  await login(phone, driver.username, driver.password);
  await expect(phone).toHaveURL(/\/my-route$/);
  await phone.getByRole("button", { name: "Salir a ruta" }).click();
  await phone.getByRole("button", { name: "Registrar la parada 1" }).click();
  const form = phone.getByRole("form", { name: /Registrar la parada de Bodega Los Jazmines/ });
  await expect(form.getByLabel("Cantidad del producto 1")).toHaveValue("2");
  await form.getByRole("button", { name: "Registrar la parada" }).click();
  await expect(
    phone.getByRole("article", { name: /Parada 1/ }).getByText("Entregada"),
  ).toBeVisible();
  await phone.getByRole("button", { name: "Terminar ruta" }).click();
  await expect(phone.getByText("Terminada")).toBeVisible();

  // Un cliente nuevo, sin envases en el sistema, como uno del padrón: la
  // oficina cuenta lo que tiene en la mano desde «Envases en poder de clientes».
  await office.goto("/customers/new");
  await office.getByLabel("Nombre").fill(newCustomer);
  await office.getByLabel("Teléfono").fill("999000111");
  await office.getByLabel("Dirección").fill("Av. Revisión 1");
  await office.getByLabel("Referencia").fill("Portón verde");
  await office.getByRole("button", { name: "Registrar cliente" }).click();
  await expect(office).toHaveURL(/\/customers$/);
  await office.goto("/container-counts");
  await office.getByLabel("Buscar").fill(newCustomer);
  const countRow = office.getByRole("row", { name: new RegExp(newCustomer) });
  await expect(countRow.getByText("Sin contar")).toBeVisible();
  await countRow.getByRole("button", { name: "Contar" }).click();
  const countForm = office.getByRole("form", { name: "Contar envases de Principal" });
  await countForm.getByRole("combobox").click();
  await office.getByRole("option", { name: TYPE }).first().click();
  await countForm.getByRole("button", { name: "Agregar tipo" }).click();
  await countForm.getByLabel(/Contado de BIDON 20L CA/).fill("3");
  await countForm.getByRole("button", { name: "Registrar conteo" }).click();
  const review = office.getByRole("group", { name: "Revisar conteo de Principal" });
  await expect(review).toContainText(/según el sistema 0, contado 3 \(diferencia \+3\)/);
  await review.getByRole("button", { name: "Confirmar conteo" }).click();
  await expect(office.getByText(`Conteo registrado: ${newCustomer} — Principal.`)).toBeVisible();
  await expect(countRow.getByText("Sin contar")).toHaveCount(0);
  await expect(countRow).toContainText("3");

  // La oficina liquida: los 2 llenos se entregaron, no vuelve ninguno.
  await office.goto(`${routeUrl}/settlement`);
  await expect(office.getByRole("heading", { name: "Lo que dice el libro" })).toBeVisible();
  await office.getByRole("button", { name: "Liquidar la ruta" }).click();
  await expect(office.getByRole("heading", { name: "Liquidada" })).toBeVisible();

  // Reportes: la deuda del cliente, los envases prestados, la producción.
  await office.goto("/reports/debt");
  await expect(office.getByText(CUSTOMER).first()).toBeVisible();
  await office.goto("/reports/loaned-containers");
  await expect(office.getByText("Total prestado")).toBeVisible();
  await office.goto("/reports/production");
  await expect(office.getByRole("heading", { name: "Producción por período" })).toBeVisible();

  expect(violations).toEqual([]);
});
