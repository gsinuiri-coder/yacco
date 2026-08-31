import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { Customer, PaginatedCustomers } from "../api/customers";
import type { PaymentMethod } from "../api/payment-methods";
import type { PaginatedPayments, PaymentRow } from "../api/payments";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { PaymentsPage } from "./payments-page";

const CASH_ID = "22222222-2222-4222-8222-222222222222";
const YAPE_ID = "33333333-3333-4333-8333-333333333333";

function buildPayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    customer: { id: "11111111-1111-4111-8111-111111111111", name: "Bodega Santa Rosa" },
    location: { id: "66666666-6666-4666-8666-666666666666", name: "Principal" },
    paymentMethod: { id: YAPE_ID, name: "Yape" },
    amount: "25.00",
    status: "PENDING",
    paidAt: "2026-08-25T15:00:00.000Z",
    saleId: null,
    stopId: null,
    recordedBy: { id: "77777777-7777-4777-8777-777777777777", username: "vendedor1" },
    confirmedAt: null,
    confirmedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    voidedAt: null,
    voidReason: null,
    isOpeningBalance: false,
    ...overrides,
  };
}

function buildPage(overrides: Partial<PaginatedPayments> = {}): PaginatedPayments {
  const data = overrides.data ?? [buildPayment()];
  return {
    data,
    total: data.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    totals: { count: data.length, amount: "25.00" },
    ...overrides,
  };
}

function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "88888888-8888-4888-8888-888888888888",
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

/** Records the query string of every /payments request the page makes. */
function stubPayments(respond: (url: URL) => PaginatedPayments): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(`${API_BASE_URL}/payments`, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      return HttpResponse.json(respond(url));
    }),
  );
  return seen;
}

