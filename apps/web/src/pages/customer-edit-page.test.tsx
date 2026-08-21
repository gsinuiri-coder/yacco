import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { Customer } from "../api/customers";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { CustomerEditPage } from "./customer-edit-page";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Bodega Santa Rosa",
    phone: "987654321",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul",
    zoneId: null,
    creditLimit: "150.00",
    debtBalance: "40.50",
    active: true,
    createdAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  };
}

function stubGet(customer: Customer) {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}`, () => HttpResponse.json(customer)),
  );
}

/** Captures the PATCH body so the test can assert the contract. */
function stubPatch(status = 200, payload?: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.patch(`${API_BASE_URL}/customers/${CUSTOMER_ID}`, async ({ request }) => {
      captured.body = await request.json();
      if (status >= 400) {
        return HttpResponse.json(payload, { status });
      }
      return HttpResponse.json(payload ?? buildCustomer(), { status });
    }),
  );
  return captured;
}

function renderEdit() {
  return renderWithProviders(
    <Routes>
      <Route path="/customers/:customerId" element={<CustomerEditPage />} />
      <Route path="/customers" element={<h1>Clientes</h1>} />
    </Routes>,
    `/customers/${CUSTOMER_ID}`,
  );
}

describe("CustomerEditPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("precarga el formulario con los datos del cliente", async () => {
    stubGet(buildCustomer());

    renderEdit();

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Bodega Santa Rosa");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("987654321");
    expect(screen.getByLabelText("Dirección")).toHaveValue("Av. Los Alamos 452");
    expect(screen.getByLabelText("Referencia")).toHaveValue("Portón azul");
    expect(screen.getByLabelText("Límite de crédito (opcional)")).toHaveValue("150.00");
    expect(screen.getByLabelText("Cliente activo")).toBeChecked();
  });

  it("muestra la deuda como solo lectura, sin campo editable ni pérdida de precisión", async () => {
    stubGet(buildCustomer({ debtBalance: "0.30" }));

    renderEdit();

    expect(await screen.findByText("Deuda actual")).toBeInTheDocument();
    expect(screen.getByText("S/ 0.30")).toBeInTheDocument();
    expect(screen.queryByText("S/ 0.3")).not.toBeInTheDocument();
    // There is no input bound to the ledger balance anywhere on the page.
    expect(screen.queryByLabelText(/deuda/i)).not.toBeInTheDocument();
  });

  it("guarda los cambios y nunca manda debtBalance", async () => {
    const user = userEvent.setup();
    stubGet(buildCustomer());
    const captured = stubPatch();

    renderEdit();
    const nameInput = await screen.findByLabelText("Nombre");
    await user.clear(nameInput);
    await user.type(nameInput, "Bodega Santa Rosa II");

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("heading", { name: "Clientes" })).toBeInTheDocument();
    expect(captured.body).toMatchObject({
      name: "Bodega Santa Rosa II",
      phone: "987654321",
      active: true,
      creditLimit: "150.00",
    });
    expect(captured.body).not.toHaveProperty("debtBalance");
  });

  it("desactiva al cliente con active=false, sin borrarlo", async () => {
    const user = userEvent.setup();
    stubGet(buildCustomer());
    const captured = stubPatch(200, buildCustomer({ active: false }));

    renderEdit();
    await screen.findByLabelText("Cliente activo");

    await user.click(screen.getByLabelText("Cliente activo"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await screen.findByRole("heading", { name: "Clientes" });
    expect(captured.body).toMatchObject({ active: false });
  });

  it("muestra el 400 de la API al guardar", async () => {
    const user = userEvent.setup();
    stubGet(buildCustomer());
    stubPatch(400, { message: ["La zona debe ser un identificador válido"] });

    renderEdit();
    await screen.findByLabelText("Nombre");

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La zona debe ser un identificador válido",
    );
  });

  it("muestra un error si el cliente no se puede cargar", async () => {
    server.use(
      http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}`, () =>
        HttpResponse.json({ message: `El cliente "${CUSTOMER_ID}" no existe` }, { status: 404 }),
      ),
    );

    renderEdit();

    expect(await screen.findByRole("alert")).toHaveTextContent("no existe");
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });
});
