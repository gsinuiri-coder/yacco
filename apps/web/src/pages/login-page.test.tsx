import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { buildToken } from "../test/tokens";
import { LoginPage } from "./login-page";

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<h1>Panel</h1>} />
    </Routes>,
    "/login",
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("inicia sesión y entra a la ruta protegida", async () => {
    const user = userEvent.setup();
    const accessToken = buildToken({ username: "admin" });
    const credentials: unknown[] = [];

    server.use(
      http.post(`${API_BASE_URL}/auth/login`, async ({ request }) => {
        credentials.push(await request.json());
        return HttpResponse.json({ accessToken, refreshToken: "refresh-nuevo" });
      }),
    );

    renderLogin();
    await user.type(screen.getByLabelText("Usuario"), "admin");
    await user.type(screen.getByLabelText("Contraseña"), "admin123");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
    // La API identifica por username: enviar "email" daría 400 por whitelist.
    expect(credentials).toEqual([{ username: "admin", password: "admin123" }]);
    expect(localStorage.getItem("yacco.refreshToken")).toBe("refresh-nuevo");
  });

  it("muestra un error cuando las credenciales son inválidas", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ message: "Invalid credentials" }, { status: 401 }),
      ),
    );

    renderLogin();
    await user.type(screen.getByLabelText("Usuario"), "admin");
    await user.type(screen.getByLabelText("Contraseña"), "incorrecta");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Usuario o contraseña incorrectos.");
    expect(screen.queryByRole("heading", { name: "Panel" })).not.toBeInTheDocument();
    expect(localStorage.getItem("yacco.refreshToken")).toBeNull();
  });

  it("valida en el cliente antes de llamar a la API", async () => {
    const user = userEvent.setup();
    // Sin handler de login: si el formulario llamara a la API, MSW haría
    // fallar el test por petición no declarada.
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ingresa usuario y contraseña.");
  });

  it("deshabilita el formulario mientras la petición está en curso", async () => {
    const user = userEvent.setup();
    let resolveLogin: (() => void) | undefined;
    const loginStarted = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });
    // El handler no responde hasta que el test lo autoriza. Antes esperaba
    // 50 ms fijos, y bajo carga la petición podía terminar antes de que
    // corriera la aserción: el formulario ya no estaba en curso y el test
    // fallaba de forma intermitente. Con la compuerta, la ventana en la que
    // se afirma "en curso" no compite con el fin de la petición.
    let allowLoginToFinish: (() => void) | undefined;
    const loginMayFinish = new Promise<void>((resolve) => {
      allowLoginToFinish = resolve;
    });

    server.use(
      http.post(`${API_BASE_URL}/auth/login`, async () => {
        resolveLogin?.();
        await loginMayFinish;
        return HttpResponse.json({ accessToken: buildToken(), refreshToken: "refresh-nuevo" });
      }),
    );

    renderLogin();
    await user.type(screen.getByLabelText("Usuario"), "admin");
    await user.type(screen.getByLabelText("Contraseña"), "admin123");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    await loginStarted;
    // findBy en vez de getBy: espera a que React pinte el estado "en curso"
    // en vez de exigir que ya esté pintado en ese instante.
    expect(await screen.findByRole("button", { name: "Ingresando…" })).toBeDisabled();
    expect(screen.getByLabelText("Usuario")).toBeDisabled();

    allowLoginToFinish?.();
    expect(await screen.findByRole("heading", { name: "Panel" })).toBeInTheDocument();
  });

  it("usa el sistema de diseño: .centered-page, botón primario y notice de error", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () =>
        HttpResponse.json({ message: "Invalid credentials" }, { status: 401 }),
      ),
    );

    const { container } = renderLogin();
    expect(container.querySelector(".centered-page")).not.toBeNull();

    const submit = screen.getByRole("button", { name: "Ingresar" });
    expect(submit).toHaveClass("button", "button--primary");

    await user.type(screen.getByLabelText("Usuario"), "admin");
    await user.type(screen.getByLabelText("Contraseña"), "incorrecta");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveClass("notice", "notice--error");
  });

  describe("arranque en frío de Render", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("avisa que el servidor está despertando si tarda más de 5s", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      server.use(
        http.post(`${API_BASE_URL}/auth/login`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 60_000));
          return HttpResponse.json({ accessToken: buildToken(), refreshToken: "refresh-nuevo" });
        }),
      );

      renderLogin();
      await user.type(screen.getByLabelText("Usuario"), "admin");
      await user.type(screen.getByLabelText("Contraseña"), "admin123");
      await user.click(screen.getByRole("button", { name: "Ingresar" }));

      expect(screen.queryByText(SLOW_REQUEST_MESSAGE)).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(screen.getByText(SLOW_REQUEST_MESSAGE)).toBeInTheDocument();
    });
  });
});
