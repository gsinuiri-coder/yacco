import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, readBody } from "h3";
import type { H3Event } from "h3";
import type { Order, Page } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildOrder, pageOf } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
type Query = Record<string, string>;

function stubOrders(respond: (query: Query) => Page<Order>): Query[] {
  const seen: Query[] = [];
  cleanups.push(
    registerEndpoint("/api/v1/orders", (event: H3Event) => {
      const query = getQuery(event) as Query;
      seen.push(query);
      return respond(query);
    }),
  );
  return seen;
}

async function renderUndelivered() {
  await renderSuspended(App, { route: "/orders/undelivered" });
}

describe("Pantalla No entregados", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista pedidos no entregados con su motivo de fallo y botón para reprogramar", async () => {
    const seen = stubOrders(() =>
      pageOf([
        buildOrder({
          id: "o-1",
          status: "FAILED",
          deliveryDate: "2026-08-25",
          failureReason: "Local cerrado",
          total: "37.50",
        }),
      ]),
    );

    await renderUndelivered();

    expect(await screen.findByText("No entregados")).toBeTruthy();
    expect(await screen.findByText("Local cerrado")).toBeTruthy();
    expect(seen[0]?.status).toBe("FAILED");
    expect(seen[0]?.isRescheduled).toBe("false");

    const table = screen.getByRole("table", {
      name: "Pedidos no entregados pendientes de reprogramar",
    });
    expect(within(table).getByText("Local cerrado")).toBeTruthy();
    expect(within(table).getByRole("button", { name: "Reprogramar" })).toBeTruthy();
  });

  it("reprogramar un pedido individual abre confirmación y llama a la API", async () => {
    let rescheduleCalled = false;
    stubOrders(() =>
      pageOf([
        buildOrder({
          id: "o-fail",
          status: "FAILED",
          deliveryDate: "2026-08-25",
          failureReason: "Cliente no atiende",
        }),
      ]),
    );

    cleanups.push(
      registerEndpoint("/api/v1/orders/o-fail/reschedule", {
        method: "POST",
        handler: () => {
          rescheduleCalled = true;
          return buildOrder({
            id: "o-new",
            deliveryDate: "2026-08-26",
            status: "PENDING",
          });
        },
      }),
    );

    await renderUndelivered();

    const user = userEvent.setup();
    const btn = await screen.findByRole("button", { name: "Reprogramar" });
    await user.click(btn);

    expect(await screen.findByRole("heading", { name: "Reprogramar pedido" })).toBeTruthy();
    const confirmBtn = screen.getByRole("button", { name: "Confirmar" });
    await user.click(confirmBtn);

    await waitFor(() => expect(rescheduleCalled).toBe(true));
  });

  it("al filtrar una fecha, ofrece «Reprogramar todos» y llama a la API por fecha", async () => {
    let batchBody: unknown = null;
    stubOrders((q) => {
      if (q.deliveryDateFrom === "2026-08-25") {
        return pageOf([
          buildOrder({
            id: "o-1",
            status: "FAILED",
            deliveryDate: "2026-08-25",
            failureReason: "Motivo A",
          }),
        ]);
      }
      return pageOf([
        buildOrder({
          id: "o-1",
          status: "FAILED",
          deliveryDate: "2026-08-25",
          failureReason: "Motivo A",
        }),
      ]);
    });

    cleanups.push(
      registerEndpoint("/api/v1/orders/reschedule-by-date", {
        method: "POST",
        handler: async (event: H3Event) => {
          batchBody = await readBody(event);
          return [
            buildOrder({
              id: "o-new-1",
              deliveryDate: "2026-08-26",
              status: "PENDING",
            }),
          ];
        },
      }),
    );

    await renderUndelivered();

    const dateInput = await screen.findByLabelText("Fecha de reparto");
    await fireEvent.update(dateInput, "2026-08-25");

    const batchBtn = await screen.findByRole("button", { name: "Reprogramar todos" });
    await userEvent.setup().click(batchBtn);

    expect(
      await screen.findByRole("heading", { name: "Reprogramar todos los pedidos de la fecha" }),
    ).toBeTruthy();

    const confirmAllBtn = screen.getByRole("button", { name: "Confirmar todos" });
    await userEvent.setup().click(confirmAllBtn);

    await waitFor(() =>
      expect(batchBody).toMatchObject({
        deliveryDate: "2026-08-25",
        newDeliveryDate: "2026-08-26",
      }),
    );
  });
});
