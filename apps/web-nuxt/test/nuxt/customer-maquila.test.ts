import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type {
  ContainerType,
  CustomerLocation,
  EffectivePrice,
  MaquilaBalanceItem,
  MaquilaMovementItem,
  PaginatedMaquilaMovements,
  PaymentMethod,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CustomerMaquilaSection from "~/components/CustomerMaquilaSection.vue";
import { stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

const CUST_ID = "cust-1";
const CT_CANO: ContainerType = { id: "ct-1", name: "Con caño", active: true };

const BALANCE_WITH_PRICE: MaquilaBalanceItem = {
  customerId: CUST_ID,
  containerTypeId: "ct-1",
  containerTypeName: "Con caño",
  emptyAtPlant: 10,
  fullToReturn: 6,
  unitPrice: "4.00",
  productId: "prod-1",
};

const BALANCE_NO_PRICE: MaquilaBalanceItem = {
  customerId: CUST_ID,
  containerTypeId: "ct-1",
  containerTypeName: "Con caño",
  emptyAtPlant: 10,
  fullToReturn: 6,
  unitPrice: null,
  productId: null,
};

const CASH: PaymentMethod = {
  id: "pm-1",
  name: "Efectivo",
  active: true,
  requiresConfirmation: false,
};

const LOCATION: CustomerLocation = {
  id: "loc-1",
  name: "Local Central",
  address: "Av. Central 123",
  addressReference: "",
  phone: "999999999",
  contactName: null,
  latitude: null,
  longitude: null,
  isPrimary: true,
  active: true,
};

function stubCustomerMaquila(
  balances: MaquilaBalanceItem[] = [BALANCE_WITH_PRICE],
  movements: MaquilaMovementItem[] = [],
  effectivePrice = balances[0]?.unitPrice ?? null,
) {
  cleanups.push(
    registerEndpoint(`/api/v1/maquila/customers/${CUST_ID}/balances`, {
      method: "GET",
      handler: () => balances,
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
          limit: 20,
          totalPages: 1,
        }) satisfies PaginatedMaquilaMovements,
    }),
  );
  cleanups.push(
    registerEndpoint("/api/v1/container-types", {
      method: "GET",
      handler: () => [CT_CANO],
    }),
  );
  cleanups.push(
    registerEndpoint("/api/v1/payment-methods", {
      method: "GET",
      handler: () => [CASH],
    }),
  );
  cleanups.push(
    registerEndpoint(`/api/v1/customers/${CUST_ID}/locations`, {
      method: "GET",
      handler: () => [LOCATION],
    }),
  );
  cleanups.push(
    registerEndpoint(`/api/v1/customers/${CUST_ID}/effective-prices`, {
      method: "GET",
      handler: () =>
        effectivePrice === null || balances[0]?.productId === null
          ? []
          : ([
              {
                product: { id: balances[0]!.productId!, name: "Servicio de maquila" },
                price: effectivePrice,
                source: "LOCATION",
              },
            ] satisfies EffectivePrice[]),
    }),
  );
}

async function renderSection(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(CustomerMaquilaSection, {
    props: { customerId: CUST_ID },
  });
  await screen.findByRole("heading", { name: "Maquila", level: 2 });
}

describe("CustomerMaquilaSection", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra saldos de vacíos, llenos y precio de maquila", async () => {
    stubCustomerMaquila();

    await renderSection();

    expect(await screen.findByText("Con caño")).toBeTruthy();
    expect(screen.getByText("10 vacíos en planta")).toBeTruthy();
    expect(screen.getByText("6 llenos por devolver")).toBeTruthy();
    expect(screen.getByText("S/ 4.00")).toBeTruthy();
  });

  it("registra recepción de bidones vacíos", async () => {
    stubCustomerMaquila();
    const receiveWrite = stubWrite(cleanups, "/api/v1/maquila/receptions", "POST", () => ({
      id: "mov-rec-1",
      type: "RECEIVED",
    }));

    await renderSection();

    const receiveBtn = await screen.findByRole("button", { name: "Recibir bidones" });
    await userEvent.click(receiveBtn);

    const input = await screen.findByLabelText("Cantidad de vacíos dejados");
    await userEvent.clear(input);
    await userEvent.type(input, "15");

    const submitBtn = screen.getByRole("button", { name: "Registrar recepción" });
    await userEvent.click(submitBtn);

    expect(receiveWrite).toEqual([
      {
        customerId: CUST_ID,
        containerTypeId: "ct-1",
        quantity: 15,
      },
    ]);
  });

  it("registra devolución con cobro al fiado", async () => {
    stubCustomerMaquila();
    const returnWrite = stubWrite(cleanups, "/api/v1/maquila/returns", "POST", () => ({
      id: "mov-ret-1",
      type: "RETURNED",
    }));

    await renderSection();

    const returnBtn = await screen.findByRole("button", { name: "Devolver llenos" });
    await userEvent.click(returnBtn);

    const input = await screen.findByLabelText("Cantidad que se lleva");
    await userEvent.clear(input);
    await userEvent.type(input, "4");

    expect(screen.getByText("S/ 16.00")).toBeTruthy();

    const submitBtn = screen.getByRole("button", { name: "Registrar devolución" });
    await userEvent.click(submitBtn);

    expect(returnWrite).toEqual([
      {
        customerId: CUST_ID,
        containerTypeId: "ct-1",
        quantity: 4,
        locationId: "loc-1",
        payment: undefined,
      },
    ]);
  });

  it("calcula exactamente el cargo con el precio efectivo de la ubicación", async () => {
    const highBalance: MaquilaBalanceItem = {
      ...BALANCE_WITH_PRICE,
      fullToReturn: 9_999_999,
      unitPrice: "4.00",
    };
    stubCustomerMaquila([highBalance], [], "99999999.99");

    await renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Devolver llenos" }));
    const input = await screen.findByLabelText("Cantidad que se lleva");
    await userEvent.clear(input);
    await userEvent.type(input, "9999999");

    expect(await screen.findByText("S/ 999,999,899,900,000.01")).toBeTruthy();
  });

  it("muestra aviso y bloquea devolución cuando falta el precio de maquila", async () => {
    stubCustomerMaquila([BALANCE_NO_PRICE]);

    await renderSection();

    expect(await screen.findByText("Sin precio registrado")).toBeTruthy();

    const returnBtn = screen.getByRole("button", { name: "Devolver llenos" });
    await userEvent.click(returnBtn);

    expect(await screen.findByText("Falta el precio de maquila")).toBeTruthy();
    const submitBtn = screen.getByRole("button", { name: "Registrar devolución" });
    expect(submitBtn.hasAttribute("disabled")).toBe(true);
  });
});
