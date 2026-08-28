import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render";
import { signIn } from "../test/session";
import { AppShell } from "./app-shell";

const NAV_LINKS = [
  "Panel",
  "Clientes",
  "Pedidos",
  "Rutas",
  "Pagos",
  "Inventario",
  "Producción",
  "Movimientos",
  "Tipos de envase",
  "Contar envases",
  "Cuadre de envases",
  "Zonas",
  "Usuarios",
];

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("muestra los doce enlaces dentro de un único <nav aria-label='Principal'>", async () => {
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

  // Único enlace condicionado por rol: la pantalla a la que lleva es
  // ADMIN-only de punta a punta, así que para un vendedor sería un enlace
  // muerto.
  it("«Cuadre de envases» solo aparece para un administrador", async () => {
    localStorage.clear();
    signIn(["SELLER"]);

    renderWithProviders(
      <AppShell>
        <p>Contenido</p>
      </AppShell>,
    );

    const nav = await screen.findByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Contar envases" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Cuadre de envases" })).not.toBeInTheDocument();
    // Usuarios sí lo ve: leer la lista es ADMIN y SELLER; lo que se le
    // esconde adentro son los controles de gestión.
    expect(within(nav).getByRole("link", { name: "Usuarios" })).toBeInTheDocument();
  });

  it("«Zonas» y «Usuarios» cierran la barra, fuera del grupo de envases", async () => {
    renderWithProviders(
      <AppShell>
        <p>Contenido</p>
      </AppShell>,
    );

    const nav = await screen.findByRole("navigation", { name: "Principal" });
    const zonas = within(nav).getByRole("link", { name: "Zonas" });
    const usuarios = within(nav).getByRole("link", { name: "Usuarios" });
    const links = within(nav).getAllByRole("link");

    expect(zonas.closest(".app-bar__nav-group")).toBeNull();
    expect(usuarios.closest(".app-bar__nav-group")).toBeNull();
    // Administración al final: usuarios es lo último que se toca en un día
    // normal, y lo primero que hace falta al dar de alta a alguien nuevo.
    expect(links.at(-1)).toBe(usuarios);
    expect(links.at(-2)).toBe(zonas);
  });
});