function stubMethods(
  methods: PaymentMethod[] = [
    { id: CASH_ID, name: "Efectivo", active: true, requiresConfirmation: false },
    { id: YAPE_ID, name: "Yape", active: true, requiresConfirmation: true },
  ],
): void {
  server.use(http.get(`${API_BASE_URL}/payment-methods`, () => HttpResponse.json(methods)));
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

function stubConfirm(status: number, body: JsonBodyType): void {
  server.use(
    http.post(`${API_BASE_URL}/payments/:id/confirm`, () => HttpResponse.json(body, { status })),
  );
}

/** Captures the JSON body of the reject POST so a test can assert `reason`. */
function stubReject(status: number, body: JsonBodyType): { bodies: unknown[] } {
  const captured: { bodies: unknown[] } = { bodies: [] };
  server.use(
    http.post(`${API_BASE_URL}/payments/:id/reject`, async ({ request }) => {
      captured.bodies.push(await request.json());
      return HttpResponse.json(body, { status });
    }),
  );
  return captured;
}

function renderPage() {
  return renderWithProviders(<PaymentsPage />, "/payments");
}

describe("PaymentsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
    stubMethods();
  });

  it("arranca filtrada en PENDING: es el trabajo real de la bandeja", async () => {
    const seen = stubPayments(() => buildPage());

    renderPage();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    expect(seen[0]?.searchParams.get("status")).toBe("PENDING");
    expect(screen.getByLabelText("Estado")).toHaveValue("PENDING");
  });

  it("muestra cliente, método, monto, estado, fecha de cobro y quién lo registró", async () => {
    stubPayments(() => buildPage());

    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Bodega Santa Rosa")).toBeInTheDocument();
    expect(within(table).getByText("Principal")).toBeInTheDocument();
    expect(within(table).getByText("Yape")).toBeInTheDocument();
    expect(within(table).getByText("S/ 25.00")).toBeInTheDocument();
    expect(within(table).getByText("Pendiente")).toBeInTheDocument();
    expect(within(table).getByText("25/08/2026 10:00")).toBeInTheDocument();
    expect(within(table).getByText("vendedor1")).toBeInTheDocument();
  });

  /**
   * El cobro va PENDING y anulado a la vez, que es el estado real: anular no
   * cambia el estado. Con CONFIRMED los botones ya no salían por el estado y
   * el test no mediría nada nuevo.
   */
  it("un cobro anulado sigue PENDING pero no ofrece Confirmar ni Rechazar", async () => {
    stubPayments(() =>
      buildPage({
        data: [
          buildPayment({
            status: "PENDING",
            voidedAt: "2026-08-26T14:00:00.000Z",
            voidReason: "Se anotó al cliente equivocado",
          }),
        ],
      }),
    );

    renderPage();

    const table = await screen.findByRole("table");
    // Se queda listado, con su monto original: la bandeja no lo esconde.
    expect(within(table).getByText("Bodega Santa Rosa")).toBeInTheDocument();
    expect(within(table).getByText("S/ 25.00")).toBeInTheDocument();
    expect(within(table).getByText("Pendiente")).toBeInTheDocument();
    expect(within(table).getByText("Anulado")).toBeInTheDocument();
    expect(
      within(table).getByText("Motivo de la anulación: Se anotó al cliente equivocado"),
    ).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rechazar" })).not.toBeInTheDocument();
  });

  /**
   * Anular las cobranzas de una venta corregida no filtra por estado
   * (SalesService.voidStopDeliveryWithinTransaction), así que un cobro
   * rechazado puede además quedar anulado y arrastrar los dos motivos. Cada
   * uno se nombra: dos líneas que empezaran igual no dejarían saber cuál es
   * cuál.
   */
  it("un cobro rechazado y además anulado nombra cada motivo por separado", async () => {
    stubPayments(() =>
      buildPage({
        data: [
          buildPayment({
            status: "REJECTED",
            rejectionReason: "El Yape nunca llegó",
            voidedAt: "2026-08-26T14:00:00.000Z",
            voidReason: "Se anotó al cliente equivocado",
          }),
        ],
      }),
    );

    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Rechazado")).toBeInTheDocument();
    expect(within(table).getByText("Anulado")).toBeInTheDocument();
    expect(within(table).getByText("Motivo del rechazo: El Yape nunca llegó")).toBeInTheDocument();
    expect(
      within(table).getByText("Motivo de la anulación: Se anotó al cliente equivocado"),
    ).toBeInTheDocument();
  });

  it("un cobro pendiente sin anular sigue ofreciendo Confirmar y Rechazar", async () => {
    stubPayments(() => buildPage());

    renderPage();

    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.queryByText("Anulado")).not.toBeInTheDocument();
  });

  it("el resumen muestra el total del filtro completo, no de la página", async () => {
    stubPayments(() => buildPage({ totals: { count: 37, amount: "925.50" } }));

    renderPage();

    expect(await screen.findByText("37 pagos con este filtro · S/ 925.50")).toBeInTheDocument();
  });

  it("cada filtro llega a la query de la API con el valor correcto", async () => {
    const user = userEvent.setup();
    stubCustomerSearch([buildCustomer()]);
    const seen = stubPayments(() => buildPage());

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.selectOptions(screen.getByLabelText("Estado"), "all");
    await waitFor(() => expect(seen.at(-1)?.searchParams.has("status")).toBe(false));

    await user.selectOptions(await screen.findByLabelText("Método de pago"), YAPE_ID);
    await waitFor(() => expect(seen.at(-1)?.searchParams.get("paymentMethodId")).toBe(YAPE_ID));

    await user.type(screen.getByLabelText("Cobrado desde"), "2026-08-01");
    await waitFor(() =>
      expect(seen.at(-1)?.searchParams.get("paidFrom")).toBe("2026-08-01T00:00:00-05:00"),
    );

    await user.type(screen.getByLabelText("Cobrado hasta"), "2026-08-31");
    await waitFor(() =>
      expect(seen.at(-1)?.searchParams.get("paidTo")).toBe("2026-08-31T23:59:59-05:00"),
    );

    await user.type(screen.getByLabelText("Cliente"), "aurora");
    await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));
    await waitFor(() =>
      expect(seen.at(-1)?.searchParams.get("customerId")).toBe(
        "88888888-8888-4888-8888-888888888888",
      ),
    );
  });

  it("limpia los filtros con el botón dedicado y vuelve a PENDING", async () => {
    const user = userEvent.setup();
    const seen = stubPayments(() => buildPage());

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.selectOptions(screen.getByLabelText("Estado"), "all");
    await waitFor(() => expect(seen.at(-1)?.searchParams.has("status")).toBe(false));

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    await waitFor(() => expect(seen.at(-1)?.searchParams.get("status")).toBe("PENDING"));
    expect(screen.getByLabelText("Estado")).toHaveValue("PENDING");
  });

  it("un vendedor ve la lista pero no los botones de Confirmar/Rechazar", async () => {
    signIn(["SELLER"]);
    stubPayments(() => buildPage());

    renderPage();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rechazar" })).not.toBeInTheDocument();
  });

  it("un pago ya no PENDING no ofrece Confirmar ni Rechazar, aunque el usuario sea ADMIN", async () => {
    stubPayments(() => buildPage({ data: [buildPayment({ status: "CONFIRMED" })] }));

    renderPage();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rechazar" })).not.toBeInTheDocument();
  });

  it("un pago rechazado muestra el motivo", async () => {
    stubPayments(() =>
      buildPage({
        data: [
          buildPayment({
            status: "REJECTED",
            rejectionReason: "El cliente muestra el Yape pero no llegó a la cuenta de la planta",
          }),
        ],
      }),
    );

    renderPage();

    expect(
      await screen.findByText(/El cliente muestra el Yape pero no llegó a la cuenta/),
    ).toBeInTheDocument();
  });

  it("Confirmar llama a POST /payments/:id/confirm y avisa la deuda resultante", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    stubConfirm(200, {
      payment: buildPayment({ status: "CONFIRMED" }),
      debtBalance: "0.00",
    });

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText(/Pago de Bodega Santa Rosa confirmado\. Deuda actual: S\/ 0\.00\./),
    ).toBeInTheDocument();
  });

  it("Confirmar con 409 avisa que ya no está pendiente y recarga la lista", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubPayments(() => {
      attempt += 1;
      return buildPage({
        data: [buildPayment({ status: attempt === 1 ? "PENDING" : "CONFIRMED" })],
      });
    });
    server.use(
      http.post(`${API_BASE_URL}/payments/:id/confirm`, () =>
        HttpResponse.json({ message: "Este pago ya está en estado CONFIRMED" }, { status: 409 }),
      ),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ya no está pendiente/);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument(),
    );
  });

  it("Confirmar con 404 avisa que el pago ya no existe", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    server.use(
      http.post(`${API_BASE_URL}/payments/:id/confirm`, () =>
        HttpResponse.json({ message: 'El pago "x" no existe' }, { status: 404 }),
      ),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Este pago ya no existe.");
  });

  it("Confirmar con 403 avisa que falta el permiso de administrador", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    server.use(
      http.post(`${API_BASE_URL}/payments/:id/confirm`, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tienes permiso de administrador para confirmar pagos.",
    );
  });

  it("Confirmar con un error genérico muestra el mensaje de la API, sin recargar la lista", async () => {
    const user = userEvent.setup();
    const seen = stubPayments(() => buildPage());
    server.use(
      http.post(`${API_BASE_URL}/payments/:id/confirm`, () =>
        HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 }),
      ),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");
    const requestsBeforeConfirm = seen.length;

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");
    expect(seen.length).toBe(requestsBeforeConfirm);
  });

  it("si el catálogo de métodos de pago falla, el filtro solo ofrece «Todos» sin romper la bandeja", async () => {
    stubPayments(() => buildPage());
    server.use(
      http.get(`${API_BASE_URL}/payment-methods`, () =>
        HttpResponse.json({ message: "Catálogo no disponible" }, { status: 500 }),
      ),
    );

    renderPage();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    const methodFilter = screen.getByLabelText("Método de pago");
    expect(within(methodFilter).getAllByRole("option")).toHaveLength(1);
  });

  it("Rechazar con 404 avisa que el pago ya no existe y cierra el formulario", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    server.use(
      http.post(`${API_BASE_URL}/payments/:id/reject`, () =>
        HttpResponse.json({ message: 'El pago "x" no existe' }, { status: 404 }),
      ),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    const form = screen.getByRole("form", { name: /Rechazar pago de Bodega Santa Rosa/ });
    await user.type(within(form).getByLabelText("Motivo del rechazo"), "No llegó a la cuenta");
    await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Este pago ya no existe.");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("Rechazar con un error genérico lo muestra dentro del formulario, que sigue abierto", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    server.use(
      http.post(`${API_BASE_URL}/payments/:id/reject`, () =>
        HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 }),
      ),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    const form = screen.getByRole("form", { name: /Rechazar pago de Bodega Santa Rosa/ });
    await user.type(within(form).getByLabelText("Motivo del rechazo"), "No llegó a la cuenta");
    await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("Base de datos no disponible");
    expect(
      screen.getByRole("form", { name: /Rechazar pago de Bodega Santa Rosa/ }),
    ).toBeInTheDocument();
  });

  it("Rechazar con 403 avisa que falta el permiso de administrador, formulario abierto", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    server.use(
      http.post(`${API_BASE_URL}/payments/:id/reject`, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    const form = screen.getByRole("form", { name: /Rechazar pago de Bodega Santa Rosa/ });
    await user.type(within(form).getByLabelText("Motivo del rechazo"), "No llegó a la cuenta");
    await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "No tienes permiso de administrador para rechazar pagos.",
    );
  });

  it("Rechazar abre un formulario con motivo obligatorio: en blanco no dispara la llamada", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    const captured = stubReject(200, {
      payment: buildPayment({ status: "REJECTED" }),
      debtBalance: "25.00",
    });

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    const form = screen.getByRole("form", { name: /Rechazar pago de Bodega Santa Rosa/ });
    await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));

    expect(within(form).getByRole("alert")).toHaveTextContent("Escribe el motivo del rechazo");
    expect(captured.bodies).toHaveLength(0);
  });

  it("Rechazar con motivo llama a POST /payments/:id/reject con la razón y avisa la deuda", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    const captured = stubReject(200, {
      payment: buildPayment({ status: "REJECTED" }),
      debtBalance: "25.00",
    });

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    const form = screen.getByRole("form", { name: /Rechazar pago de Bodega Santa Rosa/ });
    await user.type(
      within(form).getByLabelText("Motivo del rechazo"),
      "El cliente muestra el Yape pero no llegó a la cuenta",
    );
    await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));

    expect(captured.bodies).toEqual([
      { reason: "El cliente muestra el Yape pero no llegó a la cuenta" },
    ]);
    expect(
      await screen.findByText(/Pago de Bodega Santa Rosa rechazado\. Deuda actual: S\/ 25\.00\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("«Cancelar» cierra el formulario de rechazo sin llamar a la API", async () => {
    const user = userEvent.setup();
    stubPayments(() => buildPage());
    const captured = stubReject(200, {
      payment: buildPayment({ status: "REJECTED" }),
      debtBalance: "25.00",
    });

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(captured.bodies).toHaveLength(0);
  });

  it("Rechazar con 409 cierra el formulario, avisa y recarga la lista", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubPayments(() => {
      attempt += 1;
      return buildPage({
        data: [buildPayment({ status: attempt === 1 ? "PENDING" : "REJECTED" })],
      });
    });
    server.use(
      http.post(`${API_BASE_URL}/payments/:id/reject`, () =>
        HttpResponse.json({ message: "Este pago ya está en estado REJECTED" }, { status: 409 }),
      ),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    const form = screen.getByRole("form", { name: /Rechazar pago de Bodega Santa Rosa/ });
    await user.type(within(form).getByLabelText("Motivo del rechazo"), "No llegó a la cuenta");
    await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ya no está pendiente/);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("distingue el vacío por filtro del vacío real", async () => {
    const user = userEvent.setup();
    stubPayments((url) =>
      url.searchParams.get("status") === "REJECTED"
        ? buildPage({ data: [], total: 0, totalPages: 0, totals: { count: 0, amount: "0.00" } })
        : buildPage(),
    );

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.selectOptions(screen.getByLabelText("Estado"), "REJECTED");

    expect(await screen.findByText("Ningún pago coincide con el filtro")).toBeInTheDocument();
  });

  it("muestra un estado vacío real cuando aún no hay pagos", async () => {
    stubPayments(() =>
      buildPage({ data: [], total: 0, totalPages: 0, totals: { count: 0, amount: "0.00" } }),
    );

    renderPage();

    expect(await screen.findByText("Todavía no hay pagos")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("muestra el error de la API y permite reintentar", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/payments`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json(buildPage());
      }),
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
  });

  it("pagina: «Siguiente» pide la página 2", async () => {
    const user = userEvent.setup();
    const seen = stubPayments((url) => {
      const page = Number(url.searchParams.get("page"));
      return buildPage({
        data: [buildPayment({ id: page === 2 ? "payment-2" : "payment-1" })],
        total: 40,
        page,
        totalPages: 2,
      });
    });

    renderPage();
    await screen.findByText("Bodega Santa Rosa");
    expect(seen[0]?.searchParams.get("limit")).toBe("20");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(seen.at(-1)?.searchParams.get("page")).toBe("2"));
    expect(await screen.findByText("Página 2 de 2")).toBeInTheDocument();
  });
});
