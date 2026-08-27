import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./app";
import { signIn } from "./test/session";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("muestra el login cuando se entra sin sesión", async () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeInTheDocument();
  });

  it("protege la raíz: sin sesión redirige al login", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("una ruta desconocida sin sesión redirige al login, como cualquier ruta protegida", async () => {
    render(
      <MemoryRouter initialEntries={["/esta-ruta-no-existe"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeInTheDocument();
  });

  it("una ruta desconocida con sesión muestra la 404 con la barra de navegación puesta", async () => {
    signIn(["ADMIN"]);

    render(
      <MemoryRouter initialEntries={["/esta-ruta-no-existe"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Esta página no existe")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al Panel" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });
});
