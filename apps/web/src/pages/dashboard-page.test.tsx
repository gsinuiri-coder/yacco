import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render";
import { signIn } from "../test/session";
import { DashboardPage } from "./dashboard-page";

describe("DashboardPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("renderiza dentro de AppShell: la barra de navegación está presente", async () => {
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("el usuario y 'Cerrar sesión' aparecen una sola vez: los da AppShell, no el Panel", async () => {
    renderWithProviders(<DashboardPage />);

    await screen.findByRole("heading", { name: "Panel" });

    expect(screen.getAllByText("admin")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1);
  });

  it("muestra el buscador de clientes con foco automático", async () => {
    renderWithProviders(<DashboardPage />);

    const input = await screen.findByLabelText("Buscar cliente");
    expect(input).toHaveFocus();
  });
});
