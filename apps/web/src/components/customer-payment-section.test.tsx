import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { PaymentMethod } from "../api/payment-methods";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { CustomerPaymentSection } from "./customer-payment-section";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const CASH_ID = "22222222-2222-4222-8222-222222222222";
const YAPE_ID = "33333333-3333-4333-8333-333333333333";

function buildMethods(overrides: PaymentMethod[] = []): PaymentMethod[] {
  return overrides.length > 0
    ? overrides
    : [
        { id: CASH_ID, name: "Efectivo", active: true, requiresConfirmation: false },
        { id: YAPE_ID, name: "Yape", active: true, requiresConfirmation: true },
      ];
}

function stubMethods(methods: PaymentMethod[] = buildMethods()): void {
  server.use(http.get(`${API_BASE_URL}/payment-methods`, () => HttpResponse.json(methods)));
}

function stubMethodsError(message = "El catálogo no está disponible"): void {
  server.use(
    http.get(`${API_BASE_URL}/payment-methods`, () =>
      HttpResponse.json({ message }, { status: 500 }),
    ),
  );
}

/** Captures the JSON body of the POST so a test can assert the contract. */
function stubCreate(status = 201, payload?: JsonBodyType): { bodies: unknown[] } {
  const captured: { bodies: unknown[] } = { bodies: [] };
  server.use(
    http.post(`${API_BASE_URL}/payments`, async ({ request }) => {
      captured.bodies.push(await request.json());
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

function renderSection(onPaymentRegistered: (debtBalance: string) => void = () => {}) {
  return renderWithProviders(
    <CustomerPaymentSection customerId={CUSTOMER_ID} onPaymentRegistered={onPaymentRegistered} />,
  );
}

describe("CustomerPaymentSection", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("carga el catálogo de métodos de pago y los ofrece en el desplegable", async () => {
    stubMethods();

    renderSection();

    expect(await screen.findByRole("option", { name: "Efectivo" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Yape" })).toBeInTheDocument();
  });

  it("si el catálogo falla, el formulario se deshabilita con un mensaje y permite reintentar", async () => {
    const user = userEvent.setup();
    stubMethodsError("El catálogo no está disponible");

    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent("El catálogo no está disponible");
    expect(screen.queryByLabelText("Método de pago")).not.toBeInTheDocument();

    stubMethods();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByLabelText("Método de pago")).toBeInTheDocument();
  });

  it("si el catálogo viene vacío, el formulario se deshabilita con un mensaje, sin campo libre", async () => {
    stubMethods([]);

    renderSection();

    expect(
      await screen.findByText(/No hay métodos de pago activos configurados/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Método de pago")).not.toBeInTheDocument();
  });

  it("sin método elegido, el envío se bloquea con un mensaje propio", async () => {
    const user = userEvent.setup();
    stubMethods();

    renderSection();
    await screen.findByLabelText("Método de pago");
    await user.type(screen.getByLabelText("Monto"), "10.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Elige un método de pago");
  });

  it.each(["0.00", "abc", "-5.00", "10.005"])(
    "un monto inválido ('%s') bloquea el envío",
    async (amount) => {
      const user = userEvent.setup();
      stubMethods();

      renderSection();
      await user.selectOptions(await screen.findByLabelText("Método de pago"), CASH_ID);
      await user.type(screen.getByLabelText("Monto"), amount);
      await user.click(screen.getByRole("button", { name: "Registrar cobro" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/monto/i);
    },
  );

  // PaymentsService.createOfficePayment siempre escribe status: CONFIRMED,
  // sea cual sea el método — quien registra el cobro ESTÁ viendo la plata
  // entrar, así que no hay nada que confirmar después. requiresConfirmation
  // solo gobierna el cobro del chofer en ruta (SalesService), un camino de
  // escritura distinto. Esta pantalla no debe advertir "queda pendiente"
  // para ningún método: sería describir un estado que este endpoint nunca
  // produce. Ver la nota en api/payments.ts.
  it("un método con requiresConfirmation en true baja la deuda igual que Efectivo, sin ningún aviso", async () => {
    const user = userEvent.setup();
    stubMethods();
    stubCreate(201, {
      payment: { id: "44444444-4444-4444-8444-444444444444", status: "CONFIRMED" },
      debtBalance: "78.00",
      exceedsDebt: false,
    });
    let registeredWith: string | undefined;

    renderSection((debtBalance) => {
      registeredWith = debtBalance;
    });
    await user.selectOptions(await screen.findByLabelText("Método de pago"), YAPE_ID);
    expect(screen.queryByText(/pendiente/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Monto"), "20.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));

    expect(await screen.findByText(/Deuda actual: S\/ 78\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/pendiente/)).not.toBeInTheDocument();
    await waitFor(() => expect(registeredWith).toBe("78.00"));
  });

  it("un envío exitoso llama a onPaymentRegistered con la deuda nueva y la muestra sin error", async () => {
    const user = userEvent.setup();
    stubMethods();
    stubCreate(201, {
      payment: { id: "44444444-4444-4444-8444-444444444444", status: "CONFIRMED" },
      debtBalance: "10.00",
      exceedsDebt: false,
    });
    let registeredWith: string | undefined;

    renderSection((debtBalance) => {
      registeredWith = debtBalance;
    });
    await user.selectOptions(await screen.findByLabelText("Método de pago"), CASH_ID);
    await user.type(screen.getByLabelText("Monto"), "20.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));

    expect(await screen.findByText(/Deuda actual: S\/ 10\.00/)).toBeInTheDocument();
    await waitFor(() => expect(registeredWith).toBe("10.00"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("exceedsDebt se muestra como saldo a favor del cliente, nunca como error", async () => {
    const user = userEvent.setup();
    stubMethods();
    stubCreate(201, {
      payment: { id: "44444444-4444-4444-8444-444444444444", status: "CONFIRMED" },
      debtBalance: "-10.00",
      exceedsDebt: true,
    });

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Método de pago"), CASH_ID);
    await user.type(screen.getByLabelText("Monto"), "50.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));

    expect(await screen.findByText(/saldo a favor de S\/ 10\.00/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un reintento tras un error de red reusa la MISMA clave de idempotencia", async () => {
    const user = userEvent.setup();
    stubMethods();
    const captured = stubCreate(201, {
      payment: { id: "44444444-4444-4444-8444-444444444444", status: "CONFIRMED" },
      debtBalance: "10.00",
      exceedsDebt: false,
    });
    server.use(
      http.post(
        `${API_BASE_URL}/payments`,
        async ({ request }) => {
          captured.bodies.push(await request.json());
          return HttpResponse.json({ message: "Falla simulada" }, { status: 500 });
        },
        { once: true },
      ),
    );

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Método de pago"), CASH_ID);
    await user.type(screen.getByLabelText("Monto"), "20.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(captured.bodies).toHaveLength(2));

    const bodies = captured.bodies as { idempotencyKey: string }[];
    expect(bodies[1]?.idempotencyKey).toBe(bodies[0]?.idempotencyKey);
  });

  it("cambiar el monto después de un fallo genera una clave de idempotencia NUEVA", async () => {
    const user = userEvent.setup();
    stubMethods();
    const captured = stubCreate(201, {
      payment: { id: "44444444-4444-4444-8444-444444444444", status: "CONFIRMED" },
      debtBalance: "10.00",
      exceedsDebt: false,
    });
    server.use(
      http.post(
        `${API_BASE_URL}/payments`,
        async ({ request }) => {
          captured.bodies.push(await request.json());
          return HttpResponse.json({ message: "Falla simulada" }, { status: 500 });
        },
        { once: true },
      ),
    );

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Método de pago"), CASH_ID);
    await user.type(screen.getByLabelText("Monto"), "20.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await screen.findByRole("alert");

    // Cambiar el monto tras el fallo: la clave debe renovarse.
    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "25.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(captured.bodies).toHaveLength(2));

    const bodies = captured.bodies as { idempotencyKey: string }[];
    expect(bodies[1]?.idempotencyKey).not.toBe(bodies[0]?.idempotencyKey);
  });

  it("un 409 de idempotencia muestra un mensaje propio, entendible sin ser programador", async () => {
    const user = userEvent.setup();
    stubMethods();
    server.use(
      http.post(`${API_BASE_URL}/payments`, () =>
        HttpResponse.json({ message: "Conflict" }, { status: 409 }),
      ),
    );

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Método de pago"), CASH_ID);
    await user.type(screen.getByLabelText("Monto"), "20.00");
    await user.click(screen.getByRole("button", { name: "Registrar cobro" }));

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("Conflict");
    expect(alert.textContent).toMatch(/ya se había intentado antes/);
  });

  it("el botón se deshabilita mientras el envío está en vuelo", async () => {
    const user = userEvent.setup();
    stubMethods();
    server.use(
      http.post(`${API_BASE_URL}/payments`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(
          {
            payment: { id: "44444444-4444-4444-8444-444444444444", status: "CONFIRMED" },
            debtBalance: "10.00",
            exceedsDebt: false,
          },
          { status: 201 },
        );
      }),
    );

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Método de pago"), CASH_ID);
    await user.type(screen.getByLabelText("Monto"), "20.00");
    const button = screen.getByRole("button", { name: "Registrar cobro" });
    await user.click(button);

    expect(screen.getByRole("button", { name: "Registrando…" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
  });
});
