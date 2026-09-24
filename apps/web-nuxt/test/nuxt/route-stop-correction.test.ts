import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { RouteStatus, RouteStop, UserRole } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildRoute, buildStop } from "../support/fixtures";
import { stubRouteDetail, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

// HU-24: corregir una parada ya registrada, anulando lo anotado y volviéndolo a
// registrar. Solo ADMIN, motivo obligatorio, con la ruta ya en la calle o
// cerrada. El endpoint (PATCH .../correction) existe; esto es su pantalla.

const cleanups: Array<() => void> = [];
const CORRECTION_PATH = "/api/v1/routes/r-1/stops/stop-1/correction";

const delivered: RouteStop = buildStop({ status: "DELIVERED", origin: "VAN_SALE" });
const corrected: RouteStop = {
  ...delivered,
  correction: {
    correctedAt: "2026-09-24T15:00:00.000Z",
    correctedBy: { id: "u-admin", name: "Administrador" },
    correctionReason: "Se anotaron 3, fueron 2",
  },
};

function stubCatalogs() {
  cleanups.push(
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
    registerEndpoint("/api/v1/payment-methods", () => []),
    registerEndpoint("/api/v1/users", () => []),
    registerEndpoint("/api/v1/customers/c-central/effective-prices", () => [
      { product: { id: "p-recarga", name: "Recarga 20L" }, price: "12.50", source: "CUSTOMER" },
    ]),
  );
}

function stubRoute(status: RouteStatus, after: RouteStop = corrected) {
  stubRouteDetail(cleanups, [
    buildRoute({ status, stops: [delivered] }),
    buildRoute({ status, stops: [after] }),
  ]);
  stubCatalogs();
}

async function renderRoute() {
  await renderSuspended(App, { route: "/routes/r-1" });
  await screen.findByRole("heading", { name: "Paradas" });
}

const correctButton = () =>
  screen.queryByRole("button", { name: "Corregir la parada de Bodega Central" });

async function openCorrection() {
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Corregir la parada de Bodega Central" }));
  return screen.findByRole("form", { name: "Corregir la parada de Bodega Central" });
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

function signInAs(roles: UserRole[]) {
  resetSession();
  cleanups.push(signIn(roles));
}

describe("Corregir una parada ya registrada (HU-24)", () => {
  beforeEach(async () => {
    signInAs(["ADMIN"]);
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("E1: vuelve a registrar la entrega con los datos correctos y su motivo, y la corrección se ve en la parada", async () => {
    stubRoute("FINISHED");
    const bodies = stubWrite(cleanups, CORRECTION_PATH, "PATCH", () => corrected);
    const user = userEvent.setup();

    await renderRoute();
    const form = await openCorrection();
    await choose("Producto 1", "Recarga 20L");
    await user.clear(within(form).getByLabelText("Cantidad del producto 1"));
    await user.type(within(form).getByLabelText("Cantidad del producto 1"), "2");
    await user.type(
      within(form).getByLabelText("Motivo de la corrección"),
      "Se anotaron 3, fueron 2",
    );
    await user.click(within(form).getByRole("button", { name: "Guardar la corrección" }));

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          status: "DELIVERED",
          items: [{ productId: "p-recarga", quantity: 2 }],
          correctionReason: "Se anotaron 3, fueron 2",
        },
      ]),
    );
    expect(await screen.findByText("Motivo: Se anotaron 3, fueron 2")).toBeTruthy();
    expect(screen.getByText("Corregida")).toBeTruthy();
  });

  it("E2: corregir a no entregada manda el motivo de la falla y el de la corrección", async () => {
    stubRoute("SETTLED");
    const bodies = stubWrite(cleanups, CORRECTION_PATH, "PATCH", () => corrected);
    const user = userEvent.setup();

    await renderRoute();
    const form = await openCorrection();
    await user.click(within(form).getByRole("button", { name: "No se pudo entregar" }));
    await user.type(within(form).getByLabelText("¿Por qué no se pudo entregar?"), "Local cerrado");
    await user.type(within(form).getByLabelText("Motivo de la corrección"), "Se anotó entregada");
    await user.click(within(form).getByRole("button", { name: "Guardar la corrección" }));

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          status: "FAILED",
          failureReason: "Local cerrado",
          correctionReason: "Se anotó entregada",
        },
      ]),
    );
  });

  it("E3: sin motivo no se envía y lo dice", async () => {
    stubRoute("IN_PROGRESS");
    const bodies = stubWrite(cleanups, CORRECTION_PATH, "PATCH", () => corrected);
    const user = userEvent.setup();

    await renderRoute();
    const form = await openCorrection();
    await choose("Producto 1", "Recarga 20L");
    await user.click(within(form).getByRole("button", { name: "Guardar la corrección" }));

    expect((await within(form).findByRole("alert")).textContent).toContain(
      "Escribe el motivo de la corrección",
    );
    expect(bodies).toHaveLength(0);
  });

  it("una corrección hacia arriba sin llenos en el camión avisa, y quedó registrada igual", async () => {
    stubRoute("FINISHED");
    stubWrite(cleanups, CORRECTION_PATH, "PATCH", () => ({
      ...corrected,
      stockShortfall: [
        {
          containerTypeId: "ct-bidon",
          containerType: { id: "ct-bidon", name: "Bidón 20L" },
          available: 1,
          requested: 3,
        },
      ],
    }));
    const user = userEvent.setup();

    await renderRoute();
    const form = await openCorrection();
    await choose("Producto 1", "Recarga 20L");
    await user.type(within(form).getByLabelText("Motivo de la corrección"), "Fueron 3");
    await user.click(within(form).getByRole("button", { name: "Guardar la corrección" }));

    expect(
      await screen.findByText(/el camión tenía 1 × Bidón 20L y se registraron 3/),
    ).toBeTruthy();
  });

  it("E4: con la ruta planificada no hay nada registrado que corregir", async () => {
    stubRoute("PLANNED");

    await renderRoute();

    expect(correctButton()).toBeNull();
  });

  it("E5: un vendedor ve la ruta pero no la corrección: solo un administrador corrige", async () => {
    signInAs(["SELLER"]);
    stubRoute("FINISHED");

    await renderRoute();

    expect(correctButton()).toBeNull();
  });

  it("E5: un chofer ni siquiera llega al detalle de la ruta: queda en «Mi ruta»", async () => {
    signInAs(["DRIVER"]);
    stubRoute("FINISHED");
    cleanups.push(
      registerEndpoint("/api/v1/routes", () => ({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      })),
    );

    await renderSuspended(App, { route: "/routes/r-1" });

    await screen.findByRole("heading", { name: "Mi ruta", level: 1 });
    expect(correctButton()).toBeNull();
  });
});
