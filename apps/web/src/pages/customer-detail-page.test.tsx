import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { Customer } from "../api/customers";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { CustomerDetailPage } from "./customer-detail-page";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Bodega Santa Rosa",
    phone: "987654321",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul",
    zoneId: null,
    zone: null,
    creditLimit: "150.00",
    debtBalance: "40.50",
    active: true,
    createdAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  };
}

function stubGetCustomer(customer: Customer): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${customer.id}`, () => HttpResponse.json(customer)),
  );
}

/** The ADMIN prices panel fetches the management list and the catalog. */
function stubManagementPrices(): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/prices`, () => HttpResponse.json([])),
    http.get(`${API_BASE_URL}/products`, () => HttpResponse.json([])),
  );
}

/** The non-ADMIN panel fetches effective prices instead (the API refuses it the management list). */
function stubEffectivePrices(): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/effective-prices`, () =>
      HttpResponse.json([]),
    ),
  );
}

/** CustomerPaymentSection loads the catalog on mount, on every render of the page. */
function stubPaymentMethods(): void {
  server.use(
    http.get(`${API_BASE_URL}/payment-methods`, () =>
      HttpResponse.json([
        {
          id: "66666666-6666-4666-8666-666666666666",
          name: "Efectivo",
          active: true,
          requiresConfirmation: false,
        },
      ]),
    ),
  );
}

/**
 * CustomerAccountStatementSection loads on mount, on every render of the
 * page. `closingBalance` is intentionally "0.00" (not tied to `debtBalance`
 * in these fixtures) so it never collides with the "Deuda actual" money
 * strings these tests assert on.
 */
function stubAccountStatement(): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/account-statement`, () =>
      HttpResponse.json({
        customer: { id: CUSTOMER_ID, name: "Bodega Santa Rosa", debtBalance: "40.50" },
        openingBalance: "0.00",
        entries: [],
        closingBalance: "0.00",
      }),
    ),
  );
}

function renderDetail(id = CUSTOMER_ID) {
  return renderWithProviders(
    <Routes>
      <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
      <Route path="/customers" element={<h1>Clientes</h1>} />
      <Route path="/customers/:customerId/edit" element={<h1>Editar</h1>} />
    </Routes>,
    `/customers/${id}`,
  );
}

