import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { AccountStatementEntry } from "../api/account-statement";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { CustomerAccountStatementSection } from "./customer-account-statement-section";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

/**
 * A realistic mix: the opening-balance charge dragged in from the paper
 * ledger, a later charge, a PENDING payment (Yape) that must NOT move
 * runningBalance, a CONFIRMED payment (Efectivo) that does, and a REJECTED
 * payment that also leaves it untouched — the same shape the backend
 * produces per CustomersService.getAccountStatement.
 */
function buildEntries(): AccountStatementEntry[] {
  return [
    {
      date: "2026-08-01T08:00:00.000Z",
      type: "CHARGE",
      amount: "148.00",
      runningBalance: "148.00",
      isOpeningBalance: true,
      saleId: "s1",
      locationName: "Local Centro",
      paymentId: null,
      paymentMethodName: null,
      status: null,
      voidedAt: null,
    },
    {
      date: "2026-08-05T09:00:00.000Z",
      type: "CHARGE",
      amount: "24.99",
      runningBalance: "172.99",
      isOpeningBalance: false,
      saleId: "s2",
      locationName: "Local Centro",
      paymentId: null,
      paymentMethodName: null,
      status: null,
      voidedAt: null,
    },
    {
      date: "2026-08-06T10:00:00.000Z",
      type: "PAYMENT",
      amount: "50.00",
      runningBalance: "172.99",
      isOpeningBalance: false,
      saleId: null,
      locationName: null,
      paymentId: "p1",
      paymentMethodName: "Yape",
      status: "PENDING",
      voidedAt: null,
    },
    {
      date: "2026-08-07T11:00:00.000Z",
      type: "PAYMENT",
      amount: "100.00",
      runningBalance: "72.99",
      isOpeningBalance: false,
      saleId: null,
      locationName: null,
      paymentId: "p2",
      paymentMethodName: "Efectivo",
      status: "CONFIRMED",
      voidedAt: null,
    },
    {
      date: "2026-08-08T12:00:00.000Z",
      type: "PAYMENT",
      amount: "30.00",
      runningBalance: "72.99",
      isOpeningBalance: false,
      saleId: null,
      locationName: null,
      paymentId: "p3",
      paymentMethodName: "Transferencia",
      status: "REJECTED",
      voidedAt: null,
    },
  ];
}

function stubStatement(
  entries: AccountStatementEntry[] = buildEntries(),
  overrides: Partial<JsonBodyType & Record<string, unknown>> = {},
): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/account-statement`, () =>
      HttpResponse.json({
        customer: { id: CUSTOMER_ID, name: "Bodega Santa Rosa", debtBalance: "72.99" },
        // Deliberately non-zero and different from any real value, so a test
        // asserting it never renders stays meaningful even if the backend's
        // "always 0.00 without `from`" behavior changes later.
        openingBalance: "999.00",
        entries,
        closingBalance: "72.99",
        ...overrides,
      }),
    ),
  );
}

function stubStatementError(message = "Base de datos no disponible"): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/account-statement`, () =>
      HttpResponse.json({ message }, { status: 500 }),
    ),
  );
}

function renderSection() {
  return renderWithProviders(<CustomerAccountStatementSection customerId={CUSTOMER_ID} />);
}

