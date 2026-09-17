import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type {
  AccountStatementEntry,
  CustomerPrice,
  EffectivePrice,
  PaymentMethod,
  Product,
  UserRole,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const ID = "11111111-1111-4111-8111-111111111111";
const BASE = `/api/v1/customers/${ID}`;
const cleanups: Array<() => void> = [];

function endpoint(...args: Parameters<typeof registerEndpoint>) {
  cleanups.push(registerEndpoint(...args));
}

function fails(status: number, message: string) {
  return (event: H3Event) => {
    setResponseStatus(event, status);
    return { message };
  };
}

const CASH: PaymentMethod = {
  id: "m-cash",
  name: "Efectivo",
  active: true,
  requiresConfirmation: false,
};
const YAPE: PaymentMethod = {
  id: "m-yape",
  name: "Yape",
  active: true,
  requiresConfirmation: true,
};
const BIDON: Product = {
  id: "p-bidon",
  name: "Recarga bidón 20 L",
  type: "REFILL",
  containerType: { id: "ct-1", name: "Bidón 20 L" },
  listPrice: "8.00",
  active: true,
};

function entry(overrides: Partial<AccountStatementEntry>): AccountStatementEntry {
  return {
    date: "2026-08-05T14:00:00.000Z",
    type: "CHARGE",
    amount: "24.99",
    runningBalance: "24.99",
    isOpeningBalance: false,
    saleId: "s-1",
    locationName: "Local Centro",
    paymentId: null,
    paymentMethodName: null,
    status: null,
    voidedAt: null,
    ...overrides,
  };
}

interface Setup {
  roles?: UserRole[];
  entries?: AccountStatementEntry[];
  methods?: PaymentMethod[];
  prices?: CustomerPrice[];
  effective?: EffectivePrice[];
}

/** Todo lo que la ficha pide al montar, con valores de una ficha típica. */
function stubFicha(setup: Setup = {}) {
  cleanups.push(signIn(setup.roles ?? ["ADMIN"]));
  endpoint(BASE, {
    method: "GET",
    handler: () => buildCustomer({ id: ID, debtBalance: "98.00", creditLimit: "150.00" }),
  });
  endpoint("/api/v1/payment-methods", () => setup.methods ?? [CASH, YAPE]);
  endpoint("/api/v1/products", () => [BIDON]);
  endpoint(`${BASE}/prices`, { method: "GET", handler: () => setup.prices ?? [] });
  endpoint(`${BASE}/effective-prices`, () => setup.effective ?? []);
  endpoint(`${BASE}/account-statement`, () => ({
    customer: { id: ID, name: "Bodega Santa Rosa", debtBalance: "98.00" },
    // Distinto de todo a propósito: si alguna vez se pinta, el test lo ve.
    openingBalance: "999.00",
    entries: setup.entries ?? [],
    closingBalance: "98.00",
  }));
}

async function renderFicha() {
  await renderSuspended(App, { route: `/customers/${ID}` });
  await screen.findByRole("heading", { name: "Bodega Santa Rosa", level: 1 });
}

const user = () => userEvent.setup();

async function choose(label: string, option: string) {
  const u = user();
  await u.click(await screen.findByLabelText(label));
  await u.click(await screen.findByRole("option", { name: option }));
}

describe("Ficha del cliente", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  describe("datos y carga", () => {
    it("muestra deuda, límite, estado, teléfono, zona y dirección", async () => {
      stubFicha();
      await renderFicha();

      const datos = screen.getByRole("region", { name: "Datos del cliente" });
      expect(within(datos).getByText("S/ 98.00")).toBeTruthy();
      expect(within(datos).getByText("Límite de crédito: S/ 150.00")).toBeTruthy();
      expect(within(datos).getByText("Activo")).toBeTruthy();
      expect(within(datos).getByText("987654321")).toBeTruthy();
      expect(within(datos).getByText("Sin zona")).toBeTruthy();
      expect(within(datos).getByText("Portón azul")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Editar" }).getAttribute("href")).toBe(
        `/customers/${ID}/edit`,
      );
    });

    it("un id inexistente dice que ese cliente no existe, no un error genérico", async () => {
      cleanups.push(signIn());
      endpoint(BASE, fails(404, "no existe"));

      await renderSuspended(App, { route: `/customers/${ID}` });

      expect(await screen.findByText("Ese cliente no existe")).toBeTruthy();
      expect(screen.queryByText("No se pudo cargar el cliente")).toBeNull();
    });

    it("un error de la API se muestra y se puede reintentar", async () => {
      cleanups.push(signIn());
      let attempt = 0;
      endpoint(BASE, {
        method: "GET",
        handler: (event: H3Event) => {
          attempt++;
          if (attempt === 1) return fails(500, "Base de datos no disponible")(event);
          return buildCustomer({ id: ID });
        },
      });
      endpoint("/api/v1/payment-methods", () => []);
      endpoint("/api/v1/products", () => []);
      endpoint(`${BASE}/prices`, { method: "GET", handler: () => [] });
      endpoint(`${BASE}/account-statement`, () => ({ entries: [], closingBalance: "0.00" }));

      await renderSuspended(App, { route: `/customers/${ID}` });
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Base de datos no disponible",
      );
      await user().click(screen.getByRole("button", { name: "Reintentar" }));

      expect(
        await screen.findByRole("heading", { name: "Bodega Santa Rosa", level: 1 }),
      ).toBeTruthy();
    });
  });

  describe("registrar cobro", () => {
    function stubPayment(respond: (body: Record<string, unknown>, event: H3Event) => unknown) {
      const bodies: Array<Record<string, unknown>> = [];
      endpoint("/api/v1/payments", {
        method: "POST",
        handler: async (event: H3Event) => {
          const body = (await readBody(event)) as Record<string, unknown>;
          bodies.push(body);
          return respond(body, event);
        },
      });
      return bodies;
    }

    async function pay(method: string, amount: string) {
      await choose("Método de pago", method);
      const input = screen.getByLabelText("Monto");
      await user().clear(input);
      await user().type(input, amount);
      await user().click(screen.getByRole("button", { name: "Registrar cobro" }));
    }

    it("un cobro baja la deuda que ya se ve y recarga el estado de cuenta", async () => {
      let statementCalls = 0;
      stubFicha();
      endpoint(`${BASE}/account-statement`, () => {
        statementCalls++;
        return { entries: [], closingBalance: statementCalls > 1 ? "78.00" : "98.00" };
      });
      const bodies = stubPayment(() => ({
        payment: {},
        debtBalance: "78.00",
        exceedsDebt: false,
      }));
      await renderFicha();

      await pay("Efectivo", "20.00");

      expect(await screen.findByText("Cobro registrado. Deuda actual: S/ 78.00.")).toBeTruthy();
      const datos = screen.getByRole("region", { name: "Datos del cliente" });
      await waitFor(() => expect(within(datos).getByText("S/ 78.00")).toBeTruthy());
      await waitFor(() => expect(statementCalls).toBe(2));
      expect(bodies[0]).toMatchObject({
        customerId: ID,
        paymentMethodId: "m-cash",
        amount: "20.00",
      });
      expect(String(bodies[0]?.idempotencyKey)).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("con Yape (requiere confirmación en ruta) no avisa nada de pendiente: en oficina se confirma al registrar", async () => {
      stubFicha();
      stubPayment(() => ({ payment: {}, debtBalance: "78.00", exceedsDebt: false }));
      await renderFicha();

      await pay("Yape", "20.00");

      expect(await screen.findByText(/Deuda actual: S\/ 78\.00/)).toBeTruthy();
      expect(screen.queryByText(/pendiente/i)).toBeNull();
    });

    it("pagar de más se muestra como saldo a favor, nunca como error", async () => {
      stubFicha();
      stubPayment(() => ({ payment: {}, debtBalance: "-10.00", exceedsDebt: true }));
      await renderFicha();

      await pay("Efectivo", "108.00");

      expect(
        await screen.findByText(
          "Cobro registrado. El cliente queda con saldo a favor de S/ 10.00.",
        ),
      ).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("sin método elegido no envía y lo pide", async () => {
      stubFicha();
      const bodies = stubPayment(() => ({}));
      await renderFicha();

      await user().type(await screen.findByLabelText("Monto"), "10.00");
      await user().click(screen.getByRole("button", { name: "Registrar cobro" }));

      expect((await screen.findByRole("alert")).textContent).toContain("Elige un método de pago");
      expect(bodies).toHaveLength(0);
    });

    it.each(["0.00", "abc", "-5.00", "10.005"])(
      "un monto inválido (%s) no se envía",
      async (amount) => {
        stubFicha();
        const bodies = stubPayment(() => ({}));
        await renderFicha();

        await pay("Efectivo", amount);

        expect((await screen.findByRole("alert")).textContent).toMatch(/monto/i);
        expect(bodies).toHaveLength(0);
      },
    );

    it("reintentar tras un fallo reusa la MISMA clave; cambiar el monto genera una NUEVA", async () => {
      stubFicha();
      let calls = 0;
      const bodies = stubPayment((_body, event) => {
        calls++;
        if (calls <= 2) return fails(500, "Falla simulada")(event);
        return { payment: {}, debtBalance: "70.00", exceedsDebt: false };
      });
      await renderFicha();

      await pay("Efectivo", "20.00");
      await screen.findByRole("alert");
      await user().click(screen.getByRole("button", { name: "Registrar cobro" }));
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]?.idempotencyKey).toBe(bodies[0]?.idempotencyKey);

      await user().clear(screen.getByLabelText("Monto"));
      await user().type(screen.getByLabelText("Monto"), "25.00");
      await user().click(screen.getByRole("button", { name: "Registrar cobro" }));
      await waitFor(() => expect(bodies).toHaveLength(3));
      expect(bodies[2]?.idempotencyKey).not.toBe(bodies[1]?.idempotencyKey);
    });

    it("un 409 de idempotencia se explica sin jerga", async () => {
      stubFicha();
      stubPayment((_body, event) => fails(409, "Conflict")(event));
      await renderFicha();

      await pay("Efectivo", "20.00");

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toContain("Conflict");
      expect(alert.textContent).toMatch(/ya se había intentado antes/);
    });

    it("el botón se deshabilita mientras el cobro viaja", async () => {
      stubFicha();
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stubPayment(async () => {
        await gate;
        return { payment: {}, debtBalance: "78.00", exceedsDebt: false };
      });
      await renderFicha();

      await pay("Efectivo", "20.00");

      const pending = await screen.findByRole("button", { name: /Registrando…/ });
      expect((pending as HTMLButtonElement).disabled).toBe(true);
      release?.();
      expect(await screen.findByText(/Cobro registrado/)).toBeTruthy();
    });

    it("sin métodos de pago activos lo dice y no ofrece el formulario", async () => {
      stubFicha({ methods: [] });
      await renderFicha();

      expect(await screen.findByText("No hay métodos de pago activos")).toBeTruthy();
      expect(screen.queryByLabelText("Monto")).toBeNull();
    });
  });

  describe("precios pactados", () => {
    const pactado: CustomerPrice = {
      id: "cp-1",
      product: { id: "p-bidon", name: "Recarga bidón 20 L" },
      location: null,
      price: "7.50",
    };

    it("ADMIN pacta un precio: el POST manda el precio como string, sin prellenar el de lista", async () => {
      stubFicha();
      const bodies: unknown[] = [];
      endpoint(`${BASE}/prices`, {
        method: "POST",
        handler: async (event: H3Event) => {
          bodies.push(await readBody(event));
          return { ...pactado, price: "7.00" };
        },
      });
      await renderFicha();

      await user().click(await screen.findByRole("button", { name: "Agregar precio" }));
      await choose("Producto", "Recarga bidón 20 L");
      const precio = screen.getByLabelText("Precio pactado") as HTMLInputElement;
      expect(precio.value).toBe("");
      expect(screen.getByText("Precio de lista: S/ 8.00")).toBeTruthy();
      await user().type(precio, "7.00");
      await user().click(screen.getByRole("button", { name: "Guardar precio" }));

      const tabla = await screen.findByRole("table", { name: "Precios pactados del cliente" });
      expect(within(tabla).getByText("S/ 7.00")).toBeTruthy();
      expect(bodies).toEqual([{ productId: "p-bidon", price: "7.00" }]);
    });

    it("el duplicado de la API se muestra con su mensaje tal cual", async () => {
      stubFicha();
      endpoint(`${BASE}/prices`, {
        method: "POST",
        handler: fails(409, 'Ya existe un precio para "Recarga bidón 20 L"'),
      });
      await renderFicha();

      await user().click(await screen.findByRole("button", { name: "Agregar precio" }));
      await choose("Producto", "Recarga bidón 20 L");
      await user().type(screen.getByLabelText("Precio pactado"), "7.00");
      await user().click(screen.getByRole("button", { name: "Guardar precio" }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        'Ya existe un precio para "Recarga bidón 20 L"',
      );
    });

    it("editar guarda el precio nuevo; un fallo se muestra pegado a su fila sin perderla", async () => {
      stubFicha({ prices: [pactado] });
      let attempt = 0;
      endpoint(`${BASE}/prices/cp-1`, {
        method: "PATCH",
        handler: async (event: H3Event) => {
          attempt++;
          if (attempt === 1) return fails(500, "No se pudo guardar")(event);
          const body = (await readBody(event)) as { price: string };
          return { ...pactado, price: body.price };
        },
      });
      await renderFicha();

      await user().click(
        await screen.findByRole("button", { name: "Editar precio de Recarga bidón 20 L" }),
      );
      const input = screen.getByLabelText("Precio de Recarga bidón 20 L");
      await user().clear(input);
      await user().type(input, "6.90");
      await user().click(screen.getByRole("button", { name: "Guardar" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("No se pudo guardar");
      expect(screen.getByText("Recarga bidón 20 L")).toBeTruthy();

      await user().click(screen.getByRole("button", { name: "Guardar" }));
      const tabla = await screen.findByRole("table", { name: "Precios pactados del cliente" });
      await waitFor(() => expect(within(tabla).getByText("S/ 6.90")).toBeTruthy());
    });

    it("eliminar pide confirmación y recién entonces manda el DELETE", async () => {
      stubFicha({ prices: [pactado] });
      let deletes = 0;
      endpoint(`${BASE}/prices/cp-1`, {
        method: "DELETE",
        handler: (event: H3Event) => {
          deletes++;
          setResponseStatus(event, 204);
          return null;
        },
      });
      await renderFicha();

      await user().click(
        await screen.findByRole("button", { name: "Eliminar precio de Recarga bidón 20 L" }),
      );
      expect(screen.getByText("¿Eliminar? Volverá a regir el precio de lista.")).toBeTruthy();
      expect(deletes).toBe(0);

      await user().click(screen.getByRole("button", { name: "Sí, eliminar" }));

      expect(
        await screen.findByText(
          "Este cliente no tiene precios pactados: rige el precio de lista para todos sus productos.",
        ),
      ).toBeTruthy();
      expect(deletes).toBe(1);
    });

    it("un vendedor ve los precios efectivos en sólo lectura, sin gestión", async () => {
      stubFicha({
        roles: ["SELLER"],
        effective: [
          {
            product: { id: "p-bidon", name: "Recarga bidón 20 L" },
            price: "7.50",
            source: "CUSTOMER",
          },
          { product: { id: "p-caja", name: "Caja de botellas" }, price: "12.00", source: "LIST" },
        ],
      });
      await renderFicha();

      const tabla = await screen.findByRole("table", { name: "Precios efectivos del cliente" });
      expect(within(tabla).getByText("Pactado")).toBeTruthy();
      expect(within(tabla).getByText("Precio de lista")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Agregar precio" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Editar precio/ })).toBeNull();
    });
  });

  describe("estado de cuenta", () => {
    it("muestra cargos y abonos con su saldo corriente y estado, y nunca el openingBalance", async () => {
      stubFicha({
        entries: [
          entry({
            isOpeningBalance: true,
            amount: "148.00",
            runningBalance: "148.00",
            saleId: "s-0",
          }),
          entry({
            type: "PAYMENT",
            amount: "50.00",
            runningBalance: "148.00",
            saleId: null,
            paymentId: "p-1",
            paymentMethodName: "Yape",
            status: "PENDING",
            locationName: null,
          }),
        ],
      });
      await renderFicha();

      const tabla = await screen.findByRole("table", { name: "Estado de cuenta del cliente" });
      expect(within(tabla).getByText("Saldo inicial")).toBeTruthy();
      expect(within(tabla).getByText("Pendiente")).toBeTruthy();
      expect(within(tabla).getByText("Yape")).toBeTruthy();
      expect(screen.queryByText("S/ 999.00")).toBeNull();
    });

    it("una fila anulada se marca, y la viva del mismo monto no", async () => {
      stubFicha({
        entries: [
          entry({
            saleId: "s-viva",
            amount: "60.00",
            runningBalance: "60.00",
            date: "2026-08-10T13:00:00.000Z",
          }),
          entry({
            saleId: "s-anulada",
            amount: "60.00",
            runningBalance: "60.00",
            date: "2026-08-11T13:00:00.000Z",
            voidedAt: "2026-08-12T13:00:00.000Z",
          }),
        ],
      });
      await renderFicha();

      const tabla = await screen.findByRole("table", { name: "Estado de cuenta del cliente" });
      expect(within(tabla).getAllByText("S/ 60.00")).toHaveLength(4);
      const marks = within(tabla).getAllByText("Anulado");
      expect(marks).toHaveLength(1);
      expect(marks[0]?.closest("tr")?.textContent).toContain("11/08/2026");
    });

    it("las fechas son instantes en hora de Lima, no días de negocio", async () => {
      stubFicha({ entries: [entry({ date: "2026-08-05T02:30:00.000Z" })] });
      await renderFicha();

      const tabla = await screen.findByRole("table", { name: "Estado de cuenta del cliente" });
      expect(within(tabla).getByText("04/08/2026 21:30")).toBeTruthy();
    });

    it("sin movimientos lo dice", async () => {
      stubFicha({ entries: [] });
      await renderFicha();

      expect(await screen.findByText("Sin movimientos todavía")).toBeTruthy();
    });
  });
});
