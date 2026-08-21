import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./app";

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
});