describe("CustomerAccountStatementSection", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("carga y muestra cargos y abonos intercalados con su saldo corriente", async () => {
    stubStatement();

    renderSection();

    expect(await screen.findAllByText("Cargo")).toHaveLength(2);
    expect(screen.getAllByText("Abono")).toHaveLength(3);

    // El saldo de cierre del encabezado viene del backend, no se recalcula
    // (aparece también en las filas cuyo saldo corriente termina igual).
    expect(screen.getAllByText("S/ 72.99").length).toBeGreaterThanOrEqual(1);

    // Saldo corriente de cada fila, tal cual lo manda el backend (el monto
    // de la primera fila coincide con su propio saldo, por eso aparece dos
    // veces: monto y saldo corriente de esa fila).
    expect(screen.getAllByText("S/ 148.00")).toHaveLength(2);
    expect(screen.getAllByText("S/ 172.99")).toHaveLength(2);
  });

  it("un abono PENDING o REJECTED se muestra con su badge, sin alterar el saldo corriente", async () => {
    stubStatement();

    renderSection();

    await screen.findByRole("table");

    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Rechazado")).toBeInTheDocument();
    expect(screen.getByText("Confirmado")).toBeInTheDocument();

    // El PENDING (Yape) y el CONFIRMED (Efectivo) previo comparten el mismo
    // saldo corriente ("172.99"): el pendiente no lo movió.
    const rows = screen.getAllByRole("row");
    const yapeRow = rows.find((row) => row.textContent?.includes("Yape"));
    const rejectedRow = rows.find((row) => row.textContent?.includes("Transferencia"));
    expect(yapeRow?.textContent).toContain("172.99");
    // El rechazado deja el saldo igual al del pago confirmado anterior (72.99).
    expect(rejectedRow?.textContent).toContain("72.99");
  });

  it("openingBalance del backend nunca se renderiza, aunque venga distinto de closingBalance", async () => {
    stubStatement();

    renderSection();

    await screen.findByRole("table");

    expect(screen.queryByText("S/ 999.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/999\.00/)).not.toBeInTheDocument();
  });

  /**
   * Dos cargos del MISMO monto, uno anulado y otro vivo: así la marca no
   * puede pasar por casualidad. La fila anulada se muestra en vez de
   * esconderse — el cliente vio esa entrega y va a preguntar por ella — y su
   * `runningBalance` llega ya sin el efecto de la fila, calculado por la API.
   */
  it("una fila anulada se marca, y la viva del mismo monto no", async () => {
    stubStatement([
      {
        date: "2026-08-10T13:00:00.000Z",
        type: "CHARGE",
        amount: "60.00",
        runningBalance: "60.00",
        isOpeningBalance: false,
        saleId: "s-viva",
        locationName: "Local Centro",
        paymentId: null,
        paymentMethodName: null,
        status: null,
        voidedAt: null,
      },
      {
        date: "2026-08-11T13:00:00.000Z",
        type: "CHARGE",
        amount: "60.00",
        runningBalance: "60.00",
        isOpeningBalance: false,
        saleId: "s-anulada",
        locationName: "Local Centro",
        paymentId: null,
        paymentMethodName: null,
        status: null,
        voidedAt: "2026-08-12T13:00:00.000Z",
      },
    ]);

    renderSection();

    await screen.findByRole("table");

    // Los dos cargos son de S/ 60.00 (monto y saldo de cada fila: 4 celdas).
    expect(screen.getAllByText("S/ 60.00")).toHaveLength(4);

    const marks = screen.getAllByText("Anulado");
    expect(marks).toHaveLength(1);
    expect((marks[0] as HTMLElement).closest("tr")?.textContent).toContain("11/08/2026");
  });

  it("el arrastre del padrón se marca como 'Saldo inicial'", async () => {
    stubStatement();

    renderSection();

    expect(await screen.findByText("Saldo inicial")).toBeInTheDocument();
  });

  it("estado vacío cuando no hay movimientos", async () => {
    stubStatement([]);

    renderSection();

    expect(await screen.findByText("Sin movimientos todavía.")).toBeInTheDocument();
  });

  it("un error de carga se muestra con opción de reintentar", async () => {
    const user = userEvent.setup();
    stubStatementError("Base de datos no disponible");

    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    stubStatement([]);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Sin movimientos todavía.")).toBeInTheDocument();
  });

  it("las fechas se formatean como instante (formatBusinessDateTime), no como fecha de negocio", async () => {
    stubStatement();

    renderSection();

    // "2026-08-01T08:00:00.000Z" en America/Lima (UTC-5) es 01/08/2026 03:00.
    expect(await screen.findByText("01/08/2026 03:00")).toBeInTheDocument();
  });
});
