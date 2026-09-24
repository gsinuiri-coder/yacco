import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { limaToday } from "@yacco/shared";
import type { Route, RouteStop } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { DRIVER, buildRoute, buildStop, pageOf } from "../support/fixtures";
import { stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

// «Mi ruta» (HU-11 a HU-14 en el celular, en línea): el chofer ve SUS rutas
// del día y registra cada parada con el mismo PATCH que usa la oficina. La API
// ya filtra GET /routes por el chofer; la pantalla pide solo las de hoy.

const cleanups: Array<() => void> = [];

function stubMyRoute(routes: Route[] | Route[][]) {
  const versions = Array.isArray(routes[0]) ? (routes as Route[][]) : [routes as Route[]];
  let listCalls = 0;
  const queries: Array<Record<string, unknown>> = [];
  cleanups.push(
    registerEndpoint("/api/v1/routes", {
      method: "GET",
      handler: (event) => {
        queries.push(Object.fromEntries(new URL(event.path, "http://x").searchParams));
        return pageOf(versions[Math.min(listCalls++, versions.length - 1)]!);
      },
    }),
    registerEndpoint("/api/v1/routes/r-1/truck-stock", () => [
      { containerType: { id: "ct-bidon", name: "Bidón 20L" }, loaded: 10, onBoard: 7 },
    ]),
    registerEndpoint("/api/v1/products", () => [
      {
        id: "p-recarga",
        name: "Recarga 20L",
        type: "REFILL",
        containerType: { id: "ct-bidon", name: "Bidón 20L" },
        listPrice: "12.50",
        active: true,
      },
    ]),
    registerEndpoint("/api/v1/container-types", () => [
      { id: "ct-bidon", name: "Bidón 20L", active: true },
    ]),
    registerEndpoint("/api/v1/payment-methods", () => [
      { id: "m-cash", name: "Efectivo", active: true, requiresConfirmation: false },
    ]),
    registerEndpoint("/api/v1/customers/c-central/effective-prices", () => [
      { product: { id: "p-recarga", name: "Recarga 20L" }, price: "12.50", source: "CUSTOMER" },
    ]),
  );
  return { queries };
}

async function renderMyRoute(path = "/my-route") {
  await renderSuspended(App, { route: path });
  await screen.findByRole("heading", { name: "Mi ruta", level: 1 });
}

const pending = buildStop({ origin: "VAN_SALE" });
const delivered: RouteStop = { ...pending, status: "DELIVERED" };

describe("Mi ruta", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["DRIVER"], DRIVER.username));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("quien solo es chofer entra directo a su ruta y el menú no le ofrece nada más", async () => {
    stubMyRoute([buildRoute({ status: "IN_PROGRESS", stops: [pending] })]);

    await renderSuspended(App, { route: "/customers" });

    await screen.findByRole("heading", { name: "Mi ruta", level: 1 });
    expect(useRouter().currentRoute.value.path).toBe("/my-route");
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Mi ruta" })).toBeTruthy());
    expect(within(nav).queryByRole("link", { name: "Clientes" })).toBeNull();
  });

  it("pide solo las rutas de hoy y muestra cada parada con lo que sirve en la calle", async () => {
    const { queries } = stubMyRoute([buildRoute({ status: "IN_PROGRESS", stops: [pending] })]);

    await renderMyRoute();

    const stop = await screen.findByRole("article", { name: "Parada 1: Bodega Central" });
    expect(within(stop).getByText("Av. Siempre Viva 123")).toBeTruthy();
    expect(within(stop).getByText("Portón verde")).toBeTruthy();
    expect(
      within(stop)
        .getByRole("link", { name: /Llamar/ })
        .getAttribute("href"),
    ).toBe("tel:987000111");
    expect(queries[0]).toEqual(expect.objectContaining({ date: limaToday() }));
    const truck = screen.getByRole("group", { name: "Queda arriba del camión" });
    expect(within(truck).getByText("7 × Bidón 20L")).toBeTruthy();
  });

  it("registra una entrega con el precio pactado, sin campo para cambiarlo", async () => {
    stubMyRoute([
      [buildRoute({ status: "IN_PROGRESS", stops: [pending] })],
      [buildRoute({ status: "IN_PROGRESS", stops: [delivered] })],
    ]);
    const bodies = stubWrite(cleanups, "/api/v1/routes/r-1/stops/stop-1", "PATCH", () => delivered);
    const user = userEvent.setup();

    await renderMyRoute();
    await user.click(await screen.findByRole("button", { name: "Registrar la parada 1" }));
    const form = await screen.findByRole("form", {
      name: "Registrar la parada de Bodega Central",
    });
    await user.click(within(form).getByLabelText("Producto 1"));
    await user.click(await screen.findByRole("option", { name: "Recarga 20L" }));
    expect(within(form).queryByLabelText("Precio cobrado del producto 1")).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Registrar la parada" }));

    await waitFor(() =>
      expect(bodies).toEqual([
        expect.objectContaining({
          status: "DELIVERED",
          items: [{ productId: "p-recarga", quantity: 1 }],
        }),
      ]),
    );
    const stop = await screen.findByRole("article", { name: "Parada 1: Bodega Central" });
    await waitFor(() => expect(within(stop).getByText("Entregada")).toBeTruthy());
  });

  it("una ruta que todavía no salió se inicia desde acá", async () => {
    stubMyRoute([
      [buildRoute({ status: "PLANNED", stops: [pending] })],
      [buildRoute({ status: "IN_PROGRESS", stops: [pending] })],
    ]);
    const bodies = stubWrite(cleanups, "/api/v1/routes/r-1/start", "PATCH", () =>
      buildRoute({ status: "IN_PROGRESS", stops: [pending] }),
    );
    const user = userEvent.setup();

    await renderMyRoute();
    expect(screen.queryByRole("button", { name: "Registrar la parada 1" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Salir a ruta" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Registrar la parada 1" })).toBeTruthy();
  });

  it("sin rutas hoy lo dice", async () => {
    stubMyRoute([]);

    await renderMyRoute();

    expect(await screen.findByText("Hoy no tienes rutas asignadas.")).toBeTruthy();
  });
});
