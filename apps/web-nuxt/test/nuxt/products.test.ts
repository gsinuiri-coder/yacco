import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { Product } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const REFILL: Product = {
  id: "refill-id",
  name: "Recarga 20L con caño",
  type: "REFILL",
  containerType: { id: "ct-1", name: "Con caño" },
  listPrice: "8.00",
  active: true,
};
const BOTTLE: Product = {
  id: "bottle-id",
  name: "Bidón 20L sin caño",
  type: "CONTAINER_SALE",
  containerType: { id: "ct-2", name: "Sin caño" },
  listPrice: "28.00",
  active: true,
};

function stubList(products: Product[]) {
  cleanups.push(registerEndpoint("/api/v1/products", { method: "GET", handler: () => products }));
}

async function renderPage(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/products" });
  await screen.findByRole("heading", { name: "Productos", level: 1 });
}

async function rowOf(name: string): Promise<HTMLElement> {
  return (await screen.findByText(name)).closest("tr") as HTMLElement;
}

describe("Productos", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista cada producto con su tipo, su envase y su precio de lista en soles", async () => {
    stubList([REFILL, BOTTLE]);

    await renderPage();

    const row = await rowOf("Bidón 20L sin caño");
    expect(within(row).getByText("Venta de bidón")).toBeTruthy();
    expect(within(row).getByText("Sin caño")).toBeTruthy();
    expect(within(row).getByText("S/ 28.00")).toBeTruthy();
    expect(within(await rowOf("Recarga 20L con caño")).getByText("Recarga")).toBeTruthy();
    expect(screen.getByText("2 productos")).toBeTruthy();
  });

  it("el administrador cambia el precio y la fila muestra el que devolvió la API", async () => {
    stubList([REFILL]);
    const bodies = stubWrite(cleanups, "/api/v1/products/refill-id", "PATCH", () => ({
      ...REFILL,
      listPrice: "9.50",
    }));
    const user = userEvent.setup();

    await renderPage();
    const row = await rowOf("Recarga 20L con caño");
    await user.click(within(row).getByRole("button", { name: "Cambiar precio" }));
    const input = screen.getByLabelText("Precio de lista de Recarga 20L con caño");
    await user.clear(input);
    await user.type(input, " 9.5 ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("S/ 9.50")).toBeTruthy();
    expect(bodies).toEqual([{ listPrice: "9.5" }]);
    expect(screen.queryByLabelText("Precio de lista de Recarga 20L con caño")).toBeNull();
  });

  it("no envía un precio mal escrito, y dice cómo escribirlo", async () => {
    stubList([REFILL]);
    const bodies = stubWrite(cleanups, "/api/v1/products/refill-id", "PATCH");
    const user = userEvent.setup();

    await renderPage();
    await user.click(
      within(await rowOf("Recarga 20L con caño")).getByRole("button", { name: "Cambiar precio" }),
    );
    const input = screen.getByLabelText("Precio de lista de Recarga 20L con caño");
    await user.clear(input);
    await user.type(input, "8,50");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Escribe el precio en soles, con hasta dos decimales",
    );
    expect(bodies).toHaveLength(0);
  });

  it("si la API rechaza, muestra su mensaje en la fila y deja el campo abierto", async () => {
    stubList([REFILL]);
    stubWrite(
      cleanups,
      "/api/v1/products/refill-id",
      "PATCH",
      failWith(404, 'El producto "refill-id" no existe'),
    );
    const user = userEvent.setup();

    await renderPage();
    await user.click(
      within(await rowOf("Recarga 20L con caño")).getByRole("button", { name: "Cambiar precio" }),
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("no existe");
    expect(screen.getByLabelText("Precio de lista de Recarga 20L con caño")).toBeTruthy();
  });

  it("un vendedor ve los precios pero no puede cambiarlos", async () => {
    stubList([REFILL]);

    await renderPage(["SELLER"]);

    const row = await rowOf("Recarga 20L con caño");
    expect(within(row).getByText("S/ 8.00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cambiar precio" })).toBeNull();
  });
});
