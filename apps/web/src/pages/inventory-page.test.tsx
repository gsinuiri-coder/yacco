import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContainerInventoryItem } from "../api/container-inventory";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { InventoryPage } from "./inventory-page";

function item(overrides: Partial<ContainerInventoryItem> = {}): ContainerInventoryItem {
  return {
    containerTypeId: "bidon-20l",
    containerType: { id: "bidon-20l", name: "Bidón 20L" },
    state: "EMPTY_AT_PLANT",
    quantity: 10,
    ...overrides,
  };
}

function stubInventory(items: ContainerInventoryItem[]): void {
  server.use(
    http.get(`${API_BASE_URL}/container-movements/inventory`, () => HttpResponse.json(items)),
  );
}

function renderInventory() {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory" element={<InventoryPage />} />
    </Routes>,
    "/inventory",
  );
}

describe("InventoryPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("pivota las filas planas en una matriz con totales por tipo y total general", async () => {
    stubInventory([
      item({ state: "EMPTY_AT_PLANT", quantity: 30 }),
      item({ state: "FULL_AT_PLANT", quantity: 12 }),
      item({ state: "WITH_CUSTOMER", quantity: 8 }),
    ]);

    renderInventory();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Bidón 20L").closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement).getAllByRole("cell");
    // Tipo de envase, vacíos en planta, llenos en planta, llenos en camión,
    // vacíos en camión, en poder del cliente, total.
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Bidón 20L",
      "30",
      "12",
      "0",
      "0",
      "8",
      "50",
    ]);
    expect(screen.getByText(/Total general/)).toHaveTextContent("50 envases");
  });

  it("un estado ausente en la respuesta se muestra como 0, no en blanco", async () => {
    stubInventory([item({ state: "FULL_ON_ROUTE", quantity: 4 })]);

    renderInventory();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Bidón 20L").closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Bidón 20L",
      "0",
      "0",
      "4",
      "0",
      "0",
      "4",
    ]);
  });

  it("un valor negativo se muestra tal cual, destacado, con su explicación", async () => {
    stubInventory([
      item({ state: "FULL_AT_PLANT", quantity: 15 }),
      item({ state: "EMPTY_AT_PLANT", quantity: -3 }),
    ]);

    renderInventory();

    const negativeCell = await screen.findByText("-3");
    expect(negativeCell).toHaveClass("table__cell--negative");
    expect(negativeCell).toHaveAccessibleName(/faltan registrar entradas de envases/);

    expect(
      await screen.findByText(/se registraron más envases llenados que vacíos disponibles/),
    ).toBeInTheDocument();
  });

  it("una respuesta con filas cuya suma total es cero renderiza la matriz, no el vacío real (bug de producción)", async () => {
    stubInventory([
      item({
        containerTypeId: "con-canio",
        containerType: { id: "con-canio", name: "Con caño" },
        state: "EMPTY_AT_PLANT",
        quantity: -50,
      }),
      item({
        containerTypeId: "con-canio",
        containerType: { id: "con-canio", name: "Con caño" },
        state: "FULL_AT_PLANT",
        quantity: 50,
      }),
    ]);

    renderInventory();

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay movimientos de envases")).not.toBeInTheDocument();

    const negativeCell = screen.getByText("-50");
    expect(negativeCell).toHaveClass("table__cell--negative");
    expect(negativeCell).toHaveAccessibleName(/faltan registrar entradas de envases/);
    expect(
      screen.getByText(/se registraron más envases llenados que vacíos disponibles/),
    ).toBeInTheDocument();
  });

  it("una respuesta con filas cuya suma total es negativa renderiza la matriz, no el vacío real", async () => {
    stubInventory([
      item({
        containerTypeId: "con-canio",
        containerType: { id: "con-canio", name: "Con caño" },
        state: "EMPTY_AT_PLANT",
        quantity: -80,
      }),
      item({
        containerTypeId: "con-canio",
        containerType: { id: "con-canio", name: "Con caño" },
        state: "FULL_AT_PLANT",
        quantity: 50,
      }),
    ]);

    renderInventory();

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay movimientos de envases")).not.toBeInTheDocument();
    expect(screen.getByText(/Total general/)).toHaveTextContent("-30 envases");
  });

  it("sin negativos no muestra el aviso", async () => {
    stubInventory([item({ state: "EMPTY_AT_PLANT", quantity: 10 })]);

    renderInventory();

    await screen.findByRole("table");
    expect(
      screen.queryByText(/se registraron más envases llenados que vacíos disponibles/),
    ).not.toBeInTheDocument();
  });

  it("vacío real: sin movimientos registrados, explica dónde aparecerá el inventario", async () => {
    stubInventory([]);

    renderInventory();

    expect(await screen.findByText("Todavía no hay movimientos de envases")).toBeInTheDocument();
    expect(
      screen.getByText(/El inventario aparecerá aquí en cuanto se registre producción/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("muestra el error de la API y permite reintentar", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/container-movements/inventory`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json([item({ state: "EMPTY_AT_PLANT", quantity: 5 })]);
      }),
    );

    renderInventory();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("Base de datos no disponible")).not.toBeInTheDocument();
  });
});
