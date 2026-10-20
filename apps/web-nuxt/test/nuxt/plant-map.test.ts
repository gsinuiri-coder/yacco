import { renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlantMap from "~/components/PlantMap.client.vue";
import type { LiveMarker, StopMarker } from "~/utils/route-map";

// El mapa de Leaflet necesita un navegador de verdad; acá se reemplaza por uno
// que anota lo que el componente le pide, para probar qué dibuja y cómo.
const drawn = vi.hoisted(() => ({
  tooltips: [] as Array<{ content: unknown; permanent: boolean }>,
  clicks: [] as Array<() => void>,
  polylines: 0,
  attribution: "",
  removed: 0,
}));

vi.mock("leaflet", () => {
  function layer() {
    const self = {
      bindTooltip(content: unknown, options?: { permanent?: boolean }) {
        drawn.tooltips.push({ content, permanent: options?.permanent ?? false });
        return self;
      },
      on(_event: string, handler: () => void) {
        drawn.clicks.push(handler);
        return self;
      },
      addTo() {
        return self;
      },
    };
    return self;
  }
  const map = {
    setView: () => map,
    fitBounds: () => map,
    remove: () => {
      drawn.removed += 1;
    },
  };
  const group = {
    addTo: () => group,
    clearLayers: () => {
      drawn.tooltips = [];
      drawn.clicks = [];
      drawn.polylines = 0;
    },
  };
  const leaflet = {
    map: () => map,
    tileLayer: (_url: string, options: { attribution: string }) => {
      drawn.attribution = options.attribution;
      return { addTo: () => undefined };
    },
    layerGroup: () => group,
    circleMarker: () => layer(),
    polyline: () => {
      drawn.polylines += 1;
      return layer();
    },
  };
  return { ...leaflet, default: leaflet };
});

const POINT = { latitude: -12.05, longitude: -77.04 };

function live(overrides: Partial<LiveMarker>): LiveMarker {
  return {
    routeId: "route-1",
    label: "Juan Pérez · ABC-123 · Norte · hace 3 minutos",
    point: POINT,
    noSignal: false,
    ...overrides,
  };
}

const STOP: StopMarker = {
  id: "stop-1",
  label: "1. Bodega Rosa · Entregada",
  point: { latitude: -12.06, longitude: -77.03 },
  status: "DELIVERED",
};

function tooltipTexts(): string[] {
  return drawn.tooltips.map(({ content }) =>
    content instanceof HTMLElement ? content.textContent! : String(content),
  );
}

describe("PlantMap", () => {
  beforeEach(() => {
    drawn.tooltips = [];
    drawn.clicks = [];
    drawn.polylines = 0;
    drawn.attribution = "";
    drawn.removed = 0;
  });

  it("dibuja la planta, el recorrido, las paradas y los vehículos, con la atribución de OpenStreetMap", async () => {
    await renderSuspended(PlantMap, {
      props: {
        plant: POINT,
        live: [
          live({}),
          live({ routeId: "route-2", label: "Ana Ríos · Sin señal", noSignal: true }),
        ],
        track: [POINT, STOP.point],
        stops: [STOP],
        selectedRouteId: "route-1",
      },
    });

    expect(screen.getByRole("region", { name: "Mapa" })).toBeTruthy();
    await waitFor(() =>
      expect(tooltipTexts()).toEqual([
        "Planta",
        "1. Bodega Rosa · Entregada",
        "Juan Pérez · ABC-123 · Norte · hace 3 minutos",
        "Ana Ríos · Sin señal",
      ]),
    );
    expect(drawn.polylines).toBe(1);
    expect(drawn.attribution).toContain("OpenStreetMap");
    // La ruta elegida deja su nombre a la vista; las demás, al pasar encima.
    expect(drawn.tooltips.map(({ permanent }) => permanent)).toEqual([false, false, true, false]);
  });

  it("un nombre del padrón con HTML se muestra como texto, no se interpreta", async () => {
    const label = 'Chofer <img src="x" onerror="alert(1)"> · ABC-123';
    await renderSuspended(PlantMap, {
      props: { plant: null, live: [live({ label })], track: [], stops: [], selectedRouteId: null },
    });

    await waitFor(() => expect(drawn.tooltips).toHaveLength(1));
    const content = drawn.tooltips[0]!.content;
    expect(content).toBeInstanceOf(HTMLElement);
    expect((content as HTMLElement).textContent).toBe(label);
    expect((content as HTMLElement).querySelector("img")).toBeNull();
  });

  it("tocar un vehículo elige su ruta, y al salir de la pantalla el mapa se libera", async () => {
    const { emitted, unmount } = await renderSuspended(PlantMap, {
      props: {
        plant: null,
        live: [live({ routeId: "route-7" })],
        track: [],
        stops: [],
        selectedRouteId: null,
      },
    });

    await waitFor(() => expect(drawn.clicks).toHaveLength(1));
    drawn.clicks[0]!();
    expect(emitted().select).toEqual([["route-7"]]);

    unmount();
    expect(drawn.removed).toBe(1);
  });
});
