import { expect, test } from "@playwright/test";
import type { APIRequestContext, Request, Response } from "@playwright/test";
import type { UserRole } from "@yacco/shared";
import { visibleNavigation } from "../app/utils/navigation";
import { adminApi } from "./support/api";
import { signIn, waitForHydration } from "./support/session";

// Ningún enlace del menú abre en 403 (segunda vuelta de la revisión final, R2).
//
// Los enlaces salen del `navigation.ts` real, no de una lista copiada: si
// mañana se suma una pantalla al menú, este test la recorre sin tocarlo. Y las
// peticiones que se revisan son las que la pantalla hace de verdad al montarse,
// contra la API compilada de este mismo commit (playwright.config.ts): un
// `@Roles` que no acompaña al menú aparece acá como el 403 que vería esa
// persona. Los 403 por rol solo pueden salir del navegador: el render del
// servidor no tiene el token (vive en memoria del navegador), así que ahí la
// API corta antes, con 401.
//
// Si aparece uno, el permiso NO se decide en el test: es una decisión de
// producto (el menú se lo esconde a ese rol, o la API se lo abre).

const PEOPLE: UserRole[][] = [["ADMIN"], ["SELLER"], ["DRIVER"], ["DRIVER", "SELLER"]];

let api: APIRequestContext;
const unique = String(Date.now());
const created: string[] = [];

test.beforeAll(async () => {
  api = await adminApi();
});

// Las personas del test no quedan activas: no aparecen en los selectores de
// chofer de otras corridas.
test.afterAll(async () => {
  for (const id of created) {
    expect((await api.patch(`users/${id}`, { data: { active: false } })).ok()).toBe(true);
  }
  await api.dispose();
});

async function personWith(roles: UserRole[]): Promise<{ username: string; password: string }> {
  const label = roles.join("-").toLowerCase();
  const person = {
    username: `menu-${label}-${unique}`,
    password: `clave-menu-${label}-${unique}`,
    name: `Menú ${roles.join(" y ")} ${unique}`,
  };
  const response = await api.post("users", { data: { ...person, roles } });
  expect(response.status(), await response.text()).toBe(201);
  created.push(((await response.json()) as { id: string }).id);
  return person;
}

for (const roles of PEOPLE) {
  test(`con ${roles.join(" + ")}, cada enlace del menú abre sin un 403`, async ({ page }) => {
    const links = visibleNavigation(roles).flatMap((section) => section.links);
    expect(links.length).toBeGreaterThan(0);
    // `nuxt dev` compila cada página la primera vez que se pide: el menú del
    // administrador son 17 pantallas, más de lo que entra en el tope general.
    test.setTimeout(60_000 + links.length * 30_000);

    await signIn(page, await personWith(roles));

    // Cada petición queda anotada con la pantalla que la hizo al salir, no con
    // la que está abierta cuando llega la respuesta.
    let current = "";
    const screenOf = new WeakMap<Request, string>();
    page.on("request", (request: Request) => {
      screenOf.set(request, current);
    });
    const forbidden: string[] = [];
    page.on("response", (response: Response) => {
      const url = new URL(response.url());
      if (response.status() === 403 && url.pathname.startsWith("/api/v1/")) {
        const screen = screenOf.get(response.request()) ?? current;
        forbidden.push(`«${screen}»: ${response.request().method()} ${url.pathname}`);
      }
    });

    for (const link of links) {
      current = link.label;
      await page.goto(link.to);
      await waitForHydration(page);
      // Abrió ESA pantalla, con la sesión puesta: no la mandó al login
      // («/login?from=…») ni a «Mi ruta».
      const url = new URL(page.url());
      expect(url.pathname, `«${link.label}»`).toBe(link.to);
    }
    // Lo que la última pantalla pidió tarde también cuenta.
    await page.waitForLoadState("networkidle");

    expect(forbidden).toEqual([]);
  });
}
