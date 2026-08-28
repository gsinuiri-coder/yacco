import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render";
import { signIn } from "../test/session";
import { AppShell } from "./app-shell";

const NAV_LINKS = [
  "Panel",
  "Clientes",
  "Pedidos",
  "Pagos",
  "Inventario",
  "Producción",
  "Movimientos",
  "Tipos de envase",
  "Contar envases",
  "Zonas",
];

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("muestra los diez enlaces dentro de un único <nav aria-label='Principal'>", async () => {
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

  it("«Pagos» va junto a clientes y pedidos, no en el grupo de envases", async () => {
    renderWithProviders(
      <AppShell>
        <p>Contenido</p>
      </AppShell>,
    );

    const nav = await screen.findByRole("navigation", { name: "Principal" });
    const pagos = within(nav).getByRole("link", { name: "Pagos" });

    expect(pagos.closest(".app-bar__nav-group")).toBeNull();
  });

  it("«Zonas» va al final, fuera del grupo de envases", async () => {
    renderWithProviders(
      <AppShell>
        <p>Contenido</p>
      </AppShell>,
    );

    const nav = await screen.findByRole("navigation", { name: "Principal" });
    const zonas = within(nav).getByRole("link", { name: "Zonas" });
    const links = within(nav).getAllByRole("link");

    expect(zonas.closest(".app-bar__nav-group")).toBeNull();
    expect(links.at(-1)).toBe(zonas);
  });
});
