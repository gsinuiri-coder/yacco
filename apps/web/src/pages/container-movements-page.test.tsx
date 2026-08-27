import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContainerMovement, PaginatedContainerMovements } from "../api/container-movements";
import type { ContainerType } from "../api/container-types";
import type { Customer, PaginatedCustomers } from "../api/customers";
import type { CustomerLocation } from "../api/customer-locations";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { ContainerMovementsPage } from "./container-movements-page";

const CON_CANIO: ContainerType = { id: "con-canio", name: "Con caño", active: true };
const SIN_CANIO: ContainerType = { id: "sin-canio", name: "Sin caño", active: true };
const ADMIN_ID = "77777777-7777-4777-8777-777777777777";

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

function buildLocation(overrides: Partial<CustomerLocation> = {}): CustomerLocation {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Principal",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul",
    phone: "987654321",
    isPrimary: true,
    active: true,
    ...overrides,
  };
}

function buildMovement(overrides: Partial<ContainerMovement> = {}): ContainerMovement {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    occurredAt: "2026-08-22T15:00:00.000Z",
    type: "FLEET_ENTRY",
    containerTypeId: CON_CANIO.id,
    containerType: CON_CANIO,
    quantity: 50,
    fromState: null,
    toState: "EMPTY_AT_PLANT",
    locationId: null,
    location: null,
    recordedById: ADMIN_ID,
    ...overrides,
  };
}

function buildPage(
  overrides: Partial<PaginatedContainerMovements> = {},
): PaginatedContainerMovements {
  const data = overrides.data ?? [buildMovement()];
  return { data, total: data.length, page: 1, limit: 20, totalPages: 1, ...overrides };
}

function stubContainerTypes(containerTypes: ContainerType[] = [CON_CANIO, SIN_CANIO]): void {
  server.use(http.get(`${API_BASE_URL}/container-types`, () => HttpResponse.json(containerTypes)));
}

function stubMovements(respond: (url: URL) => PaginatedContainerMovements): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(`${API_BASE_URL}/container-movements`, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      return HttpResponse.json(respond(url));
    }),
  );
  return seen;
}

function stubCreate(status = 201, payload?: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/container-movements`, async ({ request }) => {
      captured.body = await request.json();
      if (status >= 400) {
        return HttpResponse.json(payload, { status });
      }
      return HttpResponse.json(payload ?? buildMovement(), { status });
    }),
  );
  return captured;
}

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

function stubLocations(customerId: string, locations: CustomerLocation[]): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${customerId}/locations`, () =>
      HttpResponse.json(locations),
    ),
  );
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/container-movements" element={<ContainerMovementsPage />} />
      <Route path="/inventory" element={<h1>Inventario</h1>} />
    </Routes>,
    "/container-movements",
  );
}

async function pickCustomer(user: ReturnType<typeof userEvent.setup>, customer: Customer) {
  await user.type(screen.getByLabelText("Cliente"), customer.name);
  await user.click(await screen.findByRole("option", { name: new RegExp(customer.name) }));
}

