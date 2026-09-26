import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { CustomerDebtsReport, LoanedContainersReport, ProductionReport } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "~/app.vue";
import { failWith } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const BIDON = { id: "ct-bidon", name: "Bidón 20L" };
const CANO = { id: "ct-cano", name: "Con caño" };

async function renderReport(
  path: string,
  heading: string,
  roles: ("ADMIN" | "SELLER")[] = ["ADMIN"],
) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: path });
  await screen.findByRole("heading", { name: heading, level: 1 });
}

async function rowOf(text: string): Promise<HTMLElement> {
  return (await screen.findByText(text)).closest("tr") as HTMLElement;
}

describe("Reportes", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  describe("Deuda por cliente (HU-19)", () => {
    it("muestra la deuda, desde cuándo y el total, con el dinero y la fecha como texto", async () => {
      const body: CustomerDebtsReport = {
        rows: [
          {
            customer: { id: "c-1", name: "Bodega Central" },
            zone: { id: "z-1", name: "Centro" },
            debt: "50.50",
            oldestChargeDate: "2026-09-03",
            openedByOpeningBalance: false,
          },
          {
            customer: { id: "c-2", name: "Farmacia San Judas" },
            zone: null,
            debt: "12.00",
            oldestChargeDate: "2026-09-07",
            openedByOpeningBalance: false,
          },
        ],
        total: "62.50",
      };
      cleanups.push(registerEndpoint("/api/v1/reports/debt", () => body));

      await renderReport("/reports/debt", "Deuda por cliente");

      const central = await rowOf("Bodega Central");
      expect(within(central).getByText("Centro")).toBeTruthy();
      expect(within(central).getByText("03/09/2026")).toBeTruthy();
      expect(within(central).getByText("S/ 50.50")).toBeTruthy();
      expect(within(await rowOf("Farmacia San Judas")).getByText("Sin zona")).toBeTruthy();
      expect(within(await rowOf("Total por cobrar")).getByText("S/ 62.50")).toBeTruthy();
    });

    it("cuando la deuda la abrió el saldo inicial, «Debe desde» dice «Saldo inicial» y la fecha no pasa por venta", async () => {
      const body: CustomerDebtsReport = {
        rows: [
          {
            customer: { id: "c-1", name: "Bodega Central" },
            zone: null,
            debt: "70.00",
            oldestChargeDate: "2026-08-31",
            openedByOpeningBalance: true,
          },
          {
            customer: { id: "c-2", name: "Farmacia San Judas" },
            zone: null,
            debt: "9.00",
            oldestChargeDate: "2026-08-31",
            openedByOpeningBalance: false,
          },
        ],
        total: "79.00",
      };
      cleanups.push(registerEndpoint("/api/v1/reports/debt", () => body));

      await renderReport("/reports/debt", "Deuda por cliente");

      const central = await rowOf("Bodega Central");
      expect(within(central).getByText("Saldo inicial")).toBeTruthy();
      expect(within(central).getByText("al 31/08/2026")).toBeTruthy();
      expect(within(central).queryByText("31/08/2026")).toBeNull();
      const farmacia = await rowOf("Farmacia San Judas");
      expect(within(farmacia).getByText("31/08/2026")).toBeTruthy();
      expect(within(farmacia).queryByText("Saldo inicial")).toBeNull();
    });

    it("sin deudores lo dice", async () => {
      cleanups.push(registerEndpoint("/api/v1/reports/debt", () => ({ rows: [], total: "0.00" })));

      await renderReport("/reports/debt", "Deuda por cliente");

      expect(await screen.findByText("Nadie debe")).toBeTruthy();
    });

    it("un error se muestra y se reintenta", async () => {
      let calls = 0;
      cleanups.push(
        registerEndpoint("/api/v1/reports/debt", (event: H3Event) =>
          calls++ === 0
            ? failWith(500, "Base de datos no disponible")(event)
            : { rows: [], total: "0.00" },
        ),
      );

      await renderReport("/reports/debt", "Deuda por cliente");
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Base de datos no disponible",
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

      expect(await screen.findByText("Nadie debe")).toBeTruthy();
    });

    it("quien no es administrador ve el aviso y no se pide nada", async () => {
      let calls = 0;
      cleanups.push(
        registerEndpoint("/api/v1/reports/debt", () => {
          calls++;
          return { rows: [], total: "0.00" };
        }),
      );

      await renderReport("/reports/debt", "Deuda por cliente", ["SELLER"]);

      expect(await screen.findByText("Este reporte es solo para administradores")).toBeTruthy();
      expect(calls).toBe(0);
    });
  });

  describe("Envases prestados (HU-20)", () => {
    it("muestra el saldo por cliente y tipo, el total, y un negativo con su explicación", async () => {
      const body: LoanedContainersReport = {
        rows: [
          { customer: { id: "c-1", name: "Bodega Central" }, containerType: BIDON, quantity: 5 },
          {
            customer: { id: "c-2", name: "Farmacia San Judas" },
            containerType: CANO,
            quantity: -2,
          },
        ],
        byType: [
          { containerType: BIDON, quantity: 5 },
          { containerType: CANO, quantity: -2 },
        ],
        total: 3,
      };
      cleanups.push(registerEndpoint("/api/v1/reports/loaned-containers", () => body));

      await renderReport("/reports/loaned-containers", "Envases prestados");

      expect(within(await rowOf("Bodega Central")).getByText("5")).toBeTruthy();
      const farmacia = await rowOf("Farmacia San Judas");
      expect(within(farmacia).getByText("devolvió más de lo registrado")).toBeTruthy();
      expect(screen.getByText("Total prestado").nextElementSibling?.textContent).toBe("3");
    });

    // Los envases también salen de un cliente por un ajuste de conteo: vacío
    // no quiere decir que «volvieron a la planta».
    it("sin envases en poder de clientes lo dice, sin suponer que volvieron a la planta", async () => {
      const body: LoanedContainersReport = { rows: [], byType: [], total: 0 };
      cleanups.push(registerEndpoint("/api/v1/reports/loaned-containers", () => body));

      await renderReport("/reports/loaned-containers", "Envases prestados");

      expect(await screen.findByText("Ningún cliente tiene envases prestados.")).toBeTruthy();
      expect(screen.queryByText(/volvieron a la planta/)).toBeNull();
    });
  });

  describe("Producción por período (HU-21)", () => {
    it("pide el mes en curso, muestra lotes y totales, y vuelve a pedir con otras fechas", async () => {
      const queries: Array<Record<string, unknown>> = [];
      const body: ProductionReport = {
        batches: [
          {
            id: "b-1",
            code: "LOTE-JUL-01",
            date: "2026-07-01",
            items: [
              { containerType: BIDON, producedQty: 10 },
              { containerType: CANO, producedQty: 5 },
            ],
            total: 15,
          },
        ],
        byType: [
          { containerType: BIDON, producedQty: 10 },
          { containerType: CANO, producedQty: 5 },
        ],
        total: 15,
      };
      cleanups.push(
        registerEndpoint("/api/v1/reports/production", (event: H3Event) => {
          queries.push(getQuery(event));
          return body;
        }),
      );

      await renderReport("/reports/production", "Producción por período");

      const lote = await rowOf("LOTE-JUL-01");
      expect(within(lote).getByText("01/07/2026")).toBeTruthy();
      expect(within(lote).getByText("10 × Bidón 20L, 5 × Con caño")).toBeTruthy();
      expect(screen.getByText("Total producido").nextElementSibling?.textContent).toBe("15");
      expect(String(queries[0]?.dateFrom)).toMatch(/^\d{4}-\d{2}-01$/);

      const user = userEvent.setup();
      const from = screen.getByLabelText("Desde");
      await user.clear(from);
      await user.type(from, "2026-07-01");
      await user.click(screen.getByRole("button", { name: "Ver" }));

      await vi.waitFor(() => expect(queries.at(-1)?.dateFrom).toBe("2026-07-01"));
    });

    it("sin lotes en el período lo dice", async () => {
      cleanups.push(
        registerEndpoint("/api/v1/reports/production", () => ({
          batches: [],
          byType: [],
          total: 0,
        })),
      );

      await renderReport("/reports/production", "Producción por período");

      expect(await screen.findByText("No hubo producción en esas fechas")).toBeTruthy();
    });
  });
});
