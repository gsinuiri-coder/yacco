import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { BorrowedAccessoryItem } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

const ITEM_1: BorrowedAccessoryItem = {
  customerId: "cust-1",
  customerName: "Bodega Don Pepe",
  locationId: "loc-1",
  locationName: "Sede Principal",
  productId: "prod-1",
  productName: "Dispensador de mesa",
  quantity: 3,
  lastMovementAt: "2026-10-12T10:00:00.000Z",
};

const ITEM_2: BorrowedAccessoryItem = {
  customerId: "cust-2",
  customerName: "Restaurante El Sol",
  locationId: "loc-2",
  locationName: "Local Miraflores",
  productId: "prod-1",
  productName: "Dispensador de mesa",
  quantity: 2,
  lastMovementAt: "2026-10-12T11:00:00.000Z",
};

function stubReport(items: BorrowedAccessoryItem[]) {
  cleanups.push(
    registerEndpoint("/api/v1/accessories/borrowed-report", {
      method: "GET",
      handler: () => items,
    }),
  );
}

async function renderPage(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/reports/borrowed-accessories" });
  await screen.findByRole("heading", { name: "Accesorios prestados", level: 1 });
}

describe("Reporte de Accesorios Prestados", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra los accesorios prestados con totales y detalles por local", async () => {
    stubReport([ITEM_1, ITEM_2]);

    await renderPage();

    expect(await screen.findByText("Bodega Don Pepe")).toBeTruthy();
    expect(screen.getByText("Restaurante El Sol")).toBeTruthy();
    expect(screen.getByText("Sede Principal")).toBeTruthy();
    expect(screen.getByText("Local Miraflores")).toBeTruthy();
    expect(screen.getByText("5 accesorios prestados en 2 clientes")).toBeTruthy();
  });

  it("permite filtrar por nombre de cliente", async () => {
    stubReport([ITEM_1, ITEM_2]);
    const user = userEvent.setup();

    await renderPage();

    const searchInput = await screen.findByPlaceholderText(/Cliente, local o accesorio/);
    await user.type(searchInput, "Don Pepe");

    expect(screen.getByText("Bodega Don Pepe")).toBeTruthy();
    expect(screen.queryByText("Restaurante El Sol")).toBeNull();
  });

  it("muestra estado vacío cuando no hay accesorios prestados", async () => {
    stubReport([]);

    await renderPage();

    expect(await screen.findByText("Ningún cliente tiene accesorios prestados")).toBeTruthy();
  });
});
