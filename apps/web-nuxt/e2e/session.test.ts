import { expect, test } from "@playwright/test";
import { signIn, waitForHydration } from "./support/session";

// D-024 (ítem 7a de docs/plan-cierre-piloto.md): el refresh token vive en una
// cookie httpOnly. La sesión sobrevive a recargar, y el JavaScript de la
// página —lo único que un XSS puede ejecutar— no lo encuentra en ningún lado.

test("la sesión sobrevive a recargar sin que la página pueda leer el refresh token", async ({
  page,
  context,
}) => {
  await signIn(page);

  await page.reload();
  await waitForHydration(page);

  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  const seenByPage = await page.evaluate(() => ({
    cookies: document.cookie,
    storage: JSON.stringify({ ...localStorage }),
  }));
  expect(seenByPage.cookies).not.toContain("yacco_refresh");
  expect(seenByPage.storage).not.toMatch(/eyJ/); // ningún JWT en disco
  const cookie = (await context.cookies()).find((c) => c.name === "yacco_refresh");
  expect(cookie).toEqual(
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/api/v1/auth",
    }),
  );
});

test("cerrar sesión borra la cookie: recargar ya no vuelve a entrar", async ({ page, context }) => {
  await signIn(page);

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === "yacco_refresh"))
    .toBe(false);

  await page.goto("/routes");
  await expect(page).toHaveURL(/\/login/);
});
