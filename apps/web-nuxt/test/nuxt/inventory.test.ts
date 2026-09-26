import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { H3Event } from "h3";
import type { ContainerInventoryItem, ContainerState, PlantCount } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { failWith, stubWrite } from "../support/route-detail";
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

  describe("Conteo de la planta", () => {
    function plantCount(overrides: Partial<PlantCount> = {}): PlantCount {
      return {
        containerType: { id: "ct-Bidón 20L", name: "Bidón 20L" },
        state: "EMPTY_AT_PLANT",
        expectedQuantity: -3,
        countedQuantity: 4,
        adjustments: [{ id: "adj-1", quantity: 7, batch: null }],
        ...overrides,
      };
    }

    function countSection(): HTMLElement {
      return screen.getByRole("region", { name: "Conteo de la planta" });
    }

    async function choose(label: string, option: string) {
      const user = userEvent.setup();
      await user.click(within(countSection()).getByLabelText(label));
      await user.click(await screen.findByRole("option", { name: option }));
    }

    it("el vendedor no lo ve: solo el administrador cuenta la planta", async () => {
      resetSession();
      cleanups.push(signIn(["SELLER"], "vendedor"));
      stubInventory([cell("Bidón 20L", "EMPTY_AT_PLANT", 4)]);

      await renderInventory();

      await screen.findByRole("rowheader", { name: "Bidón 20L" });
      expect(screen.queryByRole("region", { name: "Conteo de la planta" })).toBeNull();
    });

    it("vacíos desde un saldo negativo: muestra lo que había, pide confirmar la diferencia y manda el conteo", async () => {
      stubInventory([
        cell("Bidón 20L", "EMPTY_AT_PLANT", -3),
        cell("Bidón 20L", "FULL_AT_PLANT", 5),
      ]);
      const bodies = stubWrite(cleanups, "/api/v1/container-counts/plant", "POST", () =>
        plantCount(),
      );
      const user = userEvent.setup();

      await renderInventory();
      await screen.findByRole("region", { name: "Conteo de la planta" });
      await user.click(within(countSection()).getByRole("button", { name: "Contar la planta" }));
      expect(within(countSection()).getByText("Según el sistema: -3")).toBeTruthy();
      await user.type(within(countSection()).getByLabelText("Contado"), "4");
      await user.click(within(countSection()).getByRole("button", { name: "Registrar conteo" }));

      expect(
        within(countSection()).getByText(
          "Bidón 20L, vacíos en planta: según el sistema -3, contado 4 (diferencia +7).",
        ),
      ).toBeTruthy();
      expect(bodies).toEqual([]);
      await user.click(
        within(countSection()).getByRole("button", { name: "Confirmar diferencia" }),
      );

      expect(
        await screen.findByText("Conteo registrado: Bidón 20L, vacíos en planta pasó de -3 a 4."),
      ).toBeTruthy();
      expect(bodies).toEqual([
        { containerTypeId: "ct-Bidón 20L", state: "EMPTY_AT_PLANT", countedQuantity: 4 },
      ]);
    });

    it("llenos de menos: dice de qué lotes se descontaron, del más viejo al más nuevo", async () => {
      stubInventory([cell("Bidón 20L", "FULL_AT_PLANT", 11)]);
      const bodies = stubWrite(cleanups, "/api/v1/container-counts/plant", "POST", () =>
        plantCount({
          state: "FULL_AT_PLANT",
          expectedQuantity: 11,
          countedQuantity: 3,
          adjustments: [
            { id: "a", quantity: 6, batch: { id: "b-1", code: "L-VIEJO" } },
            { id: "b", quantity: 2, batch: { id: "b-2", code: "L-NUEVO" } },
          ],
        }),
      );
      const user = userEvent.setup();

      await renderInventory();
      await screen.findByRole("region", { name: "Conteo de la planta" });
      await user.click(within(countSection()).getByRole("button", { name: "Contar la planta" }));
      await choose("Qué se contó", "Llenos en planta");
      await user.type(within(countSection()).getByLabelText("Contado"), "3");
      await user.click(within(countSection()).getByRole("button", { name: "Registrar conteo" }));
      await user.click(
        within(countSection()).getByRole("button", { name: "Confirmar diferencia" }),
      );

      expect(
        await screen.findByText(
          "Conteo registrado: Bidón 20L, llenos en planta pasó de 11 a 3. Se descontaron 6 del lote L-VIEJO y 2 del lote L-NUEVO.",
        ),
      ).toBeTruthy();
      expect(bodies).toEqual([
        { containerTypeId: "ct-Bidón 20L", state: "FULL_AT_PLANT", countedQuantity: 3 },
      ]);
    });

    it("llenos de más: explica que se anotan como lote y no manda nada", async () => {
      stubInventory([cell("Bidón 20L", "FULL_AT_PLANT", 2)]);
      const bodies = stubWrite(cleanups, "/api/v1/container-counts/plant", "POST", () =>
        plantCount(),
      );
      const user = userEvent.setup();

      await renderInventory();
      await screen.findByRole("region", { name: "Conteo de la planta" });
      await user.click(within(countSection()).getByRole("button", { name: "Contar la planta" }));
      await choose("Qué se contó", "Llenos en planta");
      await user.type(within(countSection()).getByLabelText("Contado"), "5");
      await user.click(within(countSection()).getByRole("button", { name: "Registrar conteo" }));

      expect((await within(countSection()).findByRole("alert")).textContent).toContain(
        "Los llenos que faltan se anotan como lote en Producción.",
      );
      expect(bodies).toEqual([]);
    });
  });
});
