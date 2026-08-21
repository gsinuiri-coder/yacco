import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../auth/auth-provider";

/** Monta un árbol con router en memoria y AuthProvider reales. */
export function renderWithProviders(ui: ReactNode, initialPath = "/"): RenderResult {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}
