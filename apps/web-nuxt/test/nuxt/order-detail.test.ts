import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Order } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildOrder } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

function endpoint(...args: Parameters<typeof registerEndpoint>) {
  cleanups.push(registerEndpoint(...args));
}

function stubGet(respond: Order | ((event: H3Event) => unknown)) {
  endpoint("/api/v1/orders/o-1", {
    method: "GET",
    handler: typeof respond === "function" ? respond : () => respond,
  });
}

function stubCancel(respond: (event: H3Event) => unknown) {
  let calls = 0;
  endpoint("/api/v1/orders/o-1/cancel", {
    method: "PATCH",
    handler: (event: H3Event) => {
      calls++;
      return respond(event);
    },
  });
  return () => calls;
}

async function renderDetail() {
  await renderSuspended(App, { route: "/orders/o-1" });
}

async function startCancel() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
  return user;
}

describe("Detalle de pedido", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra productos, subtotales en céntimos exactos y el total de la API, no uno recalculado", async () => {
    stubGet(
      buildOrder({
        items: [
          {
            id: "i1",
            productId: "p1",
            product: { id: "p1", name: "Recarga 20L" },
            quantity: 3,
            unitPrice: "12.50",
          },
          {
            id: "i2",
            productId: "p2",
            product: { id: "p2", name: "Bidón 20L" },
            quantity: 2,
            unitPrice: "17.00",
          },
        ],
        // Distinto de 37.50 + 34.00 a propósito: la pantalla muestra el de la API.
        total: "70.00",
      }),
    );

    await renderDetail();

    expect(
      await screen.findByRole("heading", { name: "Pedido de Bodega Santa Rosa", level: 1 }),
    ).toBeTruthy();
    const table = screen.getByRole("table", { name: "Productos del pedido" });
    expect(table.textContent).toContain("S/ 37.50");
    expect(table.textContent).toContain("S/ 34.00");
    expect(table.textContent).toContain("S/ 70.00");
    expect(table.textContent).not.toContain("S/ 71.50");
  });

  it("la entrega es el día exacto y la toma, un instante en hora de Lima", async () => {
    stubGet(buildOrder({ deliveryDate: "2026-08-25", createdAt: "2026-08-21T15:00:00.000Z" }));

    await renderDetail();

    expect(await screen.findByText("25/08/2026")).toBeTruthy();
    expect(screen.queryByText("24/08/2026")).toBeNull();
    expect(screen.getByText("21/08/2026 10:00")).toBeTruthy();
  });

  it("sólo un pedido pendiente ofrece cancelar", async () => {
    stubGet(buildOrder({ status: "ON_ROUTE" }));

    await renderDetail();

    expect(await screen.findByText("En ruta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
  });

  it("cancelar pide confirmación y repinta el estado como Cancelado", async () => {
    const order = buildOrder({ status: "PENDING" });
    stubGet(order);
    const calls = stubCancel(() => ({ ...order, status: "CANCELLED" }));

    await renderDetail();
    const user = await startCancel();
    expect(screen.getByText("¿Confirmas cancelar este pedido? No se puede deshacer.")).toBeTruthy();
    expect(calls()).toBe(0);
    await user.click(screen.getByRole("button", { name: "Sí, cancelar" }));

    expect(await screen.findByText("Cancelado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
  });

  it("«No» cierra la confirmación sin llamar a la API", async () => {
    stubGet(buildOrder({ status: "PENDING" }));
    const calls = stubCancel(() => ({}));

    await renderDetail();
    const user = await startCancel();
    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeTruthy();
    expect(calls()).toBe(0);
  });

  it("un 409 muestra el mensaje de la API y recarga para ver el estado real", async () => {
    let gets = 0;
    stubGet(() => {
      gets++;
      return buildOrder({ status: gets === 1 ? "PENDING" : "ON_ROUTE" });
    });
    stubCancel((event) => {
      setResponseStatus(event, 409);
      return { message: "Solo se puede cancelar un pedido pendiente; este está en ON_ROUTE" };
    });

    await renderDetail();
    const user = await startCancel();
    await user.click(screen.getByRole("button", { name: "Sí, cancelar" }));

    expect(
      await screen.findByText("Solo se puede cancelar un pedido pendiente; este está en ON_ROUTE"),
    ).toBeTruthy();
    expect(await screen.findByText("En ruta")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un doble clic en «Sí, cancelar» manda un solo PATCH", async () => {
    stubGet(buildOrder({ status: "PENDING" }));
    const calls = stubCancel(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return buildOrder({ status: "CANCELLED" });
    });

    await renderDetail();
    const user = await startCancel();
    await user.dblClick(screen.getByRole("button", { name: "Sí, cancelar" }));

    await screen.findByText("Cancelado");
    await waitFor(() => expect(calls()).toBe(1));
  });

  it("un error de carga se puede reintentar; un id inexistente dice que no existe", async () => {
    let attempt = 0;
    stubGet((event) => {
      attempt++;
      if (attempt === 1) {
        setResponseStatus(event, 500);
        return { message: "Base de datos no disponible" };
      }
      setResponseStatus(event, 404);
      return { message: "no existe" };
    });

    await renderDetail();
    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Ese pedido no existe")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
