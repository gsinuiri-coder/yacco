import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { API_BASE_URL } from "../config";
import { DashboardPage } from "../pages/dashboard-page";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { buildToken } from "../test/tokens";
import { ProtectedRoute } from "./protected-route";

function renderProtectedApp() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<h1>Ingresar</h1>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
      </Route>
    </Routes>,
    "/",
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("redirige a /login cuando no hay sesión", async () => {
    renderProtectedApp();

    expect(await screen.findByRole("heading", { name: "Ingresar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("restaura la sesión desde el refresh token y deja pasar", async () => {
    localStorage.setItem("yacco.refreshToken", "refresh-valido");
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer refresh-valido");
        return HttpResponse.json({
          accessToken: buildToken({ username: "vendedor1", roles: ["SELLER"] }),
        });
      }),
    );

    renderProtectedApp();

    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
    expect(screen.getByText("vendedor1")).toBeInTheDocument();
    expect(screen.getByText("Roles: SELLER")).toBeInTheDocument();
  });

  it("expulsa a /login si el refresh token guardado ya no vale", async () => {
    localStorage.setItem("yacco.refreshToken", "refresh-vencido");
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
    );

    renderProtectedApp();

    expect(await screen.findByRole("heading", { name: "Ingresar" })).toBeInTheDocument();
    // La sesión irrecuperable se limpia del disco, no solo de memoria.
    expect(localStorage.getItem("yacco.refreshToken")).toBeNull();
  });

  it("cierra sesión con el botón y vuelve a /login", async () => {
    const user = userEvent.setup();
    localStorage.setItem("yacco.refreshToken", "refresh-valido");
    server.use(
      http.post(`${API_BASE_URL}/auth/refresh`, () =>
        HttpResponse.json({ accessToken: buildToken() }),
      ),
    );

    renderProtectedApp();
    await screen.findByRole("heading", { name: "Panel" });
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("heading", { name: "Ingresar" })).toBeInTheDocument();
    expect(localStorage.getItem("yacco.refreshToken")).toBeNull();
  });
});
