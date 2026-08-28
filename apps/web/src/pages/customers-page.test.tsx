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
import { CustomersPage } from "./customers-page";

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

function buildPage(overrides: Partial<PaginatedCustomers> = {}): PaginatedCustomers {
  const data = overrides.data ?? [buildCustomer()];
  return {
    data,
    total: data.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    ...overrides,
  };
}

/** Records the query string of every /customers request the page makes. */
function stubCustomers(respond: (url: URL) => PaginatedCustomers): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(`${API_BASE_URL}/customers`, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      return HttpResponse.json(respond(url));
    }),
  );
  return seen;
}

function renderCustomers() {
  return renderWithProviders(
    <Routes>
      <Route path="/customers" element={<CustomersPage />} />
      <Route path="/customers/new" element={<h1>Nuevo cliente</h1>} />
      <Route path="/customers/:customerId" element={<h1>Ficha</h1>} />
      <Route path="/customers/:customerId/edit" element={<h1>Editar</h1>} />
    </Routes>,
    "/customers",
  );
}

describe("CustomersPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("lista los clientes con su teléfono, zona, estado y deuda", async () => {
    stubCustomers(() =>
      buildPage({
        data: [
          buildCustomer({ name: "Bodega Santa Rosa", phone: "987654321", debtBalance: "40.50" }),
          buildCustomer({
            id: "22222222-2222-4222-8222-222222222222",
            name: "Panadería Aurora",
            phone: "987654322",
            zoneId: "33333333-3333-4333-8333-333333333333",
            zone: { id: "33333333-3333-4333-8333-333333333333", name: "Norte" },
            active: false,
            debtBalance: "0.00",
          }),
        ],
        total: 2,
      }),
    );

    renderCustomers();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    expect(screen.getByText("987654321")).toBeInTheDocument();
    expect(screen.getByText("S/ 40.50")).toBeInTheDocument();
    expect(screen.getByText("Sin zona")).toBeInTheDocument();

    const aurora = screen.getByText("Panadería Aurora").closest("tr");
    expect(aurora).not.toBeNull();
    expect(within(aurora as HTMLElement).getByText("Desactivado")).toBeInTheDocument();
    expect(within(aurora as HTMLElement).getByText("Norte")).toBeInTheDocument();
    expect(within(aurora as HTMLElement).queryByText("33333333")).not.toBeInTheDocument();

    expect(screen.getByText("2 clientes")).toBeInTheDocument();
  });

  it("muestra la deuda sin perder precisión decimal", async () => {
    stubCustomers(() => buildPage({ data: [buildCustomer({ debtBalance: "0.30" })] }));

    renderCustomers();

    // "S/ 0.3" would be the result of routing the value through a float.
    expect(await screen.findByText("S/ 0.30")).toBeInTheDocument();
    expect(screen.queryByText("S/ 0.3")).not.toBeInTheDocument();
  });

  it("pide la primera página con el límite de la API, no la lista entera", async () => {
    const seen = stubCustomers(() => buildPage());

    renderCustomers();
    await screen.findByText("Bodega Santa Rosa");

    expect(seen[0]?.searchParams.get("page")).toBe("1");
    expect(seen[0]?.searchParams.get("limit")).toBe("20");
  });

  it("pagina: «Siguiente» pide la página 2 y muestra sus filas", async () => {
    const user = userEvent.setup();
    const seen = stubCustomers((url) => {
      const page = Number(url.searchParams.get("page"));
      return buildPage({
        data: [buildCustomer({ name: page === 2 ? "Cliente de la 2" : "Cliente de la 1" })],
        total: 40,
        page,
        totalPages: 2,
      });
    });

    renderCustomers();
    await screen.findByText("Cliente de la 1");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(await screen.findByText("Cliente de la 2")).toBeInTheDocument();
    expect(seen.at(-1)?.searchParams.get("page")).toBe("2");
    expect(screen.queryByText("Cliente de la 1")).not.toBeInTheDocument();
  });

  /*
   * Los dos casos de abajo son el bug que este archivo venía reportando desde
   * el 24/08 y que se descartó cinco veces como "el flaky de siempre": el
   * debounce del buscador reseteaba `page` a 1 aunque el término terminara
   * igual que estaba. Cada uno afirma sobre las dos cosas — qué se pidió y qué
   * se ve — porque la aserción sobre las peticiones es la que dice el bug con
   * precisión, y es la que lo venía diciendo bien desde el principio.
   *
   * `paginateAndWaitForDebounce` deja correr el timer del debounce a
   * propósito: es justamente lo que el test original no hacía, y por eso el
   * fallo dependía de dónde cayeran los 300 ms respecto de la corrida.
   */
  const PAST_DEBOUNCE_MS = 450;

  function waitPastDebounce(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
  }

  function stubTwoPages(): URL[] {
    return stubCustomers((url) => {
      const page = Number(url.searchParams.get("page"));
      return buildPage({
        data: [buildCustomer({ name: page === 2 ? "Cliente de la 2" : "Cliente de la 1" })],
        total: 40,
        page,
        totalPages: 2,
      });
    });
  }

  it("paginar apenas carga la pantalla no se pisa cuando vence el debounce del mount", async () => {
    const user = userEvent.setup();
    const seen = stubTwoPages();

    renderCustomers();
    await screen.findByText("Cliente de la 1");
    // Sin esperar nada: el timer que el mount programó sigue vivo.
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Cliente de la 2");

    await waitPastDebounce();

    expect(seen.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(screen.getByText("Cliente de la 2")).toBeInTheDocument();
  });

  it("tipear en el buscador y borrarlo deja al usuario en la página que eligió", async () => {
    const user = userEvent.setup();
    const seen = stubTwoPages();

    renderCustomers();
    await screen.findByText("Cliente de la 1");
    // Acá sí se espera: este caso no depende de la ventana del mount.
    await waitPastDebounce();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Cliente de la 2");

    const searchBox = screen.getByPlaceholderText("Nombre o teléfono");
    await user.type(searchBox, "a");
    await user.clear(searchBox);
    await waitPastDebounce();

    // El término terminó igual que estaba —vacío—, así que no se pidió nada
    // nuevo y la página elegida sigue siendo la del usuario.
    expect(seen.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(screen.getByText("Cliente de la 2")).toBeInTheDocument();
  });

  it("cambiar el término de búsqueda sí vuelve a la primera página", async () => {
    const user = userEvent.setup();
    const seen = stubCustomers((url) => {
      const page = Number(url.searchParams.get("page"));
      const search = url.searchParams.get("search");
      return buildPage({
        data: [
          buildCustomer({
            name: search ? "Resultado buscado" : page === 2 ? "Cliente de la 2" : "Cliente de la 1",
          }),
        ],
        total: 40,
        page,
        totalPages: 2,
      });
    });

    renderCustomers();
    await screen.findByText("Cliente de la 1");
    await waitPastDebounce();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Cliente de la 2");

    await user.type(screen.getByPlaceholderText("Nombre o teléfono"), "rosa");

    expect(await screen.findByText("Resultado buscado")).toBeInTheDocument();
    expect(seen.at(-1)?.searchParams.get("search")).toBe("rosa");
    expect(seen.at(-1)?.searchParams.get("page")).toBe("1");
  });

  it("busca por nombre o teléfono contra la API", async () => {
    const user = userEvent.setup();
    const seen = stubCustomers((url) =>
      buildPage({
        data: [buildCustomer({ name: url.searchParams.get("search") ? "Aurora" : "Santa Rosa" })],
      }),
    );

    renderCustomers();
    await screen.findByText("Santa Rosa");

    await user.type(screen.getByLabelText("Buscar"), "aurora");

    expect(await screen.findByText("Aurora")).toBeInTheDocument();
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("search")).toBe("aurora"));
    // Debounced: typing six characters must not mean six requests.
    expect(seen.length).toBeLessThan(2 + "aurora".length);
  });

  it("filtra por estado", async () => {
    const user = userEvent.setup();
    const seen = stubCustomers((url) =>
      url.searchParams.get("active") === "false"
        ? buildPage({ data: [buildCustomer({ name: "Kiosko Cerrado", active: false })] })
        : buildPage(),
    );

    renderCustomers();
    await screen.findByText("Bodega Santa Rosa");

    await user.selectOptions(screen.getByLabelText("Estado"), "inactive");

    await waitFor(() => expect(seen.at(-1)?.searchParams.get("active")).toBe("false"));
    expect(await screen.findByText("Kiosko Cerrado")).toBeInTheDocument();
  });

  it("muestra el error de la API y permite reintentar", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/customers`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json(buildPage());
      }),
    );

    renderCustomers();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("muestra un estado vacío cuando no hay clientes", async () => {
    stubCustomers(() => buildPage({ data: [], total: 0, totalPages: 0 }));

    renderCustomers();

    expect(await screen.findByText("Todavía no hay clientes")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("distingue el vacío por filtro del vacío real", async () => {
    const user = userEvent.setup();
    stubCustomers((url) =>
      url.searchParams.get("search")
        ? buildPage({ data: [], total: 0, totalPages: 0 })
        : buildPage(),
    );

    renderCustomers();
    await screen.findByText("Bodega Santa Rosa");

    await user.type(screen.getByLabelText("Buscar"), "zzz");

    expect(await screen.findByText("Ningún cliente coincide con la búsqueda")).toBeInTheDocument();
  });

  it("enlaza a la edición de cada cliente y al alta", async () => {
    stubCustomers(() => buildPage());

    renderCustomers();
    await screen.findByText("Bodega Santa Rosa");

    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      "/customers/11111111-1111-4111-8111-111111111111/edit",
    );
    expect(screen.getByRole("link", { name: "Nuevo cliente" })).toHaveAttribute(
      "href",
      "/customers/new",
    );
  });

  it("una fila lleva a la ficha del cliente", async () => {
    const user = userEvent.setup();
    stubCustomers(() => buildPage());

    renderCustomers();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("link", { name: "Ver cliente Bodega Santa Rosa" }));

    expect(await screen.findByRole("heading", { name: "Ficha" })).toBeInTheDocument();
  });

  it("clicar «Editar» no dispara también la navegación de la fila", async () => {
    const user = userEvent.setup();
    stubCustomers(() => buildPage());

    renderCustomers();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("link", { name: "Editar" }));

    expect(await screen.findByRole("heading", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ficha" })).not.toBeInTheDocument();
  });
});
