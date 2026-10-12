import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type {
  MaquilaCustomerSummary,
  MaquilaMovementItem,
  MaquilaReconciliationResult,
  PaginatedMaquilaMovements,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

const CUST_SUMMARY: MaquilaCustomerSummary = {
  customerId: "cust-1",
  customerName: "Empresa Los Sauces",
  emptyAtPlantTotal: 5,
  fullToReturnTotal: 3,
  balances: [
    {
      customerId: "cust-1",
      containerTypeId: "ct-1",
      containerTypeName: "Con caño",
      emptyAtPlant: 5,
      fullToReturn: 3,
      unitPrice: "3.50",
      productId: "prod-1",
    },
  ],
};

const MOVEMENT: MaquilaMovementItem = {
  id: "mov-1",
  customerId: "cust-1",
  customerName: "Empresa Los Sauces",
  containerTypeId: "ct-1",
  containerTypeName: "Con caño",
  type: "RECEIVED",
  quantity: 5,
  saleId: null,
  saleTotal: null,
  reversesMovementId: null,
  reason: null,
  recordedById: "user-1",
  recordedByName: "Admin User",
  occurredAt: "2026-10-12T10:00:00.000Z",
  createdAt: "2026-10-12T10:00:00.000Z",
};

function stubMaquila(
  customers: MaquilaCustomerSummary[] = [CUST_SUMMARY],
  movements: MaquilaMovementItem[] = [MOVEMENT],
) {
  cleanups.push(
    registerEndpoint("/api/v1/maquila/customers", {
      method: "GET",
      handler: () => customers,
    }),
  );
  cleanups.push(
    registerEndpoint("/api/v1/maquila/movements", {
      method: "GET",
      handler: () =>
        ({
          data: movements,
          total: movements.length,
          page: 1,
          limit: 50,
          totalPages: 1,
        }) satisfies PaginatedMaquilaMovements,
    }),
  );
}

async function renderPage(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/maquila" });
  await screen.findByRole("heading", { name: "Maquila", level: 1 });
}

describe("Maquila page", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra clientes con bidones en planta y desglose por tipo", async () => {
    stubMaquila();

    await renderPage();

    expect((await screen.findAllByText("Empresa Los Sauces")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Vacíos en planta")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Llenos por devolver")).length).toBeGreaterThan(0);
    expect(screen.getByText("Con caño: 5 vacíos, 3 llenos")).toBeTruthy();
  });

  it("permite al administrador correr el cuadre de maquila y muestra cuadre exacto", async () => {
    stubMaquila();
    const reconciliationResult: MaquilaReconciliationResult = {
      isBalanced: true,
      discrepancies: [],
    };
    cleanups.push(
      registerEndpoint("/api/v1/maquila/reconciliation", {
        method: "GET",
        handler: () => reconciliationResult,
      }),
    );

    await renderPage(["ADMIN"]);

    const reconcileBtn = await screen.findByRole("button", { name: "Cuadre de maquila" });
    await userEvent.click(reconcileBtn);

    expect(await screen.findByText("Cuadre exacto")).toBeTruthy();
    expect(
      screen.getByText(
        "Los saldos materializados coinciden exactamente con la reconstrucción del libro inmutable de maquila.",
      ),
    ).toBeTruthy();
  });

  it("permite al administrador anular un movimiento de maquila", async () => {
    stubMaquila();
    const voidWrite = stubWrite(cleanups, "/api/v1/maquila/movements/mov-1/void", "POST", () => ({
      id: "mov-void-1",
      type: "RECEIVED_VOID",
    }));

    await renderPage(["ADMIN"]);

    const voidBtn = await screen.findByRole("button", { name: "Anular" });
    await userEvent.click(voidBtn);

    const input = await screen.findByPlaceholderText("Ej. Cantidad anotada por error");
    await userEvent.type(input, "Error de prueba");

    const confirmBtn = screen.getByRole("button", { name: "Anular movimiento" });
    await userEvent.click(confirmBtn);

    expect(voidWrite).toEqual([{ reason: "Error de prueba" }]);
  });
});
