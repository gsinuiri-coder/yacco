import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { PaymentRow, UserRole } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, pageOf } from "../support/fixtures";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
type Query = Record<string, string>;

function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "pay-1",
    customer: { id: "c-1", name: "Bodega Santa Rosa" },
    location: { id: "loc-1", name: "Principal" },
    paymentMethod: { id: "m-yape", name: "Yape" },
    amount: "25.00",
    status: "PENDING",
    paidAt: "2026-08-25T15:00:00.000Z",
    saleId: null,
    stopId: null,
    recordedBy: { id: "u-1", username: "vendedor1" },
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

/** Cada lectura puede devolver otra versión; guarda la query de cada una. */
function stubPayments(
  versions: Array<PaymentRow[]>,
  totals = { count: 1, amount: "25.00" },
): Query[] {
  const seen: Query[] = [];
  cleanups.push(
    registerEndpoint("/api/v1/payments", {
      method: "GET",
      handler: (event: H3Event) => {
        seen.push(getQuery(event) as Query);
        const rows = versions[Math.min(seen.length - 1, versions.length - 1)]!;
        return { ...pageOf(rows), totals };
      },
    }),
    registerEndpoint("/api/v1/payment-methods", () => [
      { id: "m-cash", name: "Efectivo", active: true, requiresConfirmation: false },
      { id: "m-yape", name: "Yape", active: true, requiresConfirmation: true },
    ]),
  );
  return seen;
}

