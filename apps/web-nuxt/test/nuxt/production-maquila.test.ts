import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type {
  MaquilaCustomerSummary,
  MaquilaMovementItem,
  PaginatedMaquilaMovements,
  UserRole,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ProductionMaquilaSection from "~/components/ProductionMaquilaSection.vue";
import { stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

const CUST_WITH_EMPTIES: MaquilaCustomerSummary = {
  customerId: "cust-1",
  customerName: "Distribuidora Sol",
  emptyAtPlantTotal: 8,
  fullToReturnTotal: 0,
  balances: [
    {
      customerId: "cust-1",
      containerTypeId: "ct-1",
      containerTypeName: "Con caño",
      emptyAtPlant: 8,
      fullToReturn: 0,
      unitPrice: "3.50",
      productId: "prod-1",
    },
  ],
};

const FILLING_MOVEMENT: MaquilaMovementItem = {
  id: "mov-fill-1",
  customerId: "cust-1",
  customerName: "Distribuidora Sol",
  containerTypeId: "ct-1",
  containerTypeName: "Con caño",
  type: "FILLED",
  quantity: 4,
  saleId: null,
  saleTotal: null,
  reversesMovementId: null,
  reason: null,
  recordedById: "op-1",
  recordedByName: "Operador Carlos",
  occurredAt: "2026-10-12T11:00:00.000Z",
  createdAt: "2026-10-12T11:00:00.000Z",
};

function stubProductionMaquila(
  customers: MaquilaCustomerSummary[] = [CUST_WITH_EMPTIES],
  fillings: MaquilaMovementItem[] = [FILLING_MOVEMENT],
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
          data: fillings,
          total: fillings.length,
          page: 1,
          limit: 20,
          totalPages: 1,
        }) satisfies PaginatedMaquilaMovements,
    }),
  );
}

async function renderSection(roles: UserRole[] = ["PLANT_OPERATOR"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(ProductionMaquilaSection);
  await screen.findByRole("heading", { name: "Maquila", level: 2 });
}

describe("ProductionMaquilaSection", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra vacíos de clientes en espera y lista de llenados", async () => {
    stubProductionMaquila();

    await renderSection(["PLANT_OPERATOR"]);

    expect((await screen.findAllByText("Distribuidora Sol")).length).toBeGreaterThan(0);
    expect(screen.getByText("8 vacíos")).toBeTruthy();
    expect(screen.getByText("Operador Carlos")).toBeTruthy();
  });

  it("permite registrar un llenado de maquila", async () => {
    stubProductionMaquila();
    const fillWrite = stubWrite(cleanups, "/api/v1/maquila/fillings", "POST", () => ({
      id: "mov-fill-2",
      type: "FILLED",
    }));

    await renderSection(["PLANT_OPERATOR"]);

    const fillBtn = await screen.findByRole("button", { name: "Llenar maquila" });
    await userEvent.click(fillBtn);

    const input = await screen.findByLabelText("Cantidad a llenar");
    await userEvent.clear(input);
    await userEvent.type(input, "6");

    const submitBtn = screen.getByRole("button", { name: "Registrar llenado" });
    await userEvent.click(submitBtn);

    expect(fillWrite).toEqual([
      {
        customerId: "cust-1",
        containerTypeId: "ct-1",
        quantity: 6,
      },
    ]);
  });

  it("permite al supervisor anular un llenado", async () => {
    stubProductionMaquila();
    const voidWrite = stubWrite(
      cleanups,
      "/api/v1/maquila/movements/mov-fill-1/void",
      "POST",
      () => ({
        id: "mov-void-1",
        type: "FILLED_VOID",
      }),
    );

    await renderSection(["PLANT_SUPERVISOR"]);

    const voidBtn = await screen.findByRole("button", { name: "Anular" });
    await userEvent.click(voidBtn);

    const input = await screen.findByPlaceholderText("Ej. Error de tipeo en la cantidad");
    await userEvent.type(input, "Cantidad errónea");

    const submitBtn = screen.getByRole("button", { name: "Anular llenado" });
    await userEvent.click(submitBtn);

    expect(voidWrite).toEqual([{ reason: "Cantidad errónea" }]);
  });
});
