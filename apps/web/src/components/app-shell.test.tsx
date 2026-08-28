import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render";
import { signIn } from "../test/session";
import { AppShell } from "./app-shell";

const NAV_LINKS = [
  "Panel",
  "Clientes",
  "Pedidos",
  "Inventario",
  "Producción",
  "Movimientos",
  "Tipos de envase",
  "Contar envases",
];

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("muestra los ocho enlaces dentro de un único <nav aria-label='Principal'>", async () => {
    renderWithProviders(
      <AppShell>
        <p>Contenido</p>
      </AppShell>,
    );

    const nav = await screen.findByRole("navigation", { name: "Principal" });
    expect(screen.getAllByRole("navigation")).toHaveLength(1);

    for (const name of NAV_LINKS) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("agrupa los tres enlaces de envases dentro del mismo <nav>, sin partirlo en dos", async () => {
    renderWithProviders(
      <AppShell>
        <p>Contenido</p>
      </AppShell>,
    );

    const nav = await screen.findByRole("navigation", { name: "Principal" });
    const movimientos = within(nav).getByRole("link", { name: "Movimientos" });

    expect(movimientos.closest("nav")).toBe(nav);
    expect(movimientos.closest(".app-bar__nav-group")).not.toBeNull();
  });
});