async function renderPayments(roles: UserRole[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/payments" });
  await screen.findByRole("heading", { name: "Pagos", level: 1 });
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("Pagos", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("arranca en Pendiente y muestra cliente, método, monto, estado, cobro (hora de Lima) y quién lo registró", async () => {
    const seen = stubPayments([[payment()]]);

    await renderPayments();

    const row = await waitFor(() => rowOf("Bodega Santa Rosa"));
    expect(seen[0]).toEqual({ status: "PENDING", page: "1", limit: "20" });
    expect(within(row).getByText("Principal")).toBeTruthy();
    expect(within(row).getByText("Yape")).toBeTruthy();
    expect(within(row).getByText("S/ 25.00")).toBeTruthy();
    expect(within(row).getByText("Pendiente")).toBeTruthy();
    expect(within(row).getByText("25/08/2026 10:00")).toBeTruthy();
    expect(within(row).getByText("vendedor1")).toBeTruthy();
  });

  it("el resumen suma el filtro completo, no la página", async () => {
    stubPayments([[payment()]], { count: 37, amount: "925.50" });

    await renderPayments();

    expect(await screen.findByText("37 pagos con este filtro · S/ 925.50")).toBeTruthy();
  });

  it("un cobro anulado sigue Pendiente, se marca, y NO ofrece Confirmar ni Rechazar", async () => {
    stubPayments([
      [
        payment({ voidedAt: "2026-08-26T10:00:00.000Z", voidReason: "Se anotó dos veces" }),
        payment({ id: "pay-2", customer: { id: "c-2", name: "Panadería Aurora" } }),
      ],
    ]);

    await renderPayments();

    const voided = await waitFor(() => rowOf("Bodega Santa Rosa"));
    expect(within(voided).getByText("Anulado")).toBeTruthy();
    expect(within(voided).getByText("Motivo de la anulación: Se anotó dos veces")).toBeTruthy();
    expect(within(voided).queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(within(voided).queryByRole("button", { name: "Rechazar" })).toBeNull();
    // La viva de al lado sí los ofrece: el dato que discrimina la regla.
    expect(
      within(rowOf("Panadería Aurora")).getByRole("button", { name: "Confirmar" }),
    ).toBeTruthy();
  });

  it("un cobro rechazado y además anulado nombra cada motivo por separado", async () => {
    stubPayments([
      [
        payment({
          status: "REJECTED",
          rejectionReason: "El Yape no llegó",
          voidedAt: "2026-08-26T10:00:00.000Z",
          voidReason: "Venta corregida",
        }),
      ],
    ]);

    await renderPayments();

    const row = await waitFor(() => rowOf("Bodega Santa Rosa"));
    expect(within(row).getByText("Motivo del rechazo: El Yape no llegó")).toBeTruthy();
    expect(within(row).getByText("Motivo de la anulación: Venta corregida")).toBeTruthy();
  });

  it("un vendedor ve la bandeja sin Confirmar ni Rechazar; un pago ya confirmado tampoco los ofrece a ADMIN", async () => {
    stubPayments([[payment()]]);
    await renderPayments(["SELLER"]);
    await waitFor(() => rowOf("Bodega Santa Rosa"));
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
  });

  it("un pago confirmado no ofrece acciones aunque sea ADMIN", async () => {
    stubPayments([[payment({ status: "CONFIRMED" })]]);
    await renderPayments();
    await waitFor(() => rowOf("Bodega Santa Rosa"));
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
  });

  it("cada filtro llega a la query; las fechas como límites del día en Lima; «Limpiar» vuelve a Pendiente", async () => {
    const seen = stubPayments([[payment()]]);
    cleanups.push(
      registerEndpoint("/api/v1/customers", () =>
        pageOf([buildCustomer({ id: "c-aurora", name: "Panadería Aurora" })]),
      ),
    );
    const user = userEvent.setup();

    await renderPayments();
    await waitFor(() => rowOf("Bodega Santa Rosa"));
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();

    await choose("Estado", "Todos");
    await waitFor(() => expect(seen.at(-1)).not.toHaveProperty("status"));
    await choose("Método de pago", "Yape");
    await waitFor(() => expect(seen.at(-1)?.paymentMethodId).toBe("m-yape"));
    await fireEvent.update(screen.getByLabelText("Cobrado desde"), "2026-08-01");
    await waitFor(() => expect(seen.at(-1)?.paidFrom).toBe("2026-08-01T00:00:00-05:00"));
    await fireEvent.update(screen.getByLabelText("Cobrado hasta"), "2026-08-31");
    await waitFor(() => expect(seen.at(-1)?.paidTo).toBe("2026-08-31T23:59:59-05:00"));
    await user.type(screen.getByLabelText("Cliente"), "aurora");
    await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));
    await waitFor(() => expect(seen.at(-1)?.customerId).toBe("c-aurora"));

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => expect(seen.at(-1)).toEqual({ status: "PENDING", page: "1", limit: "20" }));
  });

  it("si el catálogo de métodos falla, el filtro sólo ofrece «Todos» y la bandeja sigue", async () => {
    cleanups.push(
      registerEndpoint("/api/v1/payments", {
        method: "GET",
        handler: () => ({ ...pageOf([payment()]), totals: { count: 1, amount: "25.00" } }),
      }),
      registerEndpoint("/api/v1/payment-methods", failWith(500, "no")),
    );

    await renderPayments();
    await waitFor(() => rowOf("Bodega Santa Rosa"));
    await userEvent.setup().click(screen.getByLabelText("Método de pago"));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual(["Todos"]);
  });

  describe("confirmar", () => {
    it("confirma, avisa la deuda resultante y recarga la bandeja", async () => {
      const seen = stubPayments([[payment()], []]);
      stubWrite(cleanups, "/api/v1/payments/pay-1/confirm", "POST", () => ({
        payment: payment({ status: "CONFIRMED" }),
        debtBalance: "75.00",
      }));

      await renderPayments();
      await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmar" }));

      expect(
        await screen.findByText("Pago de Bodega Santa Rosa confirmado. Deuda actual: S/ 75.00."),
      ).toBeTruthy();
      await waitFor(() => expect(seen).toHaveLength(2));
    });

    it("si el cliente queda con plata a favor, el aviso lo dice así y no con signo", async () => {
      stubPayments([[payment()], []]);
      stubWrite(cleanups, "/api/v1/payments/pay-1/confirm", "POST", () => ({
        payment: payment({ status: "CONFIRMED" }),
        debtBalance: "-10.00",
      }));

      await renderPayments();
      await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmar" }));

      expect(
        await screen.findByText(
          "Pago de Bodega Santa Rosa confirmado. Deuda actual: A favor S/ 10.00.",
        ),
      ).toBeTruthy();
    });

    it("un 409 dice que alguien lo resolvió primero y recarga; un 404, que ya no existe", async () => {
      const seen = stubPayments([[payment()]]);
      let attempt = 0;
      stubWrite(cleanups, "/api/v1/payments/pay-1/confirm", "POST", (event) => {
        attempt++;
        return failWith(attempt === 1 ? 409 : 404, "x")(event);
      });

      await renderPayments();
      await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmar" }));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Este pago ya no está pendiente: alguien más lo confirmó o rechazó primero.",
      );
      await waitFor(() => expect(seen).toHaveLength(2));

      await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmar" }));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain("Este pago ya no existe."),
      );
    });

    it("un 403 explica el permiso; un error genérico muestra el mensaje y NO recarga", async () => {
      const seen = stubPayments([[payment()]]);
      let attempt = 0;
      stubWrite(cleanups, "/api/v1/payments/pay-1/confirm", "POST", (event) => {
        attempt++;
        return attempt === 1
          ? failWith(403, "Forbidden resource")(event)
          : failWith(500, "Base caída")(event);
      });
      const user = userEvent.setup();

      await renderPayments();
      await user.click(await screen.findByRole("button", { name: "Confirmar" }));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "No tienes permiso de administrador para confirmar pagos.",
      );
      await user.click(screen.getByRole("button", { name: "Confirmar" }));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Base caída"));
      expect(seen).toHaveLength(1);
    });
  });

  describe("rechazar", () => {
    async function openReject() {
      await userEvent.setup().click(await screen.findByRole("button", { name: "Rechazar" }));
      return screen.findByRole("form", { name: "Rechazar pago de Bodega Santa Rosa" });
    }

    it("pide motivo: en blanco no llama; con motivo lo manda, avisa la deuda y recarga", async () => {
      const seen = stubPayments([[payment()], []]);
      const bodies = stubWrite(cleanups, "/api/v1/payments/pay-1/reject", "POST", () => ({
        payment: payment({ status: "REJECTED" }),
        debtBalance: "100.00",
      }));
      const user = userEvent.setup();

      await renderPayments();
      const form = await openReject();
      await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Escribe el motivo del rechazo",
      );
      expect(bodies).toHaveLength(0);

      await user.type(screen.getByLabelText("Motivo del rechazo"), "  El Yape no llegó ");
      await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));

      expect(
        await screen.findByText("Pago de Bodega Santa Rosa rechazado. Deuda actual: S/ 100.00."),
      ).toBeTruthy();
      expect(bodies).toEqual([{ reason: "El Yape no llegó" }]);
      await waitFor(() => expect(seen).toHaveLength(2));
    });

    it("rechazar a quien ya tenía plata a favor lo avisa como «A favor», no con signo", async () => {
      stubPayments([[payment()], []]);
      stubWrite(cleanups, "/api/v1/payments/pay-1/reject", "POST", () => ({
        payment: payment({ status: "REJECTED" }),
        debtBalance: "-5.00",
      }));
      const user = userEvent.setup();

      await renderPayments();
      const form = await openReject();
      await user.type(screen.getByLabelText("Motivo del rechazo"), "No llegó");
      await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));

      expect(
        await screen.findByText(
          "Pago de Bodega Santa Rosa rechazado. Deuda actual: A favor S/ 5.00.",
        ),
      ).toBeTruthy();
    });

    it("«Cancelar» cierra el formulario sin llamar a la API", async () => {
      stubPayments([[payment()]]);
      const bodies = stubWrite(cleanups, "/api/v1/payments/pay-1/reject", "POST");

      await renderPayments();
      const form = await openReject();
      await userEvent.setup().click(within(form).getByRole("button", { name: "Cancelar" }));

      expect(screen.queryByRole("form", { name: /Rechazar pago/ })).toBeNull();
      expect(bodies).toHaveLength(0);
    });

    it("un 409 cierra el formulario, avisa y recarga", async () => {
      const seen = stubPayments([[payment()]]);
      stubWrite(cleanups, "/api/v1/payments/pay-1/reject", "POST", failWith(409, "x"));
      const user = userEvent.setup();

      await renderPayments();
      await openReject();
      await user.type(screen.getByLabelText("Motivo del rechazo"), "No llegó");
      await user.click(screen.getByRole("button", { name: "Confirmar rechazo" }));

      expect((await screen.findByRole("alert")).textContent).toContain("ya no está pendiente");
      expect(screen.queryByRole("form", { name: /Rechazar pago/ })).toBeNull();
      await waitFor(() => expect(seen).toHaveLength(2));
    });

    it("un 403 o un error genérico se muestran dentro del formulario, que sigue abierto", async () => {
      stubPayments([[payment()]]);
      let attempt = 0;
      stubWrite(cleanups, "/api/v1/payments/pay-1/reject", "POST", (event) => {
        attempt++;
        return attempt === 1
          ? failWith(403, "Forbidden resource")(event)
          : failWith(500, "Base caída")(event);
      });
      const user = userEvent.setup();

      await renderPayments();
      const form = await openReject();
      await user.type(screen.getByLabelText("Motivo del rechazo"), "No llegó");
      await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));
      expect((await within(form).findByRole("alert")).textContent).toContain(
        "No tienes permiso de administrador para rechazar pagos.",
      );
      await user.click(within(form).getByRole("button", { name: "Confirmar rechazo" }));
      await waitFor(() =>
        expect(within(form).getByRole("alert").textContent).toContain("Base caída"),
      );
      expect(screen.getByRole("form", { name: "Rechazar pago de Bodega Santa Rosa" })).toBeTruthy();
    });
  });

  it("distingue el vacío por filtro del vacío del trabajo del día; un error se reintenta", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/payments", {
        method: "GET",
        handler: (event: H3Event) => {
          attempt++;
          if (attempt === 1) return failWith(500, "Base de datos no disponible")(event);
          return { ...pageOf([]), totals: { count: 0, amount: "0.00" } };
        },
      }),
      registerEndpoint("/api/v1/payment-methods", () => []),
    );

    await renderPayments();
    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("No hay pagos por confirmar")).toBeTruthy();
    await choose("Estado", "Todos");
    expect(await screen.findByText("Ningún pago coincide con el filtro")).toBeTruthy();
  });
});
