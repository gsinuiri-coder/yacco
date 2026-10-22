import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { SyncOperationInReview, UserRole } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const CASH_ID = "44444444-4444-4444-8444-444444444444";
const CONTAINER_TYPE_ID = "55555555-5555-4555-8555-555555555555";
const ROUTE_ID = "66666666-6666-4666-8666-666666666666";
const STOP_ID = "77777777-7777-4777-8777-777777777777";

const delivered: SyncOperationInReview = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "STOP_MARK",
  version: 1,
  payload: {
    routeId: ROUTE_ID,
    stopId: STOP_ID,
    status: "DELIVERED",
    items: [{ productId: PRODUCT_ID, quantity: 2 }],
    containersReturned: [{ containerTypeId: CONTAINER_TYPE_ID, quantity: 2 }],
    payment: { paymentMethodId: CASH_ID, amount: "16.00" },
  },
  driverName: "Rosa Quispe",
  clientTimestamp: "2026-10-22T15:10:00.000Z",
  receivedAt: "2026-10-22T19:45:00.000Z",
  quarantinedAt: "2026-10-22T19:45:00.000Z",
  attempts: 1,
  rejectionReason: "Esta parada ya está No entregada",
  stop: {
    routeId: ROUTE_ID,
    routeDate: "2026-10-22",
    stopId: STOP_ID,
    customerName: "Bodega Don Lucho",
    locationName: "Principal",
    stopStatus: "FAILED",
  },
};

function stubCatalogs(): void {
  const catalogs: Record<string, unknown[]> = {
    "/api/v1/products": [{ id: PRODUCT_ID, name: "Recarga 20L con caño" }],
    "/api/v1/payment-methods": [{ id: CASH_ID, name: "Efectivo" }],
    "/api/v1/container-types": [{ id: CONTAINER_TYPE_ID, name: "Con caño" }],
  };
  for (const [path, items] of Object.entries(catalogs)) {
    cleanups.push(registerEndpoint(path, { method: "GET", handler: () => items }));
  }
}

function stubInbox(pages: SyncOperationInReview[][]): { calls: number } {
  const counter = { calls: 0 };
  cleanups.push(
    registerEndpoint("/api/v1/sync/operations/in-review", {
      method: "GET",
      handler: () => {
        const page = pages[Math.min(counter.calls, pages.length - 1)];
        counter.calls++;
        return page;
      },
    }),
  );
  return counter;
}

async function renderPage(roles: UserRole[] = ["ADMIN"]): Promise<void> {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/operations-in-review" });
  await screen.findByRole("heading", { name: "Operaciones en revisión", level: 1 });
}

describe("Operaciones en revisión", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra lo que el chofer quiso hacer, con los nombres de cada catálogo", async () => {
    stubCatalogs();
    stubInbox([[delivered]]);

    await renderPage();

    const item = (
      await screen.findByRole("heading", { name: "Bodega Don Lucho · Principal" })
    ).closest("li") as HTMLElement;
    const navigation = screen.getByRole("navigation", { name: "Principal" });
    expect(
      within(navigation)
        .getByRole("link", { name: "Operaciones en revisión" })
        .getAttribute("href"),
    ).toBe("/operations-in-review");
    expect(within(item).getByText(/Rosa Quispe lo anotó el 22\/10\/2026 10:10/)).toBeTruthy();
    expect(within(item).getByText(/llegó el 22\/10\/2026 14:45/)).toBeTruthy();
    expect(within(item).getByText(/Ruta del 22\/10\/2026/)).toBeTruthy();
    expect(within(item).getByText("No entregada")).toBeTruthy();
    expect(await within(item).findByText("Vendió 2 × Recarga 20L con caño")).toBeTruthy();
    expect(within(item).getByText("Recogió 2 vacíos de Con caño")).toBeTruthy();
    expect(within(item).getByText("Cobró S/ 16.00 en Efectivo")).toBeTruthy();
    expect(within(item).getByText("Marcar la parada como entregada")).toBeTruthy();
    expect(
      within(item).getByText("Por qué no se aplicó: Esta parada ya está No entregada"),
    ).toBeTruthy();
    expect(within(item).getByRole("link", { name: "Ver la ruta" }).getAttribute("href")).toBe(
      `/routes/${ROUTE_ID}`,
    );
  });

  it("la oficina la da por revisada con una nota y sale de la bandeja", async () => {
    stubCatalogs();
    const inbox = stubInbox([[delivered], []]);
    const bodies = stubWrite(
      cleanups,
      `/api/v1/sync/operations/${delivered.id}/resolution`,
      "PATCH",
      () => ({ id: delivered.id, resolvedAt: "2026-10-22T20:00:00.000Z", resolutionNote: "x" }),
    );
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Dar por revisada" }));
    await user.click(await screen.findByRole("button", { name: "Guardar revisión" }));
    expect(await screen.findByText("Anota qué se hizo con esta operación")).toBeTruthy();
    expect(bodies).toHaveLength(0);

    await user.type(screen.getByLabelText(/Qué se hizo/), "Se corrigió la parada");
    await user.click(screen.getByRole("button", { name: "Guardar revisión" }));

    expect(await screen.findByText("Bandeja al día")).toBeTruthy();
    expect(bodies).toEqual([{ note: "Se corrigió la parada" }]);
    expect(inbox.calls).toBe(2);
  });

  it("muestra el error de la API si otra persona ya la revisó", async () => {
    stubCatalogs();
    stubInbox([[delivered]]);
    stubWrite(
      cleanups,
      `/api/v1/sync/operations/${delivered.id}/resolution`,
      "PATCH",
      failWith(409, "Esa operación ya fue revisada"),
    );
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Dar por revisada" }));
    await user.type(await screen.findByLabelText(/Qué se hizo/), "Nada");
    await user.click(screen.getByRole("button", { name: "Guardar revisión" }));

    expect(await screen.findByText("Esa operación ya fue revisada")).toBeTruthy();
  });

  it("una operación desconocida y una sin cobro se describen igual, sin romper la bandeja", async () => {
    stubCatalogs();
    stubInbox([
      [
        {
          ...delivered,
          id: "88888888-8888-4888-8888-888888888888",
          payload: {
            routeId: ROUTE_ID,
            stopId: STOP_ID,
            status: "DELIVERED",
            items: [{ productId: "99999999-9999-4999-8999-999999999999", quantity: 1 }],
          },
        },
        {
          ...delivered,
          id: "22222222-2222-4222-8222-222222222222",
          type: "PHOTO_UPLOAD",
          version: 3,
          payload: null,
          stop: undefined,
        },
      ],
    ]);

    await renderPage();

    expect(await screen.findByText("Sin cobro: quedó fiado")).toBeTruthy();
    expect(screen.getByText("Vendió 1 × un producto que ya no figura")).toBeTruthy();
    expect(screen.getByText("Operación «PHOTO_UPLOAD», versión 3")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Operación de Rosa Quispe" })).toBeTruthy();
  });

  it("quien no es administrador no ve el enlace ni consulta la bandeja", async () => {
    const inbox = stubInbox([[delivered]]);

    await renderPage(["SELLER"]);

    const navigation = screen.getByRole("navigation", { name: "Principal" });
    expect(within(navigation).queryByRole("link", { name: "Operaciones en revisión" })).toBeNull();
    expect(
      screen.getByText("Esta bandeja solo está disponible para administradores."),
    ).toBeTruthy();
    expect(inbox.calls).toBe(0);
  });
});
