import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import { getQuery, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, pageOf } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
type Query = Record<string, string>;

const activeSale = {
  id: "sale-route",
  soldAt: "2026-10-15T16:30:00.000Z",
  total: "35.00",
  customer: { id: "customer-one", name: "Bodega Santa Rosa" },
  location: { id: "location-one", name: "Principal" },
  items: [{ product: { id: "product-one", name: "Recarga 20 L" }, quantity: 2 }],
  origin: "ROUTE",
  voidedAt: null,
  voidReason: null,
};

const voidedSale = {
  ...activeSale,
  id: "sale-accessory",
  total: "12.50",
  origin: "ACCESSORY",
  items: [{ product: { id: "product-two", name: "Surtidor" }, quantity: 1 }],
  voidedAt: "2026-10-15T17:00:00.000Z",
  voidReason: "Se anotó dos veces",
};

function salesPage(rows = [activeSale, voidedSale]) {
  return { ...pageOf(rows), totalAmount: "35.00" };
}

function stubSales(rows = [activeSale, voidedSale]): Query[] {
  const seen: Query[] = [];
  cleanups.push(
    registerEndpoint("/api/v1/sales", (event: H3Event) => {
      seen.push(getQuery(event) as Query);
      return salesPage(rows);
    }),
  );
  return seen;
}

describe("Ventas", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["ADMIN"]));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("aparece en la navegación y lista ventas vigentes y anuladas sin sumar las anuladas", async () => {
    stubSales();

    await renderSuspended(App, { route: "/sales" });

    const navigation = screen.getByRole("navigation", { name: "Principal" });
    expect(within(navigation).getByRole("link", { name: "Ventas" })).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Ventas registradas" });
    const active = within(table).getByText("Recarga 20 L").closest("tr") as HTMLElement;
    expect(within(active).getByText("Bodega Santa Rosa")).toBeTruthy();
    expect(within(active).getByText("Ruta")).toBeTruthy();
    expect(within(active).getByText("S/ 35.00")).toBeTruthy();
    const voided = within(table).getByText("Surtidor").closest("tr") as HTMLElement;
    expect(within(voided).getByText("Accesorio")).toBeTruthy();
    expect(within(voided).getByText("Anulada")).toBeTruthy();
    expect(within(voided).getByText("Se anotó dos veces")).toBeTruthy();
    expect(screen.getByText("Total vigente: S/ 35.00")).toBeTruthy();
  });

  it("abierta desde el Panel, filtra por el día de Lima y el total coincide", async () => {
    const seen = stubSales();

    await renderSuspended(App, {
      route: "/sales?soldFrom=2026-10-15&soldTo=2026-10-15",
    });
    await screen.findByText("Total vigente: S/ 35.00");

    expect(seen[0]).toMatchObject({ soldFrom: "2026-10-15", soldTo: "2026-10-15" });
    expect((screen.getByLabelText("Vendida desde") as HTMLInputElement).value).toBe("2026-10-15");
    expect((screen.getByLabelText("Vendida hasta") as HTMLInputElement).value).toBe("2026-10-15");
  });

  it("envía los filtros por día y cliente, y permite limpiarlos", async () => {
    const seen = stubSales();
    cleanups.push(
      registerEndpoint("/api/v1/customers", () =>
        pageOf([buildCustomer({ id: "customer-one", name: "Bodega Santa Rosa" })]),
      ),
    );

    await renderSuspended(App, { route: "/sales" });
    await screen.findByText("Total vigente: S/ 35.00");
    await fireEvent.update(screen.getByLabelText("Vendida desde"), "2026-10-01");
    await fireEvent.update(screen.getByLabelText("Vendida hasta"), "2026-10-31");
    await fireEvent.update(screen.getByLabelText("Cliente"), "Santa");
    await screen.findByRole("option", { name: /Bodega Santa Rosa/ });
    await fireEvent.click(screen.getByRole("option", { name: /Bodega Santa Rosa/ }));

    await waitFor(() =>
      expect(seen.at(-1)).toMatchObject({
        soldFrom: "2026-10-01",
        soldTo: "2026-10-31",
        customerId: "customer-one",
      }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => expect(seen.at(-1)).toEqual({ page: "1", limit: "20" }));
  });

  it("sin ventas distingue el vacío real y un filtro sin coincidencias", async () => {
    stubSales([]);

    await renderSuspended(App, { route: "/sales" });
    expect(await screen.findByText("Todavía no hay ventas registradas")).toBeTruthy();
    await fireEvent.update(screen.getByLabelText("Vendida desde"), "2026-10-01");
    expect(await screen.findByText("Ninguna venta coincide con el filtro")).toBeTruthy();
  });

  it("muestra el error de la API y permite reintentar", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/sales", (event: H3Event) => {
        attempt++;
        if (attempt === 1) {
          setResponseStatus(event, 500);
          return { message: "Base de datos no disponible" };
        }
        return salesPage();
      }),
    );

    await renderSuspended(App, { route: "/sales" });
    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Total vigente: S/ 35.00")).toBeTruthy();
  });
});
