import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { H3Event } from "h3";
import type { ContainerInventoryItem, ContainerState } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { failWith } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

function cell(type: string, state: ContainerState, quantity: number): ContainerInventoryItem {
  return {
    containerTypeId: `ct-${type}`,
    containerType: { id: `ct-${type}`, name: type },
    state,
    quantity,
  };
}

function stubInventory(respond: ContainerInventoryItem[] | ((event: H3Event) => unknown)) {
  cleanups.push(
    registerEndpoint(
      "/api/v1/container-movements/inventory",
      typeof respond === "function" ? respond : () => respond,
    ),
  );
}

async function renderInventory() {
  await renderSuspended(App, { route: "/inventory" });
  await screen.findByRole("heading", { name: "Inventario de envases", level: 1 });
}

/** La fila de un tipo, como lista de celdas en el orden de las columnas. */
async function rowCells(type: string): Promise<string[]> {
  const header = await screen.findByRole("rowheader", { name: type });
  return within(header.closest("tr") as HTMLElement)
    .getAllByRole("cell")
    .map((td) => td.textContent?.trim() ?? "");
}

describe("Inventario de envases", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("pivota las filas planas en una matriz por tipo, completa con ceros y suma el total general", async () => {
    stubInventory([
      cell("Bidón 20L", "EMPTY_AT_PLANT", 40),
      cell("Bidón 20L", "WITH_CUSTOMER", 120),
      cell("Bidón 20L", "FULL_ON_ROUTE", 30),
      cell("Botella 7L", "FULL_AT_PLANT", 12),
    ]);

    await renderInventory();

    // Vacíos en planta, Llenos en planta, Llenos en camión, Vacíos en camión, En poder del cliente, Total.
    expect(await rowCells("Bidón 20L")).toEqual(["40", "0", "30", "0", "120", "190"]);
    expect(await rowCells("Botella 7L")).toEqual(["0", "12", "0", "0", "0", "12"]);
    expect(screen.getByText(/Total general:/).textContent?.replace(/\s+/g, " ")).toContain(
      "Total general: 202 envases",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un negativo se muestra tal cual, con su explicación y un aviso", async () => {
    stubInventory([
      cell("Bidón 20L", "EMPTY_AT_PLANT", -5),
      cell("Bidón 20L", "FULL_AT_PLANT", 20),
    ]);

    await renderInventory();

    expect(
      await screen.findAllByText(
        "-5: hay más envases llenados que vacíos registrados, faltan registrar entradas de envases",
      ),
    ).toHaveLength(1);
    expect((await screen.findByRole("alert")).textContent).toContain("Hay valores negativos");
  });

  it("filas que suman cero muestran la matriz, no el vacío real (el bug de producción del React)", async () => {
    stubInventory([
      cell("Bidón 20L", "EMPTY_AT_PLANT", -50),
      cell("Bidón 20L", "FULL_AT_PLANT", 50),
    ]);

    await renderInventory();

    expect(await rowCells("Bidón 20L")).toEqual(
      ["-50", "50", "0", "0", "0", "0"].map((value) =>
        value === "-50" ? expect.stringContaining("-50") : value,
      ) as unknown as string[],
    );
    expect(screen.queryByText("Todavía no hay movimientos de envases")).toBeNull();
  });

  it("sin movimientos explica dónde va a aparecer el inventario", async () => {
    stubInventory([]);

    await renderInventory();

    expect(await screen.findByText("Todavía no hay movimientos de envases")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("un error de la API se muestra y se reintenta", async () => {
    let attempt = 0;
    stubInventory((event) => {
      attempt++;
      return attempt === 1
        ? failWith(500, "Base de datos no disponible")(event)
        : [cell("Bidón 20L", "EMPTY_AT_PLANT", 1)];
    });

    await renderInventory();
    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("rowheader", { name: "Bidón 20L" })).toBeTruthy();
  });
});
