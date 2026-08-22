import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { Order, PaginatedOrders } from "../api/orders";
import type { Customer, PaginatedCustomers } from "../api/customers";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { OrdersPage } from "./orders-page";

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    customerId: "11111111-1111-4111-8111-111111111111",
    customer: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Bodega Santa Rosa",
      phone: "987654321",
    },
    deliveryDate: "2026-08-25",
    status: "PENDING",
    createdById: "55555555-5555-4555-8555-555555555555",
    createdAt: "2026-08-21T15:00:00.000Z",
    items: [
      {
        id: "item-1",
        productId: "22222222-2222-4222-8222-222222222222",
        product: { id: "22222222-2222-4222-8222-222222222222", name: "Recarga 20L" },
        quantity: 3,
        unitPrice: "12.50",
      },
    ],
    total: "37.50",
    ...overrides,
  };
}

function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Panadería Aurora",
    phone: "987654322",
    address: "Jr. Union 100",
    addressReference: "Esquina",
    zoneId: null,
    zone: null,
    creditLimit: null,
    debtBalance: "0.00",
    active: true,
    createdAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  };
}

function buildPage(overrides: Partial<PaginatedOrders> = {}): PaginatedOrders {
  const data = overrides.data ?? [buildOrder()];
  return {
    data,
    total: data.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    ...overrides,
  };
}

/** Records the query string of every /orders request the page makes. */
function stubOrders(respond: (url: URL) => PaginatedOrders): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(`${API_BASE_URL}/orders`, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      return HttpResponse.json(respond(url));
    }),
  );
  return seen;
}

/** The page's CustomerSelect hits this endpoint whenever a filter test searches. */
function stubCustomerSearch(customers: Customer[]): void {
  server.use(
    http.get(`${API_BASE_URL}/customers`, ({ request }) => {
      const url = new URL(request.url);
      const search = url.searchParams.get("search")?.toLowerCase() ?? "";
      const data = customers.filter((customer) => customer.name.toLowerCase().includes(search));
      const page: PaginatedCustomers = {
        data,
        total: data.length,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
      return HttpResponse.json(page);
    }),
  );
}

function renderOrders() {
  return renderWithProviders(
    <Routes>
      <Route path="/orders" element={<OrdersPage />} />
    </Routes>,
    "/orders",
  );
}

describe("OrdersPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("lista los pedidos con cliente, total y estado", async () => {
    stubOrders(() =>
      buildPage({
        data: [
          buildOrder({
            customer: { id: "c1", name: "Bodega Santa Rosa", phone: "987654321" },
            total: "37.50",
          }),
        ],
      }),
    );

    renderOrders();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("S/ 37.50")).toBeInTheDocument();
    expect(within(table).getByText("Pendiente")).toBeInTheDocument();
    expect(within(table).getByText("3× Recarga 20L")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo pedido" })).toHaveAttribute(
      "href",
      "/orders/new",
    );
  });

  it("muestra la fecha de entrega como el día exacto, sin desplazamiento de huso", async () => {
    // The trap: new Date("2026-08-25") is UTC midnight, which reads back as
    // 2026-08-24 in America/Lima (UTC-5). If this ever regresses to a Date
    // conversion, the displayed day shifts backward and this test catches it.
    stubOrders(() => buildPage({ data: [buildOrder({ deliveryDate: "2026-08-25" })] }));

    renderOrders();

    expect(await screen.findByText("25/08/2026")).toBeInTheDocument();
    expect(screen.queryByText("24/08/2026")).not.toBeInTheDocument();
  });

  it("cada filtro llega a la query de la API con el valor correcto", async () => {
    const user = userEvent.setup();
    stubCustomerSearch([buildCustomer()]);
    const seen = stubOrders(() => buildPage());

    renderOrders();
    await screen.findByText("Bodega Santa Rosa");

    await user.selectOptions(screen.getByLabelText("Estado"), "ON_ROUTE");
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("status")).toBe("ON_ROUTE"));

    await user.type(screen.getByLabelText("Entrega desde"), "2026-08-01");
    await waitFor(() =>
      expect(seen.at(-1)?.searchParams.get("deliveryDateFrom")).toBe("2026-08-01"),
    );

    await user.type(screen.getByLabelText("Entrega hasta"), "2026-08-31");
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("deliveryDateTo")).toBe("2026-08-31"));

    await user.type(screen.getByLabelText("Cliente"), "aurora");
    await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));
    await waitFor(() =>
      expect(seen.at(-1)?.searchParams.get("customerId")).toBe(
        "33333333-3333-4333-8333-333333333333",
      ),
    );
  });

  it("limpia los filtros con el botón dedicado", async () => {
    const user = userEvent.setup();
    const seen = stubOrders(() => buildPage());

    renderOrders();
    await screen.findByText("Bodega Santa Rosa");

    await user.selectOptions(screen.getByLabelText("Estado"), "CANCELLED");
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("status")).toBe("CANCELLED"));

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    await waitFor(() => expect(seen.at(-1)?.searchParams.has("status")).toBe(false));
    expect(screen.getByLabelText("Estado")).toHaveValue("all");
  });

  it("distingue el vacío por filtro del vacío real", async () => {
    const user = userEvent.setup();
    stubOrders((url) =>
      url.searchParams.get("status") === "CANCELLED"
        ? buildPage({ data: [], total: 0, totalPages: 0 })
        : buildPage(),
    );

    renderOrders();
    await screen.findByText("Bodega Santa Rosa");

    await user.selectOptions(screen.getByLabelText("Estado"), "CANCELLED");

    expect(await screen.findByText("Ningún pedido coincide con el filtro")).toBeInTheDocument();
  });

  it("muestra un estado vacío real cuando aún no hay pedidos", async () => {
    stubOrders(() => buildPage({ data: [], total: 0, totalPages: 0 }));

    renderOrders();

    expect(await screen.findByText("Todavía no hay pedidos")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("muestra el error de la API y permite reintentar", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/orders`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json(buildPage());
      }),
    );

    renderOrders();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("pagina: «Siguiente» pide la página 2 y respeta el límite de la API", async () => {
    const user = userEvent.setup();
    const seen = stubOrders((url) => {
      const page = Number(url.searchParams.get("page"));
      return buildPage({
        data: [buildOrder({ id: page === 2 ? "order-2" : "order-1" })],
        total: 40,
        page,
        totalPages: 2,
      });
    });

    renderOrders();
    await screen.findByText("Bodega Santa Rosa");
    expect(seen[0]?.searchParams.get("limit")).toBe("20");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(seen.at(-1)?.searchParams.get("page")).toBe("2"));
    expect(await screen.findByText("Página 2 de 2")).toBeInTheDocument();
  });

  it("distingue el estado por color, no solo por texto", async () => {
    stubOrders(() =>
      buildPage({
        data: [
          buildOrder({ status: "DELIVERED" }),
          buildOrder({ id: "order-2", status: "FAILED" }),
        ],
      }),
    );

    renderOrders();

    const table = await screen.findByRole("table");
    const delivered = within(table).getByText("Entregado");
    const failed = within(table).getByText("No entregado");
    expect(delivered.className).toContain("badge--active");
    expect(failed.className).toContain("badge--danger");
    expect(delivered.className).not.toBe(failed.className);
  });
});
