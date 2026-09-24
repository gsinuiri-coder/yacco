import { expect, test } from "@playwright/test";

// Ítem 7c de docs/plan-cierre-piloto.md: la CSP completa, verificada en la
// respuesta que sirve el build, sin romper Nuxt UI ni los íconos.

test("la página llega con la CSP completa y un nonce que cada script trae", async ({ request }) => {
  const response = await request.get("/login");
  const policy = response.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];

  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(nonce).toBeDefined();
  const html = await response.text();
  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
});

test("con la CSP puesta la app hidrata, carga fuentes e íconos y el navegador no bloquea nada", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Refused to load: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  await page.goto("/login");

  // Hidrató: el botón solo se habilita cuando corre el JavaScript de la app.
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('16px "Public Sans"')))
    .toBe(true);
  // Un ícono de Nuxt UI dibujado de verdad: el del modo de color o cualquier
  // otro que use la pantalla termina en un <svg> o en una máscara CSS.
  await page.getByLabel("Contraseña").fill("x");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("[class*='i-lucide'], svg").first()).toBeVisible();

  expect(violations).toEqual([]);
});
