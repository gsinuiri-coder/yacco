import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { limaToday } from "@yacco/shared";
import type { Route, RouteStop } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "~/app.vue";
import { DRIVER, buildRoute, buildStop, pageOf } from "../support/fixtures";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

// «Mi ruta» (HU-11 a HU-14 en el celular, en línea): el chofer ve SUS rutas
// del día y registra cada parada con el mismo PATCH que usa la oficina. La API
// ya filtra GET /routes por el chofer; la pantalla pide solo las de hoy.

const cleanups: Array<() => void> = [];

function stubGeolocation(
  result:
    { latitude: number; longitude: number; accuracy: number } | { error: GeolocationPositionError },
) {
  const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback | null) => {
      if ("error" in result) {
        error?.(result.error);
        return;
      }
      success({ coords: result } as GeolocationPosition);
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  cleanups.push(() => {
    if (original === undefined) Reflect.deleteProperty(navigator, "geolocation");
    else Object.defineProperty(navigator, "geolocation", original);
  });
  return getCurrentPosition;
}

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

  it("muestra quién recibe y abre Cómo llegar cuando el local tiene coordenadas", async () => {
    const stop = buildStop({
      location: {
        ...pending.location,
        contactName: "Rosa Quispe",
        latitude: "-12.046374",
        longitude: "-77.042793",
      },
    });
    stubMyRoute([buildRoute({ status: "IN_PROGRESS", stops: [stop] })]);

    await renderMyRoute();

    const card = await screen.findByRole("article", { name: "Parada 1: Bodega Central" });
    expect(within(card).getByText("Recibe: Rosa Quispe")).toBeTruthy();
    const directions = within(card).getByRole("link", { name: "Cómo llegar" });
    expect(directions.getAttribute("href")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-12.046374%2C-77.042793",
    );
    expect(directions.getAttribute("target")).toBe("_blank");
    expect(directions.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("un enlace en la referencia se abre aparte, y un intento de HTML se ve como texto", async () => {
    const maps = "https://maps.app.goo.gl/AbC123xYz";
    const stop = buildStop({
      location: {
        ...pending.location,
        addressReference: `Portón verde <b>ojo</b> ${maps}`,
      },
    });
    stubMyRoute([buildRoute({ status: "IN_PROGRESS", stops: [stop] })]);

    await renderMyRoute();

    const card = await screen.findByRole("article", { name: "Parada 1: Bodega Central" });
    const link = within(card).getByRole("link", { name: maps });
    expect(link.getAttribute("href")).toBe(maps);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(card).getByText(/Portón verde <b>ojo<\/b>/)).toBeTruthy();
    expect(card.querySelector("b")).toBeNull();
  });

  it("registra una entrega con el precio pactado, sin campo para cambiarlo", async () => {
    stubMyRoute([
      [buildRoute({ status: "IN_PROGRESS", stops: [pending] })],
      [buildRoute({ status: "IN_PROGRESS", stops: [delivered] })],
    ]);
    const bodies = stubWrite(cleanups, "/api/v1/routes/r-1/stops/stop-1", "PATCH", () => delivered);
    const getCurrentPosition = stubGeolocation({
      latitude: -12.046374,
      longitude: -77.042793,
      accuracy: 8.4,
    });
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
          markedLatitude: "-12.046374",
          markedLongitude: "-77.042793",
          markedAccuracyM: "8.40",
        }),
      ]),
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const stop = await screen.findByRole("article", { name: "Parada 1: Bodega Central" });
    await waitFor(() => expect(within(stop).getByText("Entregada")).toBeTruthy());
  });

  it("si el chofer niega la ubicación, la parada se registra igual sin coordenadas", async () => {
    stubMyRoute([
      [buildRoute({ status: "IN_PROGRESS", stops: [pending] })],
      [buildRoute({ status: "IN_PROGRESS", stops: [delivered] })],
    ]);
    const bodies = stubWrite(cleanups, "/api/v1/routes/r-1/stops/stop-1", "PATCH", () => delivered);
    const getCurrentPosition = stubGeolocation({
      error: { code: 1, message: "Permiso denegado" } as GeolocationPositionError,
    });
    const user = userEvent.setup();

    await renderMyRoute();
    await user.click(await screen.findByRole("button", { name: "Registrar la parada 1" }));
    const form = await screen.findByRole("form", {
      name: "Registrar la parada de Bodega Central",
    });
    await user.click(within(form).getByLabelText("Producto 1"));
    await user.click(await screen.findByRole("option", { name: "Recarga 20L" }));
    await user.click(within(form).getByRole("button", { name: "Registrar la parada" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(bodies[0]).not.toHaveProperty("markedLatitude");
    expect(bodies[0]).not.toHaveProperty("markedLongitude");
    expect(bodies[0]).not.toHaveProperty("markedAccuracyM");
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

  describe("HU-27 E1: ubicación cada cierto tiempo con la ruta en curso", () => {
    function stubInterval(intervalSeconds: number) {
      cleanups.push(
        registerEndpoint("/api/v1/settings/location-tracking", () => ({ intervalSeconds })),
      );
    }

    it("manda dónde está al abrir y otra vez cuando pasa el intervalo del servidor", async () => {
      stubMyRoute([buildRoute({ status: "IN_PROGRESS", stops: [pending] })]);
      stubInterval(1);
      const bodies = stubWrite(cleanups, "/api/v1/routes/r-1/location-points", "POST", () => ({
        received: 1,
        stored: 1,
      }));
      stubGeolocation({ latitude: -12.046374, longitude: -77.042793, accuracy: 8.4 });

      await renderMyRoute();

      expect(
        await screen.findByText("La planta ve dónde estás mientras la ruta está en curso."),
      ).toBeTruthy();
      await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 3000 });
      const [first, second] = bodies as Array<{ points: Array<Record<string, string>> }>;
      expect(first!.points).toEqual([
        expect.objectContaining({
          latitude: "-12.046374",
          longitude: "-77.042793",
          accuracyM: "8.40",
        }),
      ]);
      expect(second!.points[0]!.clientPointId).not.toBe(first!.points[0]!.clientPointId);
    });

    it("lo que no llegó por falta de señal se manda con el siguiente, con el mismo identificador", async () => {
      stubMyRoute([buildRoute({ status: "IN_PROGRESS", stops: [pending] })]);
      stubInterval(1);
      let calls = 0;
      const bodies = stubWrite(cleanups, "/api/v1/routes/r-1/location-points", "POST", (event) =>
        calls++ === 0 ? failWith(503, "Sin servicio")(event) : { received: 2, stored: 2 },
      );
      stubGeolocation({ latitude: -12.046374, longitude: -77.042793, accuracy: 8.4 });

      await renderMyRoute();

      await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 3000 });
      const [first, second] = bodies as Array<{ points: Array<{ clientPointId: string }> }>;
      expect(second!.points).toHaveLength(2);
      expect(second!.points[0]!.clientPointId).toBe(first!.points[0]!.clientPointId);
    });

    it("sin permiso del navegador no manda nada y la ruta se usa igual", async () => {
      stubMyRoute([buildRoute({ status: "IN_PROGRESS", stops: [pending] })]);
      stubInterval(1);
      const bodies = stubWrite(cleanups, "/api/v1/routes/r-1/location-points", "POST");
      const getCurrentPosition = stubGeolocation({
        error: { code: 1, message: "Permiso denegado" } as GeolocationPositionError,
      });

      await renderMyRoute();

      expect(await screen.findByRole("button", { name: "Registrar la parada 1" })).toBeTruthy();
      await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(bodies).toEqual([]);
      expect(
        screen.queryByText("La planta ve dónde estás mientras la ruta está en curso."),
      ).toBeNull();
    });

    it("con la ruta todavía sin salir no pide la ubicación", async () => {
      stubMyRoute([buildRoute({ status: "PLANNED", stops: [pending] })]);
      stubInterval(1);
      const getCurrentPosition = stubGeolocation({
        latitude: -12.046374,
        longitude: -77.042793,
        accuracy: 8.4,
      });

      await renderMyRoute();

      expect(await screen.findByRole("button", { name: "Salir a ruta" })).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(getCurrentPosition).not.toHaveBeenCalled();
    });
  });

  it("sin rutas hoy lo dice", async () => {
    stubMyRoute([]);

    await renderMyRoute();

    expect(await screen.findByText("Hoy no tienes rutas asignadas.")).toBeTruthy();
  });
});

describe("Mi ruta — quien además de chofer es oficina", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["ADMIN"], "admin"));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("un administrador ve solo las rutas donde él es el chofer, no las de todos", async () => {
    // Como la API: a un administrador, sin `driverId`, le devuelve las de todos.
    const otherDriversRoute = buildRoute({ status: "IN_PROGRESS", stops: [pending] });
    cleanups.push(
      registerEndpoint("/api/v1/routes", {
        method: "GET",
        handler: (event) => {
          const driverId = new URL(event.path, "http://x").searchParams.get("driverId");
          return pageOf(
            [otherDriversRoute].filter((route) => driverId === null || route.driverId === driverId),
          );
        },
      }),
    );

    await renderMyRoute();

    expect(await screen.findByText("Hoy no tienes rutas asignadas.")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Parada 1: Bodega Central" })).toBeNull();
  });
});