describe("CustomerDetailPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("muestra los datos del cliente y su sección de precios pactados", async () => {
    signIn(["ADMIN"]);
    stubGetCustomer(buildCustomer());
    stubManagementPrices();
    stubPaymentMethods();
    stubAccountStatement();

    renderDetail();

    expect(await screen.findByRole("heading", { name: "Bodega Santa Rosa" })).toBeInTheDocument();
    expect(screen.getByText("987654321")).toBeInTheDocument();
    expect(screen.getByText("Av. Los Alamos 452")).toBeInTheDocument();
    expect(screen.getByText("Portón azul")).toBeInTheDocument();
    expect(screen.getByText("S/ 40.50")).toBeInTheDocument();
    expect(screen.getByText("S/ 150.00")).toBeInTheDocument();
    expect(await screen.findByText("Precios pactados")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/customers/${CUSTOMER_ID}/edit`,
    );
  });

  it("muestra la zona cuando el cliente tiene una", async () => {
    signIn(["ADMIN"]);
    stubGetCustomer(
      buildCustomer({
        zoneId: "55555555-5555-4555-8555-555555555555",
        zone: { id: "55555555-5555-4555-8555-555555555555", name: "Norte" },
      }),
    );
    stubManagementPrices();
    stubPaymentMethods();
    stubAccountStatement();

    renderDetail();

    await screen.findByRole("heading", { name: "Bodega Santa Rosa" });
    expect(screen.getByText("Norte")).toBeInTheDocument();
  });

  it("muestra el error genérico de la API y permite reintentar", async () => {
    signIn(["ADMIN"]);
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json(buildCustomer());
      }),
    );
    stubManagementPrices();
    stubPaymentMethods();
    stubAccountStatement();

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("heading", { name: "Bodega Santa Rosa" })).toBeInTheDocument();
  });

  it("un id inexistente muestra 'Ese cliente no existe', no un error genérico", async () => {
    signIn(["ADMIN"]);
    server.use(
      http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}`, () =>
        HttpResponse.json({ message: `El cliente "${CUSTOMER_ID}" no existe` }, { status: 404 }),
      ),
    );

    renderDetail();

    expect(await screen.findByText("Ese cliente no existe")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un usuario no ADMIN no ve los controles de gestión de precios", async () => {
    signIn(["SELLER"]);
    stubGetCustomer(buildCustomer());
    stubEffectivePrices();
    stubPaymentMethods();
    stubAccountStatement();

    renderDetail();

    await screen.findByRole("heading", { name: "Bodega Santa Rosa" });
    expect(await screen.findByText("Precios pactados")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar precio" })).not.toBeInTheDocument();
  });

  it("registrar un cobro actualiza la 'Deuda actual' que ya muestra la ficha", async () => {
    const user = userEvent.setup();
    signIn(["ADMIN"]);
    stubGetCustomer(buildCustomer({ debtBalance: "40.50" }));
    stubManagementPrices();
    stubPaymentMethods();
    stubAccountStatement();
    server.use(
      http.post(`${API_BASE_URL}/payments`, () =>
        HttpResponse.json(
          {
            payment: { id: "77777777-7777-4777-8777-777777777777", status: "CONFIRMED" },
            debtBalance: "20.50",
            exceedsDebt: false,
          },
          { status: 201 },
        ),
      ),
    );

    renderDetail();
    await screen.findByRole("heading", { name: "Bodega Santa Rosa" });
    expect(screen.getByText("S/ 40.50")).toBeInTheDocument();

    await user.selectOptions(await screen.findByLabelText("Método de pago"), [
      "66666666-6666-4666-8666-666666666666",
    ]);
    await user.type(screen.getByLabelText("Monto"), "20.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));

    expect(await screen.findByText("S/ 20.50")).toBeInTheDocument();
    expect(screen.queryByText("S/ 40.50")).not.toBeInTheDocument();
  });

  // Regresión: CustomerAccountStatementSection tiene su propio reloadToken
  // (para su botón "Reintentar"), pero antes no se enteraba de un cobro
  // registrado en CustomerPaymentSection — la ficha subía "Deuda actual" y
  // el estado de cuenta debajo se quedaba con la lista y el saldo viejos.
  it("registrar un cobro también recarga el estado de cuenta, no solo 'Deuda actual'", async () => {
    const user = userEvent.setup();
    signIn(["ADMIN"]);
    stubGetCustomer(buildCustomer({ debtBalance: "40.50" }));
    stubManagementPrices();
    stubPaymentMethods();

    const chargeEntry = {
      date: "2026-08-20T15:00:00.000Z",
      type: "CHARGE",
      amount: "40.50",
      runningBalance: "40.50",
      isOpeningBalance: false,
      saleId: "s1",
      locationName: "Principal",
      paymentId: null,
      paymentMethodName: null,
      status: null,
    };
    const newPaymentEntry = {
      date: "2026-08-27T12:00:00.000Z",
      type: "PAYMENT",
      amount: "20.00",
      runningBalance: "20.50",
      isOpeningBalance: false,
      saleId: null,
      locationName: null,
      paymentId: "77777777-7777-4777-8777-777777777777",
      paymentMethodName: "Efectivo",
      status: "CONFIRMED",
    };
    let statementCalls = 0;
    server.use(
      http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/account-statement`, () => {
        statementCalls += 1;
        return HttpResponse.json({
          customer: { id: CUSTOMER_ID, name: "Bodega Santa Rosa", debtBalance: "40.50" },
          openingBalance: "0.00",
          entries: statementCalls === 1 ? [chargeEntry] : [chargeEntry, newPaymentEntry],
          closingBalance: statementCalls === 1 ? "40.50" : "20.50",
        });
      }),
      http.post(`${API_BASE_URL}/payments`, () =>
        HttpResponse.json(
          {
            payment: { id: "77777777-7777-4777-8777-777777777777", status: "CONFIRMED" },
            debtBalance: "20.50",
            exceedsDebt: false,
          },
          { status: 201 },
        ),
      ),
    );

    renderDetail();
    await screen.findByRole("heading", { name: "Bodega Santa Rosa" });

    const tableBefore = await screen.findByRole("table");
    expect(within(tableBefore).getAllByRole("row")).toHaveLength(2); // header + 1 cargo
    expect(within(tableBefore).queryByText("Efectivo")).not.toBeInTheDocument();
    expect(statementCalls).toBe(1);

    await user.selectOptions(await screen.findByLabelText("Método de pago"), [
      "66666666-6666-4666-8666-666666666666",
    ]);
    await user.type(screen.getByLabelText("Monto"), "20.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));

    // "Deuda actual" se actualiza (ya cubierto arriba); lo nuevo es que el
    // estado de cuenta también recarga, sin que el dueño tenga que hacer nada.
    await waitFor(() => expect(statementCalls).toBe(2));

    const tableAfter = await screen.findByRole("table");
    const rowsAfter = within(tableAfter).getAllByRole("row");
    expect(rowsAfter).toHaveLength(3); // header + cargo + el abono nuevo

    const lastRow = rowsAfter[rowsAfter.length - 1];
    expect(lastRow?.textContent).toContain("Efectivo");
    expect(lastRow?.textContent).toContain("20.50");
  });
});
