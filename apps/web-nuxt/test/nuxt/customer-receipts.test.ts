import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, readBody } from "h3";
import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CustomerReceiptsSection from "~/components/CustomerReceiptsSection.vue";
import { pageOf } from "../support/fixtures";
import { resetSession } from "../support/session";

const cleanups: Array<() => void> = [];
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const SALE_ONE = "77777777-7777-4777-8777-777777777777";
const SALE_TWO = "88888888-8888-4888-8888-888888888888";
type Status = "AVAILABLE" | "EXEMPT" | "RECEIPTED";

const availableSales = [
  {
    id: SALE_ONE,
    soldAt: "2026-10-13T16:00:00.000Z",
    total: "70.00",
    location: { id: "loc-1", name: "Local Centro" },
    status: "AVAILABLE",
    receipt: null,
    exemption: null,
  },
  {
    id: SALE_TWO,
    soldAt: "2026-10-14T16:00:00.000Z",
    total: "48.00",
    location: { id: "loc-2", name: "Sucursal Norte" },
    status: "AVAILABLE",
    receipt: null,
    exemption: null,
  },
];

const exemptSale = {
  ...availableSales[0],
  status: "EXEMPT",
  exemption: {
    id: "99999999-9999-4999-8999-999999999999",
    reason: "El cliente no solicita comprobante",
  },
};

function stubSales(responses: Partial<Record<Status, unknown[]>>): Array<Record<string, string>> {
  const seen: Array<Record<string, string>> = [];
  cleanups.push(
    registerEndpoint("/api/v1/receipts/sales", {
      method: "GET",
      handler: (event: H3Event) => {
        const query = getQuery(event) as Record<string, string>;
        seen.push(query);
        return pageOf(responses[query.status as Status] ?? []);
      },
    }),
  );
  return seen;
}

async function renderSection(isAdmin = false): Promise<void> {
  await renderSuspended(CustomerReceiptsSection, {
    props: { customerId: CUSTOMER_ID, isAdmin },
  });
  await screen.findByRole("heading", { name: "Comprobantes de ventas" });
}

async function chooseStatus(name: string): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name }));
}

describe("Comprobantes en la ficha del cliente", () => {
  beforeEach(() => {
    resetSession();
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra las ventas sin comprobante y conserva el cliente al iniciar el registro", async () => {
    const seen = stubSales({ AVAILABLE: availableSales });

    await renderSection();

    const table = await screen.findByRole("table", { name: "Ventas sin comprobante" });
    expect(within(table).getByText("Local Centro")).toBeTruthy();
    expect(within(table).getByText("S/ 70.00")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Registrar comprobante" })).toHaveProperty(
      "href",
      expect.stringContaining(`/receipts/new?customerId=${CUSTOMER_ID}`),
    );
    expect(seen[0]).toEqual({
      customerId: CUSTOMER_ID,
      status: "AVAILABLE",
      page: "1",
      limit: "100",
    });
  });

  it("marca varias ventas como No lleva comprobante con un motivo", async () => {
    let availableReads = 0;
    cleanups.push(
      registerEndpoint("/api/v1/receipts/sales", {
        method: "GET",
        handler: (event: H3Event) => {
          const status = getQuery(event).status;
          if (status === "AVAILABLE") availableReads++;
          return pageOf(status === "AVAILABLE" && availableReads === 1 ? availableSales : []);
        },
      }),
    );
    const bodies: unknown[] = [];
    cleanups.push(
      registerEndpoint("/api/v1/receipts/exemptions", {
        method: "POST",
        handler: async (event: H3Event) => {
          bodies.push(await readBody(event));
          return { created: 2 };
        },
      }),
    );

    await renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Local Centro/ }));
    await user.click(screen.getByRole("checkbox", { name: /Sucursal Norte/ }));
    await user.click(screen.getByRole("button", { name: "No lleva comprobante" }));
    await user.type(
      screen.getByLabelText("Motivo para marcar las ventas"),
      "El cliente no solicita comprobante",
    );
    await user.click(screen.getByRole("button", { name: "Guardar marca" }));

    expect(bodies).toEqual([
      {
        customerId: CUSTOMER_ID,
        saleIds: [SALE_ONE, SALE_TWO],
        reason: "El cliente no solicita comprobante",
      },
    ]);
    expect(await screen.findByText("Se marcaron 2 ventas como No lleva comprobante.")).toBeTruthy();
    expect(await screen.findByText("No hay ventas sin comprobante")).toBeTruthy();
  });

  it("el filtro No llevan comprobante muestra el motivo y no ofrece liberar al vendedor", async () => {
    stubSales({ AVAILABLE: [], EXEMPT: [exemptSale] });

    await renderSection(false);
    await chooseStatus("No llevan comprobante");

    const table = await screen.findByRole("table", { name: "Ventas que no llevan comprobante" });
    expect(within(table).getByText("El cliente no solicita comprobante")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Liberar marca" })).toBeNull();
  });

  it("el administrador libera una marca con motivo y refresca el filtro", async () => {
    let exemptReads = 0;
    cleanups.push(
      registerEndpoint("/api/v1/receipts/sales", {
        method: "GET",
        handler: (event: H3Event) => {
          if (getQuery(event).status === "EXEMPT") exemptReads++;
          return pageOf(exemptReads === 1 ? [exemptSale] : []);
        },
      }),
    );
    const bodies: unknown[] = [];
    cleanups.push(
      registerEndpoint(`/api/v1/receipts/exemptions/${exemptSale.exemption.id}/release`, {
        method: "PATCH",
        handler: async (event: H3Event) => {
          bodies.push(await readBody(event));
          return { id: exemptSale.exemption.id, saleId: SALE_ONE };
        },
      }),
    );

    await renderSection(true);
    await chooseStatus("No llevan comprobante");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Liberar marca" }));
    await userEvent
      .setup()
      .type(screen.getByLabelText("Motivo para liberar la marca"), "Ahora pidió una boleta");
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirmar liberación" }));

    expect(bodies).toEqual([{ reason: "Ahora pidió una boleta" }]);
    await waitFor(() => expect(screen.getByText("No hay ventas marcadas")).toBeTruthy());
  });
});
