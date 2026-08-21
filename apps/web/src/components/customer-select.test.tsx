import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { Customer, PaginatedCustomers } from "../api/customers";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { CustomerSelect } from "./customer-select";

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

/** Records the query string of every /customers request the select makes. */
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

/** Wraps CustomerSelect as an uncontrolled field so the test can inspect what was picked. */
function TestHarness({ onPick }: { onPick: (customer: Customer | null) => void }) {
  const [value, setValue] = useState<Customer | null>(null);
  return (
    <CustomerSelect
      id="customer"
      label="Cliente"
      value={value}
      onChange={(customer) => {
        setValue(customer);
        onPick(customer);
      }}
    />
  );
}

describe("CustomerSelect", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("busca contra la API con debounce y muestra los resultados", async () => {
    const user = userEvent.setup();
    const seen = stubSearch([
      buildCustomer({ name: "Panadería Aurora", phone: "987654322" }),
      buildCustomer({ id: "22222222-2222-4222-8222-222222222222", name: "Bodega Norte" }),
    ]);

    renderWithProviders(<TestHarness onPick={() => {}} />);

    await user.type(screen.getByLabelText("Cliente"), "aurora");

    expect(await screen.findByText("Panadería Aurora")).toBeInTheDocument();
    expect(screen.queryByText("Bodega Norte")).not.toBeInTheDocument();
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("search")).toBe("aurora"));
    // Bounded: the API is asked for a small page, not the whole roster.
    expect(seen.at(-1)?.searchParams.get("limit")).toBe("10");
    expect(seen.at(-1)?.searchParams.get("active")).toBe("true");
  });

  it("muestra 'Sin resultados' cuando la búsqueda no encuentra nada", async () => {
    const user = userEvent.setup();
    stubSearch([buildCustomer({ name: "Panadería Aurora" })]);

    renderWithProviders(<TestHarness onPick={() => {}} />);

    await user.type(screen.getByLabelText("Cliente"), "zzz");

    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
  });

  it("elige un cliente: llena el campo y dispara onChange con el customerId", async () => {
    const user = userEvent.setup();
    stubSearch([buildCustomer({ name: "Panadería Aurora" })]);
    const picked: (Customer | null)[] = [];

    renderWithProviders(<TestHarness onPick={(customer) => picked.push(customer)} />);

    await user.type(screen.getByLabelText("Cliente"), "aurora");
    await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));

    expect(picked).toHaveLength(1);
    expect(picked[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    // The search input is replaced by the selected-customer chip.
    expect(screen.queryByLabelText("Cliente")).not.toBeInTheDocument();
    expect(screen.getByText("Panadería Aurora")).toBeInTheDocument();
    expect(screen.getByText("987654321")).toBeInTheDocument();
  });

  it("limpia la selección y vuelve a mostrar el buscador", async () => {
    const user = userEvent.setup();
    stubSearch([buildCustomer({ name: "Panadería Aurora" })]);
    const picked: (Customer | null)[] = [];

    renderWithProviders(<TestHarness onPick={(customer) => picked.push(customer)} />);

    await user.type(screen.getByLabelText("Cliente"), "aurora");
    await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));
    await user.click(screen.getByRole("button", { name: "Cambiar" }));

    expect(picked.at(-1)).toBeNull();
    expect(screen.getByLabelText("Cliente")).toBeInTheDocument();
    expect(screen.queryByText("987654321")).not.toBeInTheDocument();
  });
});
