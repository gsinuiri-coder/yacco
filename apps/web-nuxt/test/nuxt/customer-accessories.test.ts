import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type {
  AccessorySummary,
  CustomerAccessoryBalanceItem,
  CustomerLocation,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CustomerAccessoriesSection from "~/components/CustomerAccessoriesSection.vue";
import { stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

const CUST_ID = "cust-1";
const LOC_ID = "loc-1";

const LOCATION: CustomerLocation = {
  id: LOC_ID,
  name: "Sede Principal",
  address: "Av. Principal 123",
  addressReference: "Frente al parque",
  phone: "987654321",
  contactName: null,
  latitude: null,
  longitude: null,
  isPrimary: true,
  active: true,
};

const ACCESSORY_CATALOG: AccessorySummary[] = [
  {
    id: "acc-1",
    name: "Dispensador de mesa",
    listPrice: "35.00",
    active: true,
    stock: 10,
    totalBorrowed: 2,
  },
];

const BORROWED_ITEM: CustomerAccessoryBalanceItem = {
  locationId: LOC_ID,
  productId: "acc-1",
  productName: "Dispensador de mesa",
  quantity: 2,
  listPrice: "35.00",
  agreedPrice: "30.00",
};

function stubSection(
  locations: CustomerLocation[] = [LOCATION],
  balances: CustomerAccessoryBalanceItem[] = [BORROWED_ITEM],
  catalog: AccessorySummary[] = ACCESSORY_CATALOG,
) {
  cleanups.push(
    registerEndpoint(`/api/v1/customers/${CUST_ID}/locations`, {
      method: "GET",
      handler: () => locations,
    }),
  );
  cleanups.push(
    registerEndpoint("/api/v1/accessories", {
      method: "GET",
      handler: () => catalog,
    }),
  );
  cleanups.push(
    registerEndpoint(`/api/v1/customer-locations/${LOC_ID}/accessories`, {
      method: "GET",
      handler: () => balances,
    }),
  );
}

async function renderSection(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(CustomerAccessoriesSection, {
    props: { customerId: CUST_ID },
  });
  await screen.findByRole("heading", { name: "Accesorios prestados", level: 2 });
}

describe("CustomerAccessoriesSection", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra accesorios prestados en el local con su cantidad y precio", async () => {
    stubSection();

    await renderSection();

    expect(await screen.findByText("Sede Principal")).toBeTruthy();
    const row = (await screen.findByText("Dispensador de mesa")).closest("tr")!;
    expect(within(row).getByText("2")).toBeTruthy();
    expect(within(row).getByText("S/ 30.00")).toBeTruthy();
  });

  it("permite registrar un préstamo de accesorio al local", async () => {
    let currentBalances = [BORROWED_ITEM];
    cleanups.push(
      registerEndpoint(`/api/v1/customers/${CUST_ID}/locations`, {
        method: "GET",
        handler: () => [LOCATION],
      }),
    );
    cleanups.push(
      registerEndpoint("/api/v1/accessories", {
        method: "GET",
        handler: () => ACCESSORY_CATALOG,
      }),
    );
    cleanups.push(
      registerEndpoint(`/api/v1/customer-locations/${LOC_ID}/accessories`, {
        method: "GET",
        handler: () => currentBalances,
      }),
    );
    const postBodies = stubWrite(
      cleanups,
      `/api/v1/customer-locations/${LOC_ID}/accessories/loans`,
      "POST",
      (body) => {
        currentBalances = [{ ...BORROWED_ITEM, quantity: 3 }];
        return { id: "mov-loan-1", ...body };
      },
    );
    const user = userEvent.setup();

    await renderSection(["ADMIN"]);

    await user.click(await screen.findByRole("button", { name: "Prestar accesorio" }));

    const qtyInput = screen.getByLabelText(/Cantidad a prestar/);
    await user.clear(qtyInput);
    await user.type(qtyInput, "1");

    await user.click(screen.getByRole("button", { name: "Registrar préstamo" }));

    expect(postBodies).toEqual([{ productId: "acc-1", quantity: 1 }]);
  });

  it("permite registrar una devolución y valida que no supere lo prestado", async () => {
    let currentBalances = [BORROWED_ITEM];
    cleanups.push(
      registerEndpoint(`/api/v1/customers/${CUST_ID}/locations`, {
        method: "GET",
        handler: () => [LOCATION],
      }),
    );
    cleanups.push(
      registerEndpoint("/api/v1/accessories", {
        method: "GET",
        handler: () => ACCESSORY_CATALOG,
      }),
    );
    cleanups.push(
      registerEndpoint(`/api/v1/customer-locations/${LOC_ID}/accessories`, {
        method: "GET",
        handler: () => currentBalances,
      }),
    );
    const postBodies = stubWrite(
      cleanups,
      `/api/v1/customer-locations/${LOC_ID}/accessories/returns`,
      "POST",
      (body) => {
        currentBalances = [{ ...BORROWED_ITEM, quantity: 1 }];
        return { id: "mov-return-1", ...body };
      },
    );
    const user = userEvent.setup();

    await renderSection(["ADMIN"]);

    await user.click(await screen.findByRole("button", { name: "Devolver" }));

    const qtyInput = screen.getByLabelText(/Cantidad a devolver a planta/);
    await user.clear(qtyInput);
    await user.type(qtyInput, "5");

    await user.click(screen.getByRole("button", { name: "Registrar devolución" }));
    expect(await screen.findByText(/No puedes devolver más de lo prestado/)).toBeTruthy();
    expect(postBodies).toHaveLength(0);

    await user.clear(qtyInput);
    await user.type(qtyInput, "1");
    await user.click(screen.getByRole("button", { name: "Registrar devolución" }));

    expect(postBodies).toEqual([{ productId: "acc-1", quantity: 1 }]);
  });

  it("el administrador puede cobrar un accesorio con motivo", async () => {
    let currentBalances = [BORROWED_ITEM];
    cleanups.push(
      registerEndpoint(`/api/v1/customers/${CUST_ID}/locations`, {
        method: "GET",
        handler: () => [LOCATION],
      }),
    );
    cleanups.push(
      registerEndpoint("/api/v1/accessories", {
        method: "GET",
        handler: () => ACCESSORY_CATALOG,
      }),
    );
    cleanups.push(
      registerEndpoint(`/api/v1/customer-locations/${LOC_ID}/accessories`, {
        method: "GET",
        handler: () => currentBalances,
      }),
    );
    const postBodies = stubWrite(
      cleanups,
      `/api/v1/customer-locations/${LOC_ID}/accessories/charges`,
      "POST",
      (body) => {
        currentBalances = [{ ...BORROWED_ITEM, quantity: 1 }];
        return { id: "mov-charge-1", ...body };
      },
    );
    const user = userEvent.setup();

    await renderSection(["ADMIN"]);

    await user.click(await screen.findByRole("button", { name: "Cobrar" }));

    const reasonInput = screen.getByLabelText(/Motivo del cobro/);
    await user.type(reasonInput, "Cliente extravió surtidor");

    await user.click(screen.getByRole("button", { name: "Cobrar accesorio" }));

    expect(postBodies).toEqual([
      {
        productId: "acc-1",
        quantity: 1,
        reason: "Cliente extravió surtidor",
        unitPrice: "30.00",
      },
    ]);
  });

  it("el vendedor ve prestar y devolver pero no el botón de cobrar", async () => {
    stubSection();

    await renderSection(["SELLER"]);

    expect(await screen.findByRole("button", { name: "Prestar accesorio" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Devolver" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cobrar" })).toBeNull();
  });
});
