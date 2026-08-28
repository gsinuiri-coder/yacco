import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { Customer, PaginatedCustomers } from "../api/customers";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { CustomerQuickSearch } from "./customer-quick-search";

function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Bodega Santa Rosa",
    phone: "987654321",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul",
    zoneId: null,
    zone: null,
    creditLimit: null,
    debtBalance: "0.00",
    active: true,
    createdAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  };
}

/** Records the query string of every /customers request the search makes. */
function stubSearch(customers: Customer[]): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(`${API_BASE_URL}/customers`, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
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
  return seen;
}

function renderSearch() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<CustomerQuickSearch />} />
      <Route path="/customers/:customerId" element={<h1>Ficha</h1>} />
    </Routes>,
  );
}

describe("CustomerQuickSearch", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("busca contra la API con debounce, sin filtrar por activo", async () => {
    const user = userEvent.setup();
    const seen = stubSearch([buildCustomer({ name: "Panadería Aurora" })]);

    renderSearch();

    await user.type(screen.getByLabelText("Buscar cliente"), "aurora");

    expect(await screen.findByText("Panadería Aurora")).toBeInTheDocument();
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("search")).toBe("aurora"));
    expect(seen.at(-1)?.searchParams.get("limit")).toBe("10");
    expect(seen.at(-1)?.searchParams.has("active")).toBe(false);
  });

  it("sin texto no muestra lista ni spinner, solo el campo", () => {
    stubSearch([]);
    renderSearch();

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("elegir un resultado navega a la ficha del cliente", async () => {
    const user = userEvent.setup();
    stubSearch([buildCustomer({ name: "Panadería Aurora" })]);

    renderSearch();
    await user.type(screen.getByLabelText("Buscar cliente"), "aurora");
    await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));

    expect(await screen.findByRole("heading", { name: "Ficha" })).toBeInTheDocument();
  });

  it("un cliente inactivo se muestra con su badge y sigue siendo elegible", async () => {
    const user = userEvent.setup();
    stubSearch([buildCustomer({ name: "Panadería Aurora", active: false })]);

    renderSearch();
    await user.type(screen.getByLabelText("Buscar cliente"), "aurora");

    const option = await screen.findByRole("option", { name: /Panadería Aurora/ });
    expect(within(option).getByText("Inactivo")).toBeInTheDocument();

    await user.click(option);
    expect(await screen.findByRole("heading", { name: "Ficha" })).toBeInTheDocument();
  });

  it("Escape cierra la lista de resultados", async () => {
    const user = userEvent.setup();
    stubSearch([buildCustomer({ name: "Panadería Aurora" })]);

    renderSearch();
    await user.type(screen.getByLabelText("Buscar cliente"), "aurora");
    await screen.findByRole("option", { name: /Panadería Aurora/ });

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("las flechas mueven el resaltado y Enter abre el resultado resaltado", async () => {
    const user = userEvent.setup();
    stubSearch([
      buildCustomer({ name: "Panadería Aurora" }),
      buildCustomer({ id: "22222222-2222-4222-8222-222222222222", name: "Bodega Norte" }),
    ]);

    renderSearch();
    await user.type(screen.getByLabelText("Buscar cliente"), "a");
    await screen.findByRole("option", { name: /Panadería Aurora/ });

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(await screen.findByRole("heading", { name: "Ficha" })).toBeInTheDocument();
  });
});
