import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { AccessoryMovementItem, AccessorySummary } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

const DISPENSER: AccessorySummary = {
  id: "acc-1",
  name: "Dispensador de mesa",
  listPrice: "35.00",
  active: true,
  stock: 10,
  totalBorrowed: 4,
};

function stubList(items: AccessorySummary[]) {
  cleanups.push(
    registerEndpoint("/api/v1/accessories", {
      method: "GET",
      handler: () => items,
    }),
  );
}

async function renderPage(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/accessories" });
  await screen.findByRole("heading", { name: "Accesorios", level: 1 });
}

async function rowOf(name: string): Promise<HTMLElement> {
  return (await screen.findByText(name)).closest("tr") as HTMLElement;
}

describe("Accesorios", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista cada accesorio con stock en planta, prestados y total", async () => {
    stubList([DISPENSER]);

    await renderPage();

    const row = await rowOf("Dispensador de mesa");
    expect(within(row).getByText("S/ 35.00")).toBeTruthy();
    expect(within(row).getByText("10")).toBeTruthy();
    expect(within(row).getByText("4")).toBeTruthy();
    expect(within(row).getByText("14")).toBeTruthy();
  });

  it("el administrador registra ingreso a planta", async () => {
    let currentList = [DISPENSER];
    cleanups.push(
      registerEndpoint("/api/v1/accessories", {
        method: "GET",
        handler: () => currentList,
      }),
    );
    const postBodies = stubWrite(cleanups, "/api/v1/accessories/acc-1/entries", "POST", (body) => {
      currentList = [{ ...DISPENSER, stock: 15 }];
      return { id: "mov-1", ...body };
    });
    const user = userEvent.setup();

    await renderPage(["ADMIN"]);

    const row = await rowOf("Dispensador de mesa");
    await user.click(within(row).getByRole("button", { name: "Ingreso" }));

    const input = screen.getByLabelText(/Cantidad que entra a planta/);
    await user.clear(input);
    await user.type(input, "5");
    await user.click(screen.getByRole("button", { name: "Registrar ingreso" }));

    expect(postBodies).toEqual([{ quantity: 5 }]);
    const updatedRow = await rowOf("Dispensador de mesa");
    expect(within(updatedRow).getByText("15")).toBeTruthy();
  });

  it("el administrador registra baja en planta con motivo", async () => {
    let currentList = [DISPENSER];
    cleanups.push(
      registerEndpoint("/api/v1/accessories", {
        method: "GET",
        handler: () => currentList,
      }),
    );
    const postBodies = stubWrite(
      cleanups,
      "/api/v1/accessories/acc-1/write-offs",
      "POST",
      (body) => {
        currentList = [{ ...DISPENSER, stock: 8 }];
        return { id: "mov-2", ...body };
      },
    );
    const user = userEvent.setup();

    await renderPage(["ADMIN"]);

    const row = await rowOf("Dispensador de mesa");
    await user.click(within(row).getByRole("button", { name: "Baja" }));

    const qtyInput = screen.getByLabelText(/Cantidad que se da de baja/);
    await user.clear(qtyInput);
    await user.type(qtyInput, "2");

    const reasonInput = screen.getByLabelText(/Motivo de la baja/);
    await user.type(reasonInput, "Roto en galpón");

    await user.click(screen.getByRole("button", { name: "Registrar baja" }));

    expect(postBodies).toEqual([{ quantity: 2, reason: "Roto en galpón" }]);
    const updatedRow = await rowOf("Dispensador de mesa");
    expect(within(updatedRow).getByText("8")).toBeTruthy();
  });

  it("el conteo con diferencia advierte y requiere motivo", async () => {
    let currentList = [DISPENSER];
    cleanups.push(
      registerEndpoint("/api/v1/accessories", {
        method: "GET",
        handler: () => currentList,
      }),
    );
    const postBodies = stubWrite(cleanups, "/api/v1/accessories/acc-1/count", "POST", (body) => {
      currentList = [{ ...DISPENSER, stock: 8 }];
      return { id: "cnt-1", ...body };
    });
    const user = userEvent.setup();

    await renderPage(["ADMIN"]);

    const row = await rowOf("Dispensador de mesa");
    await user.click(within(row).getByRole("button", { name: "Contar" }));

    const countInput = screen.getByLabelText(/Cantidad contada físicamente/);
    await user.clear(countInput);
    await user.type(countInput, "8");

    expect(await screen.findByText(/Diferencia de conteo/)).toBeTruthy();

    const reasonInput = screen.getByLabelText(/Motivo del ajuste/);
    await user.type(reasonInput, "Faltante en inventario");

    await user.click(screen.getByRole("button", { name: "Confirmar diferencia" }));

    expect(postBodies).toEqual([{ countedQuantity: 8, reason: "Faltante en inventario" }]);
  });

  it("permite ver movimientos del accesorio", async () => {
    stubList([DISPENSER]);
    const movement: AccessoryMovementItem = {
      id: "mov-entry-1",
      productId: "acc-1",
      productName: "Dispensador de mesa",
      type: "ENTRY",
      quantity: 10,
      locationId: null,
      locationName: null,
      customerName: null,
      saleId: null,
      reason: "Compra inicial",
      reversesMovementId: null,
      recordedById: "user-1",
      recordedByName: "Admin",
      occurredAt: "2026-10-12T10:00:00.000Z",
      createdAt: "2026-10-12T10:00:00.000Z",
    };
    cleanups.push(
      registerEndpoint("/api/v1/accessories/acc-1/movements", {
        method: "GET",
        handler: () => ({
          data: [movement],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      }),
    );
    const user = userEvent.setup();

    await renderPage();

    const row = await rowOf("Dispensador de mesa");
    await user.click(within(row).getByRole("button", { name: "Movimientos" }));

    expect(await screen.findByText("Ingreso a planta")).toBeTruthy();
    expect(screen.getByText("+10")).toBeTruthy();
    expect(screen.getByText("Compra inicial")).toBeTruthy();
  });

  it("el vendedor ve movimientos pero no botones de ingreso, baja, contar ni cuadre", async () => {
    stubList([DISPENSER]);

    await renderPage(["SELLER"]);

    const row = await rowOf("Dispensador de mesa");
    expect(within(row).getByRole("button", { name: "Movimientos" })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Ingreso" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Baja" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Contar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cuadre de accesorios" })).toBeNull();
  });

  it("el administrador abre el cuadre de accesorios y ve cuando coincide", async () => {
    stubList([DISPENSER]);
    cleanups.push(
      registerEndpoint("/api/v1/accessories/reconciliation", {
        method: "GET",
        handler: () => ({
          stockDiscrepancies: [],
          customerBalanceDiscrepancies: [],
          isBalanced: true,
        }),
      }),
    );
    const user = userEvent.setup();

    await renderPage(["ADMIN"]);

    await user.click(screen.getByRole("button", { name: "Cuadre de accesorios" }));

    expect(await screen.findByText(/coinciden exactamente/)).toBeTruthy();
  });

  it("el administrador puede anular un cobro desde los movimientos", async () => {
    stubList([DISPENSER]);
    const chargeMovement: AccessoryMovementItem = {
      id: "mov-charge-1",
      productId: "acc-1",
      productName: "Dispensador de mesa",
      type: "LOAN_CHARGE",
      quantity: -1,
      locationId: "loc-1",
      locationName: "Local Principal",
      customerName: "Bodega Don Pepe",
      saleId: "sale-1",
      reason: "No lo devolvió",
      reversesMovementId: null,
      recordedById: "user-1",
      recordedByName: "Admin",
      occurredAt: "2026-10-12T10:00:00.000Z",
      createdAt: "2026-10-12T10:00:00.000Z",
    };
    cleanups.push(
      registerEndpoint("/api/v1/accessories/acc-1/movements", {
        method: "GET",
        handler: () => ({
          data: [chargeMovement],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      }),
    );
    const postBodies = stubWrite(
      cleanups,
      "/api/v1/accessories/movements/mov-charge-1/void",
      "POST",
      (body) => ({ id: "mov-void-1", ...body }),
    );
    const user = userEvent.setup();

    await renderPage(["ADMIN"]);

    const row = await rowOf("Dispensador de mesa");
    await user.click(within(row).getByRole("button", { name: "Movimientos" }));

    const voidButton = await screen.findByRole("button", { name: "Anular cobro" });
    await user.click(voidButton);

    const reasonInput = screen.getByLabelText(/Motivo de la anulación/);
    await user.type(reasonInput, "Cliente trajo el accesorio");

    await user.click(screen.getByRole("button", { name: "Anular cobro", hidden: false }));

    expect(postBodies).toEqual([{ reason: "Cliente trajo el accesorio" }]);
  });

  it("valida campos en ingreso, baja y conteo", async () => {
    stubList([DISPENSER]);
    const user = userEvent.setup();

    await renderPage(["ADMIN"]);
    const row = await rowOf("Dispensador de mesa");

    // Ingreso
    await user.click(within(row).getByRole("button", { name: "Ingreso" }));
    await user.click(screen.getByRole("button", { name: "Registrar ingreso" }));
    expect(
      await screen.findByText("La cantidad debe ser un número entero mayor que 0"),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    // Baja
    await user.click(within(row).getByRole("button", { name: "Baja" }));
    await user.click(screen.getByRole("button", { name: "Registrar baja" }));
    expect(
      await screen.findByText("La cantidad debe ser un número entero mayor que 0"),
    ).toBeTruthy();
    const qtyInput = screen.getByLabelText(/Cantidad que se da de baja/);
    await user.type(qtyInput, "2");
    await user.click(screen.getByRole("button", { name: "Registrar baja" }));
    expect(await screen.findByText("Debes indicar el motivo de la baja")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    // Conteo
    await user.click(within(row).getByRole("button", { name: "Contar" }));
    const countInput = screen.getByLabelText(/Cantidad contada físicamente/);
    await user.type(countInput, "8"); // stock is 10
    await user.click(screen.getByRole("button", { name: "Confirmar diferencia" }));
    expect(await screen.findByText("Debes indicar el motivo de la diferencia")).toBeTruthy();
  });
});
