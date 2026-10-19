import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, pageOf } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

describe("tema", () => {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("Nuxt UI usa las paletas propias de Yacco, no los defaults", () => {
    const { ui } = useAppConfig();

    expect(ui.colors).toMatchObject({
      primary: "lagoon",
      secondary: "ochre",
      neutral: "basalt",
    });
  });

  // Un USelect abierto no deja el resto de la página muerta: si el body queda
  // con pointer-events: none, el clic sobre otro control solo cierra el
  // desplegable y se pierde (e2e/first-click.test.ts lo mide en el navegador).
  it("un desplegable abierto no le quita los clics al resto de la página", async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
    cleanups.push(
      registerEndpoint("/api/v1/customers", () => pageOf([buildCustomer()])),
      registerEndpoint("/api/v1/zones", () => [
        { id: "zone-parque", name: "Parque", deliveryDays: [], active: true },
      ]),
    );
    const user = userEvent.setup();

    await renderSuspended(App, { route: "/customers" });
    await screen.findByText("Bodega Santa Rosa");
    await user.click(screen.getByRole("combobox", { name: "Zona" }));
    await screen.findByRole("option", { name: "Parque" });

    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
