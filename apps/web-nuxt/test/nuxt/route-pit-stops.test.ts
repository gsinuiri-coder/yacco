import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type {
  CreateRoutePitStopBody,
  RoutePitStopPreviewResponse,
  RoutePitStopResponse,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildRoute } from "../support/fixtures";
import { stubRouteDetail, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const ROUTE_ID = "r-1";

const SAMPLE_PREVIEW: RoutePitStopPreviewResponse = {
  containers: [
    {
      containerTypeId: "ct-spigot",
      containerTypeName: "Con caño",
      expectedFull: 10,
      expectedEmpty: 2,
      previousFullDifferences: 0,
      previousEmptyDifferences: 0,
    },
    {
      containerTypeId: "ct-no-spigot",
      containerTypeName: "Sin caño",
      expectedFull: 5,
      expectedEmpty: 1,
      previousFullDifferences: 0,
      previousEmptyDifferences: 0,
    },
  ],
  cash: {
    cashCollected: "80.00",
    cashDeliveredInPreviousPits: "0.00",
    cashExpected: "80.00",
  },
};

const SAMPLE_PIT_STOP: RoutePitStopResponse = {
  id: "pit-1",
  routeId: ROUTE_ID,
  recordedById: "u-seller",
  recordedBy: { id: "u-seller", name: "Vendedor Uno" },
  createdAt: "2026-08-28T14:30:00.000Z",
  notes: "Primera parada en planta",
  cashExpected: "80.00",
  cashDelivered: "50.00",
  cashReason: null,
  voidedAt: null,
  voidedById: null,
  voidedBy: null,
  voidReason: null,
  counts: [
    {
      id: "cnt-1",
      pitStopId: "pit-1",
      containerTypeId: "ct-spigot",
      containerType: { id: "ct-spigot", name: "Con caño" },
      expectedFull: 10,
      countedFull: 10,
      expectedEmpty: 2,
      countedEmpty: 2,
      differenceReason: null,
    },
    {
      id: "cnt-2",
      pitStopId: "pit-1",
      containerTypeId: "ct-no-spigot",
      containerType: { id: "ct-no-spigot", name: "Sin caño" },
      expectedFull: 5,
      countedFull: 5,
      expectedEmpty: 1,
      countedEmpty: 1,
      differenceReason: null,
    },
  ],
  loads: [
    {
      id: "ld-1",
      batchItemId: "bi-1",
      quantity: 4,
      batchItem: {
        id: "bi-1",
        containerTypeId: "ct-spigot",
        containerType: { id: "ct-spigot", name: "Con caño" },
        batchId: "b-1",
        batch: { id: "b-1", code: "L-001" },
      },
    },
  ],
  unloads: [
    {
      type: "EMPTY_UNLOAD",
      containerTypeId: "ct-spigot",
      containerType: { id: "ct-spigot", name: "Con caño" },
      quantity: 2,
    },
  ],
};

function stubPitStops(
  pits: RoutePitStopResponse[] = [],
  preview: RoutePitStopPreviewResponse = SAMPLE_PREVIEW,
) {
  cleanups.push(
    registerEndpoint(`/api/v1/routes/${ROUTE_ID}/pit-stops`, {
      method: "GET",
      handler: () => pits,
    }),
    registerEndpoint(`/api/v1/routes/${ROUTE_ID}/pit-stops/preview`, {
      method: "GET",
      handler: () => preview,
    }),
  );
}

async function renderRouteDetail() {
  await renderSuspended(App, { route: `/routes/${ROUTE_ID}` });
  await screen.findByRole("heading", { name: "Ruta del 28/08/2026", level: 1 });
}

describe("Paradas en planta (pits) en el detalle de ruta", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["ADMIN"]));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("con ruta en curso, vendedor y admin ven el botón «Parada en planta»; chofer no", async () => {
    stubRouteDetail(cleanups, buildRoute({ id: ROUTE_ID, status: "IN_PROGRESS" }));
    stubPitStops([]);

    await renderRouteDetail();

    // Como ADMIN
    const pitSection = await screen.findByRole("region", { name: "Paradas en planta" });
    expect(within(pitSection).getByRole("button", { name: "Parada en planta" })).toBeTruthy();

    // Como DRIVER
    resetSession();
    cleanups.push(signIn(["DRIVER"]));
    await renderRouteDetail();
    const pitSectionDriver = await screen.findByRole("region", { name: "Paradas en planta" });
    expect(within(pitSectionDriver).queryByRole("button", { name: "Parada en planta" })).toBeNull();
  });

  it("abre el formulario de parada en planta y muestra datos del preview", async () => {
    stubRouteDetail(cleanups, buildRoute({ id: ROUTE_ID, status: "IN_PROGRESS" }));
    stubPitStops([]);

    await renderRouteDetail();
    const pitSection = await screen.findByRole("region", { name: "Paradas en planta" });
    const user = userEvent.setup();
    await user.click(within(pitSection).getByRole("button", { name: "Parada en planta" }));

    // Formulario abierto
    expect(await screen.findByRole("heading", { name: "Nueva parada en planta" })).toBeTruthy();
    expect(screen.getByText("Con caño")).toBeTruthy();
    expect(screen.getByText("Sin caño")).toBeTruthy();
    expect(screen.getAllByText("S/ 80.00").length).toBeGreaterThanOrEqual(1);
  });

  it("exige motivo si hay diferencia en el cuadre de envases", async () => {
    stubRouteDetail(cleanups, buildRoute({ id: ROUTE_ID, status: "IN_PROGRESS" }));
    stubPitStops([]);

    await renderRouteDetail();
    const pitSection = await screen.findByRole("region", { name: "Paradas en planta" });
    const user = userEvent.setup();
    await user.click(within(pitSection).getByRole("button", { name: "Parada en planta" }));

    await screen.findByRole("heading", { name: "Nueva parada en planta" });
    const countedFullInput = await screen.findByLabelText("Llenos contados de Con caño");
    await user.clear(countedFullInput);
    await user.type(countedFullInput, "8");

    // Intenta enviar sin motivo
    const submitBtn = screen.getByRole("button", { name: "Registrar parada en planta" });
    await user.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toBeTruthy();
    expect(
      screen.getByText(
        "Hay una diferencia en Con caño. El motivo de la diferencia es obligatorio.",
      ),
    ).toBeTruthy();
  });

  it("permite registrar una parada en planta exitosamente", async () => {
    stubRouteDetail(cleanups, buildRoute({ id: ROUTE_ID, status: "IN_PROGRESS" }));
    stubPitStops([]);
    const postBodies = stubWrite(
      cleanups,
      `/api/v1/routes/${ROUTE_ID}/pit-stops`,
      "POST",
      () => SAMPLE_PIT_STOP,
    );

    await renderRouteDetail();
    const pitSection = await screen.findByRole("region", { name: "Paradas en planta" });
    const user = userEvent.setup();
    await user.click(within(pitSection).getByRole("button", { name: "Parada en planta" }));

    await screen.findByRole("heading", { name: "Nueva parada en planta" });
    // Efectivo entregado (los conteos ya están inicializados con los esperados)
    const cashInput = await screen.findByLabelText("Efectivo entregado");
    await user.type(cashInput, "50.00");

    const submitBtn = screen.getByRole("button", { name: "Registrar parada en planta" });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(postBodies.length).toBe(1);
    });
    const payload = postBodies[0] as CreateRoutePitStopBody;
    expect(payload.cashDelivered).toBe("50.00");
    expect(payload.counts.length).toBe(2);
  });

  it("muestra la lista de paradas y permite al admin anular con motivo", async () => {
    stubRouteDetail(cleanups, buildRoute({ id: ROUTE_ID, status: "IN_PROGRESS" }));
    stubPitStops([SAMPLE_PIT_STOP]);
    const patchBodies = stubWrite(
      cleanups,
      `/api/v1/routes/${ROUTE_ID}/pit-stops/pit-1/void`,
      "PATCH",
      () => ({
        ...SAMPLE_PIT_STOP,
        voidedAt: "2026-08-28T15:00:00.000Z",
        voidedBy: { id: "u-admin", name: "Admin" },
        voidReason: "Error en conteo de llenos",
      }),
    );

    await renderRouteDetail();
    const pitSection = await screen.findByRole("region", { name: "Paradas en planta" });
    expect(await within(pitSection).findByText(/Vendedor Uno/)).toBeTruthy();
    expect(within(pitSection).getByText("Primera parada en planta")).toBeTruthy();
    expect(within(pitSection).getByText("S/ 50.00")).toBeTruthy();

    // Botón Anular
    const user = userEvent.setup();
    const voidButton = within(pitSection).getByRole("button", { name: "Anular parada" });
    await user.click(voidButton);

    // Prompt de motivo
    const reasonInput = screen.getByPlaceholderText(/motivo de la anulación/i);
    await user.type(reasonInput, "Error en conteo de llenos");
    await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));

    await waitFor(() => {
      expect(patchBodies.length).toBe(1);
    });
    expect((patchBodies[0] as { voidReason: string }).voidReason).toBe("Error en conteo de llenos");
  });
});