describe("ContainerMovementsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
    stubContainerTypes();
    stubMovements(() => buildPage());
  });

  it("solo ofrece las tres operaciones permitidas; llenado y las de ruta no aparecen", async () => {
    renderPage();

    const select = (await screen.findByLabelText("Operación", {
      selector: "#movementType",
    })) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((option) => option.textContent);

    expect(optionLabels).toEqual([
      "Selecciona una operación",
      "Ingreso de envases nuevos",
      "Baja por daño",
      "Baja por pérdida",
    ]);
    expect(optionLabels).not.toContain("Llenado");
    expect(optionLabels).not.toContain("Carga a ruta");
    expect(optionLabels).not.toContain("Entrega al cliente");
    expect(optionLabels).not.toContain("Recogida de vacíos");
    expect(optionLabels).not.toContain("Devolución a planta");
    expect(optionLabels).not.toContain("Descarga de vacíos");
    expect(optionLabels).not.toContain("Venta");
  });

  it("ingreso de envases nuevos: el POST lleva toState EMPTY_AT_PLANT, sin fromState ni locationId", async () => {
    const user = userEvent.setup();
    const captured = stubCreate();

    renderPage();
    await user.selectOptions(
      await screen.findByLabelText("Operación", { selector: "#movementType" }),
      "FLEET_ENTRY",
    );
    await user.selectOptions(
      screen.getByLabelText("Tipo de envase", { selector: "#movementContainerType" }),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad"), "50");

    expect(screen.queryByLabelText("¿De dónde sale?")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    await screen.findByText("Movimiento registrado.");
    expect(captured.body).toEqual({
      type: "FLEET_ENTRY",
      containerTypeId: CON_CANIO.id,
      quantity: 50,
      toState: "EMPTY_AT_PLANT",
    });
  });

  it("baja por daño eligiendo el origen: el POST lleva ese origen", async () => {
    const user = userEvent.setup();
    const captured = stubCreate();

    renderPage();
    await user.selectOptions(
      await screen.findByLabelText("Operación", { selector: "#movementType" }),
      "DAMAGE_WRITE_OFF",
    );
    await user.selectOptions(
      screen.getByLabelText("Tipo de envase", { selector: "#movementContainerType" }),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad"), "3");
    await user.selectOptions(screen.getByLabelText("¿De dónde sale?"), "FULL_ON_ROUTE");

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    await screen.findByText("Movimiento registrado.");
    expect(captured.body).toEqual({
      type: "DAMAGE_WRITE_OFF",
      containerTypeId: CON_CANIO.id,
      quantity: 3,
      fromState: "FULL_ON_ROUTE",
    });
  });

  it("baja por pérdida: el POST lleva el locationId de la ubicación elegida, no el id del cliente", async () => {
    const user = userEvent.setup();
    const customer = buildCustomer();
    const location = buildLocation({ id: "location-not-customer-id" });
    stubCustomerSearch([customer]);
    stubLocations(customer.id, [location]);
    const captured = stubCreate();

    renderPage();
    await user.selectOptions(
      await screen.findByLabelText("Operación", { selector: "#movementType" }),
      "LOSS_WRITE_OFF",
    );
    await user.selectOptions(
      screen.getByLabelText("Tipo de envase", { selector: "#movementContainerType" }),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad"), "2");

    // Sin selector de origen: la pérdida sale siempre de "en cliente".
    expect(screen.queryByLabelText("¿De dónde sale?")).not.toBeInTheDocument();

    await pickCustomer(user, customer);
    await user.selectOptions(await screen.findByLabelText("Ubicación"), location.id);

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    await screen.findByText("Movimiento registrado.");
    const body = captured.body as { locationId: string };
    expect(body.locationId).toBe(location.id);
    expect(body.locationId).not.toBe(customer.id);
    expect(captured.body).toEqual({
      type: "LOSS_WRITE_OFF",
      containerTypeId: CON_CANIO.id,
      quantity: 2,
      fromState: "WITH_CUSTOMER",
      locationId: location.id,
    });
  });

  it("un cliente sin ubicaciones muestra su propio mensaje, no un desplegable vacío", async () => {
    const user = userEvent.setup();
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubLocations(customer.id, []);

    renderPage();
    await user.selectOptions(
      await screen.findByLabelText("Operación", { selector: "#movementType" }),
      "LOSS_WRITE_OFF",
    );
    await pickCustomer(user, customer);

    expect(
      await screen.findByText("Este cliente no tiene ubicaciones registradas."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Ubicación")).not.toBeInTheDocument();
  });

  it("un error al cargar las ubicaciones se muestra con opción de reintentar", async () => {
    const user = userEvent.setup();
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    server.use(
      http.get(`${API_BASE_URL}/customers/${customer.id}/locations`, () =>
        HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 }),
      ),
    );

    renderPage();
    await user.selectOptions(
      await screen.findByLabelText("Operación", { selector: "#movementType" }),
      "LOSS_WRITE_OFF",
    );
    await pickCustomer(user, customer);

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    stubLocations(customer.id, []);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(
      await screen.findByText("Este cliente no tiene ubicaciones registradas."),
    ).toBeInTheDocument();
  });

  it("un 400 de transición inválida se muestra con su mensaje del backend", async () => {
    const user = userEvent.setup();
    stubCreate(400, {
      message: 'El movimiento "DAMAGE_WRITE_OFF" no admite pasar de WITH_CUSTOMER a EMPTY_AT_PLANT',
    });

    renderPage();
    await user.selectOptions(
      await screen.findByLabelText("Operación", { selector: "#movementType" }),
      "DAMAGE_WRITE_OFF",
    );
    await user.selectOptions(
      screen.getByLabelText("Tipo de envase", { selector: "#movementContainerType" }),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad"), "3");
    await user.selectOptions(screen.getByLabelText("¿De dónde sale?"), "EMPTY_AT_PLANT");

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'El movimiento "DAMAGE_WRITE_OFF" no admite pasar de WITH_CUSTOMER a EMPTY_AT_PLANT',
    );
  });

  it("un doble clic en registrar dispara un solo POST", async () => {
    const user = userEvent.setup();
    let postCount = 0;
    server.use(
      http.post(`${API_BASE_URL}/container-movements`, async () => {
        postCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(buildMovement(), { status: 201 });
      }),
    );

    renderPage();
    await user.selectOptions(
      await screen.findByLabelText("Operación", { selector: "#movementType" }),
      "FLEET_ENTRY",
    );
    await user.selectOptions(
      screen.getByLabelText("Tipo de envase", { selector: "#movementContainerType" }),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad"), "50");

    const submit = screen.getByRole("button", { name: "Registrar movimiento" });
    await user.click(submit);
    await user.click(submit);

    await screen.findByText("Movimiento registrado.");
    expect(postCount).toBe(1);
  });

  it("el historial pagina y filtra por operación, tipo de envase y rango de fechas", async () => {
    const user = userEvent.setup();
    const seen = stubMovements((url) => {
      const page = Number(url.searchParams.get("page") ?? "1");
      return buildPage({
        data: [buildMovement({ id: page === 2 ? "movement-2" : "movement-1" })],
        total: 40,
        page,
        totalPages: 2,
      });
    });

    renderPage();
    await screen.findByRole("table");
    expect(seen[0]?.searchParams.get("limit")).toBe("20");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Operación", { selector: "#historyType" }),
      "DAMAGE_WRITE_OFF",
    );
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("type")).toBe("DAMAGE_WRITE_OFF"));

    await user.selectOptions(
      screen.getByLabelText("Tipo de envase", { selector: "#historyContainerType" }),
      SIN_CANIO.id,
    );
    await waitFor(() =>
      expect(seen.at(-1)?.searchParams.get("containerTypeId")).toBe(SIN_CANIO.id),
    );

    await user.type(screen.getByLabelText("Desde"), "2026-08-01");
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("dateFrom")).toBe("2026-08-01"));
    await user.type(screen.getByLabelText("Hasta"), "2026-08-31");
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("dateTo")).toBe("2026-08-31"));

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("page")).toBe("2"));
    expect(await screen.findByText("Página 2 de 2")).toBeInTheDocument();
  });

  it("muestra fecha, operación, tipo de envase, cantidad y de qué estado a cuál por fila", async () => {
    stubMovements(() =>
      buildPage({
        data: [
          buildMovement({
            type: "DAMAGE_WRITE_OFF",
            fromState: "FULL_AT_PLANT",
            toState: null,
            quantity: 4,
          }),
        ],
      }),
    );

    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Baja por daño")).toBeInTheDocument();
    expect(within(table).getByText("Con caño")).toBeInTheDocument();
    expect(within(table).getByText("4")).toBeInTheDocument();
    expect(within(table).getByText("Llenos en planta → Fuera de la empresa")).toBeInTheDocument();
  });
});
