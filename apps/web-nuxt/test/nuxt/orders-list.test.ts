import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Order, Page } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, buildOrder, pageOf } from "../support/fixtures";
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

async function renderOrders() {
  await renderSuspended(App, { route: "/orders" });
}

async function chooseStatus(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Estado"));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("Pedidos", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista cada pedido con cliente, entrega, estado, productos y total", async () => {
    stubOrders(() =>
      pageOf([buildOrder(), buildOrder({ id: "o-2", status: "FAILED", total: "1234.50" })]),
    );

    await renderOrders();

    await screen.findByText("S/ 1,234.50");
    const table = screen.getByRole("table", {
      name: "Pedidos con cliente, fecha de entrega, estado y productos",
    });
    const first = within(table).getByText("S/ 37.50").closest("tr") as HTMLElement;
    const second = within(table).getByText("S/ 1,234.50").closest("tr") as HTMLElement;
    expect(within(first).getByText("Pendiente")).toBeTruthy();
    expect(within(first).getByText("3× Recarga 20L")).toBeTruthy();
    expect(within(first).getByText("S/ 37.50")).toBeTruthy();
    expect(within(second).getByText("No entregado")).toBeTruthy();
    expect(within(second).getByText("S/ 1,234.50")).toBeTruthy();
    expect(screen.getByText("2 pedidos")).toBeTruthy();
  });

  it("la fecha de entrega es el día exacto, sin correrse por el huso de Lima", async () => {
    stubOrders(() => pageOf([buildOrder({ deliveryDate: "2026-08-25" })]));

    await renderOrders();

    expect(await screen.findByText("25/08/2026")).toBeTruthy();
    expect(screen.queryByText("24/08/2026")).toBeNull();
  });

  it("cada filtro llega a la query con su valor, y las fechas viajan como AAAA-MM-DD", async () => {
    const seen = stubOrders(() => pageOf([buildOrder()]));
    cleanups.push(
      registerEndpoint("/api/v1/customers", () =>
        pageOf([buildCustomer({ id: "c-aurora", name: "Panadería Aurora" })]),
      ),
    );
    const user = userEvent.setup();

    await renderOrders();
    await screen.findByText("Bodega Santa Rosa");

    await chooseStatus("En ruta");
    await waitFor(() => expect(seen.at(-1)?.status).toBe("ON_ROUTE"));

    await fireEvent.update(screen.getByLabelText("Entrega desde"), "2026-08-01");
    await waitFor(() => expect(seen.at(-1)?.deliveryDateFrom).toBe("2026-08-01"));

    await fireEvent.update(screen.getByLabelText("Entrega hasta"), "2026-08-31");
    await waitFor(() => expect(seen.at(-1)?.deliveryDateTo).toBe("2026-08-31"));

    await user.type(screen.getByLabelText("Cliente"), "aurora");
    await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));
    await waitFor(() => expect(seen.at(-1)?.customerId).toBe("c-aurora"));
    expect(seen.at(-1)).toMatchObject({ page: "1", limit: "20" });
  });

  it("«Limpiar filtros» vuelve a pedir sin filtros", async () => {
    const seen = stubOrders(() => pageOf([buildOrder()]));

    await renderOrders();
    await screen.findByText("Bodega Santa Rosa");
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();

    await chooseStatus("Cancelado");
    await waitFor(() => expect(seen.at(-1)?.status).toBe("CANCELLED"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Limpiar filtros" }));

    await waitFor(() => expect(seen.at(-1)).toEqual({ page: "1", limit: "20" }));
    expect(screen.getByLabelText("Estado").textContent).toContain("Todos");
  });

  it("distingue el vacío por filtro del vacío real", async () => {
    stubOrders((query) =>
      query.status === "CANCELLED" ? pageOf([], { totalPages: 0 }) : pageOf([buildOrder()]),
    );

    await renderOrders();
    await screen.findByText("Bodega Santa Rosa");
    await chooseStatus("Cancelado");

    expect(await screen.findByText("Ningún pedido coincide con el filtro")).toBeTruthy();
  });

  it("sin pedidos lo dice, sin tabla", async () => {
    stubOrders(() => pageOf([], { totalPages: 0 }));

    await renderOrders();

    expect(await screen.findByText("Todavía no hay pedidos")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("muestra el error de la API y permite reintentar", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/orders", (event: H3Event) => {
        attempt++;
        if (attempt === 1) {
          setResponseStatus(event, 500);
          return { message: "Base de datos no disponible" };
        }
        return pageOf([buildOrder()]);
      }),
    );

    await renderOrders();
    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bodega Santa Rosa")).toBeTruthy();
  });

  it("pagina con el límite de la API", async () => {
    const seen = stubOrders((query) =>
      pageOf([buildOrder({ id: `o-${query.page}` })], {
        total: 40,
        page: Number(query.page),
        totalPages: 2,
      }),
    );

    await renderOrders();
    await screen.findByText("Página 1 de 2");
    await userEvent.setup().click(screen.getByRole("button", { name: "Siguiente" }));

    expect(await screen.findByText("Página 2 de 2")).toBeTruthy();
    expect(seen.map((query) => query.page)).toEqual(["1", "2"]);
  });

  it("el cliente de cada fila lleva al detalle del pedido", async () => {
    stubOrders(() => pageOf([buildOrder({ id: "o-77" })]));

    await renderOrders();

    const link = await screen.findByRole("link", { name: "Ver pedido de Bodega Santa Rosa" });
    expect(link.getAttribute("href")).toBe("/orders/o-77");
  });
});
