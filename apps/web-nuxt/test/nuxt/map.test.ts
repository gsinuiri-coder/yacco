import { mockComponent, registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { LiveRouteLocations, RoutePitStop } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "~/app.vue";
import { buildRoute, buildStop } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

// HU-27: desde la planta, dónde está cada vehículo en reparto. El mapa de
// Leaflet en sí se revisa con Playwright; acá va lo que la pantalla escribe.
mockComponent("PlantMap", { template: "<div aria-label='Mapa' role='region' />" });

const cleanups: Array<() => void> = [];
const MINUTE_MS = 60_000;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

function point(recordedAt: string) {
  return {
    latitude: "-12.046374",
    longitude: "-77.042793",
    accuracyM: "8.40",
    recordedAt,
    receivedAt: recordedAt,
    vehiclePlate: "ABC123",
  };
}

function live(): LiveRouteLocations {
  return {
    staleAfterMinutes: 15,
    routes: [
      {
        routeId: "r-1",
        date: "2026-10-19",
        driverName: "Luis Quispe",
        vehiclePlate: "ABC123",
        zoneName: "Norte",
        lastPoint: point(minutesAgo(3)),
        noSignal: false,
      },
      {
        routeId: "r-2",
        date: "2026-10-19",
        driverName: "Pedro Ramos",
        vehiclePlate: "XYZ789",
        zoneName: null,
        lastPoint: point(minutesAgo(20)),
        noSignal: true,
      },
    ],
  };
}

function pit(overrides: Partial<RoutePitStop>): RoutePitStop {
  return {
    id: "pit-1",
    routeId: "r-1",
    recordedById: "u-admin",
    recordedBy: { id: "u-admin", name: "Admin" },
    createdAt: "2026-10-19T16:30:00.000Z",
    notes: null,
    cashExpected: null,
    cashDelivered: null,
    cashReason: null,
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
    counts: [],
    loads: [],
    unloads: [],
    ...overrides,
  };
}

function stubMap(latest: () => LiveRouteLocations) {
  let latestCalls = 0;
  cleanups.push(
    registerEndpoint("/api/v1/route-locations/latest", () => {
      latestCalls += 1;
      return latest();
    }),
    registerEndpoint("/api/v1/settings/plant-location", () => ({
      latitude: "-12.050000",
      longitude: "-77.040000",
    })),
  );
  return { latestCalls: () => latestCalls };
}

async function renderMap() {
  await renderSuspended(App, { route: "/map" });
  await screen.findByRole("heading", { name: "Mapa", level: 1 });
}

describe("Mapa", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["SELLER"], "vendedor"));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("HU-27 E4: muestra cada ruta en curso con chofer, placa y hace cuánto, y marca sin señal solo la vieja", async () => {
    stubMap(live);

    await renderMap();

    const fresh = await screen.findByRole("article", { name: "Ruta de Luis Quispe" });
    expect(within(fresh).getByText("Luis Quispe · ABC123 · Norte")).toBeTruthy();
    expect(within(fresh).getByText("hace 3 minutos")).toBeTruthy();
    expect(within(fresh).queryByText("Sin señal")).toBeNull();

    const stale = screen.getByRole("article", { name: "Ruta de Pedro Ramos" });
    expect(within(stale).getByText("Pedro Ramos · XYZ789 · sin zona")).toBeTruthy();
    expect(within(stale).getByText("Sin señal")).toBeTruthy();
    expect(within(stale).getByText("Sin señal · último punto hace 20 minutos")).toBeTruthy();
  });

  it("HU-27 E5: al elegir una ruta muestra sus paradas por estado y sus paradas en planta, también la anulada", async () => {
    stubMap(live);
    cleanups.push(
      registerEndpoint("/api/v1/routes/r-1", () =>
        buildRoute({
          status: "IN_PROGRESS",
          stops: [
            buildStop({
              position: 1,
              status: "DELIVERED",
              location: {
                ...buildStop().location,
                latitude: "-12.040000",
                longitude: "-77.030000",
              },
            }),
            buildStop({
              id: "stop-2",
              position: 2,
              status: "FAILED",
              location: { ...buildStop().location, customer: { id: "c-2", name: "Tienda Rosa" } },
            }),
          ],
        }),
      ),
      registerEndpoint("/api/v1/routes/r-1/pit-stops", () => [
        pit({}),
        pit({ id: "pit-2", voidedAt: "2026-10-19T17:00:00.000Z", voidReason: "Mal contado" }),
      ]),
      registerEndpoint("/api/v1/routes/r-1/location-points", () => [
        point(minutesAgo(10)),
        point(minutesAgo(3)),
      ]),
    );
    const user = userEvent.setup();

    await renderMap();
    await user.click(await screen.findByRole("button", { name: "Ver recorrido de Luis Quispe" }));

    const track = await screen.findByRole("region", { name: "Recorrido de Luis Quispe" });
    expect(await within(track).findByText("2 puntos de ubicación hoy")).toBeTruthy();
    const stops = within(track).getByRole("list", { name: "Paradas" });
    expect(within(stops).getByText("1. Bodega Central")).toBeTruthy();
    expect(within(stops).getByText("Entregada")).toBeTruthy();
    expect(within(stops).getByText("2. Tienda Rosa")).toBeTruthy();
    expect(within(stops).getByText("No entregada")).toBeTruthy();
    expect(within(stops).getByText("Sin coordenadas")).toBeTruthy();
    const pits = within(track).getByRole("list", { name: "Paradas en planta" });
    expect(within(pits).getAllByText(/Parada en planta · 19\/10\/2026 11:30/)).toHaveLength(2);
    expect(within(pits).getByText("Anulada")).toBeTruthy();
    expect(within(track).getByRole("link", { name: "Abrir la ruta" }).getAttribute("href")).toBe(
      "/routes/r-1",
    );
  });

  it("sin rutas en curso lo dice", async () => {
    stubMap(() => ({ staleAfterMinutes: 15, routes: [] }));

    await renderMap();

    expect(await screen.findByText("No hay rutas en curso ahora.")).toBeTruthy();
  });

  it("el Panel de la oficina lleva al mapa", async () => {
    stubMap(live);

    await renderSuspended(App, { route: "/" });

    const link = await screen.findByRole("link", { name: "Ver dónde están los vehículos" });
    expect(link.getAttribute("href")).toBe("/map");
  });
});

describe("Mapa — se actualiza solo", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["ADMIN"], "admin"));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("HU-27 E4: vuelve a pedir las ubicaciones cada minuto", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval"] });
    try {
      const { latestCalls } = stubMap(live);
      await renderMap();
      await waitFor(() => expect(latestCalls()).toBe(1));

      vi.advanceTimersByTime(59_000);
      expect(latestCalls()).toBe(1);
      vi.advanceTimersByTime(1_000);
      await waitFor(() => expect(latestCalls()).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
