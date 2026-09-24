import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { readBody, setResponseStatus } from "h3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildToken, resetSession } from "../support/session";

const cleanups: Array<() => void> = [];

function onLogin(handler: Parameters<typeof registerEndpoint>[1]) {
  const handlerConfig =
    typeof handler === "function" ? { method: "POST" as const, handler } : handler;
  cleanups.push(registerEndpoint("/api/v1/auth/login", handlerConfig));
}

async function fillAndSubmit(username: string, password: string) {
  const user = userEvent.setup();
  if (username) await user.type(screen.getByLabelText("Usuario"), username);
  if (password) await user.type(screen.getByLabelText("Contraseña"), password);
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
}

describe("login", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("inicia sesión con username (no email) y entra al panel", async () => {
    const received: unknown[] = [];
    onLogin(async (event) => {
      received.push(await readBody(event));
      return { accessToken: buildToken({ username: "giancarlo" }), refreshToken: "refresh-nuevo" };
    });

    await renderSuspended(App, { route: "/login" });
    await fillAndSubmit("  giancarlo ", "secreta");

    expect(await screen.findByRole("heading", { name: "Panel" })).toBeTruthy();
    // La API valida con whitelist: un campo "email" sería un 400.
    expect(received).toEqual([{ username: "giancarlo", password: "secreta" }]);
    // El refresh token quedó en la cookie httpOnly que escribe la API; en disco
    // solo la marca de que hubo sesión (D-024).
    expect(localStorage.getItem("yacco.session")).toBe("1");
    expect(localStorage.getItem("yacco.refreshToken")).toBeNull();
    expect(await screen.findByText("giancarlo")).toBeTruthy();
  });

  it("con credenciales inválidas avisa sin decir si el usuario existe, y no guarda nada", async () => {
    onLogin((event) => {
      setResponseStatus(event, 401);
      return { message: "Invalid credentials" };
    });

    await renderSuspended(App, { route: "/login" });
    await fillAndSubmit("admin", "incorrecta");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Usuario o contraseña incorrectos.");
    expect(screen.queryByRole("heading", { name: "Panel" })).toBeNull();
    expect(localStorage.getItem("yacco.session")).toBeNull();
  });

  it("si la API falla por otra cosa, dice eso y no culpa a la contraseña", async () => {
    onLogin((event) => {
      setResponseStatus(event, 503);
      return { message: "Servicio no disponible" };
    });

    await renderSuspended(App, { route: "/login" });
    await fillAndSubmit("admin", "admin");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Servicio no disponible");
    expect(alert.textContent).not.toContain("incorrectos");
  });

  it("valida en el cliente antes de llamar a la API", async () => {
    let calls = 0;
    onLogin(() => {
      calls++;
      return {};
    });

    await renderSuspended(App, { route: "/login" });
    await fillAndSubmit("", "");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Ingresa usuario y contraseña.",
    );
    expect(calls).toBe(0);
  });

  it("deshabilita el formulario mientras la petición está en curso", async () => {
    let release: (() => void) | undefined;
    const mayFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    onLogin(async () => {
      await mayFinish;
      return { accessToken: buildToken(), refreshToken: "refresh-nuevo" };
    });

    await renderSuspended(App, { route: "/login" });
    await fillAndSubmit("admin", "admin");

    const pending = await screen.findByRole("button", { name: /Ingresando…/ });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Usuario") as HTMLInputElement).disabled).toBe(true);

    release?.();
    expect(await screen.findByRole("heading", { name: "Panel" })).toBeTruthy();
  });

  it("vuelve a la ruta que pedía antes de ingresar", async () => {
    onLogin(() => ({ accessToken: buildToken(), refreshToken: "r" }));
    await navigateTo("/login?from=/otra-pantalla");

    await renderSuspended(App, { route: "/login?from=/otra-pantalla" });
    await fillAndSubmit("admin", "admin");

    await waitFor(() => expect(useRouter().currentRoute.value.fullPath).toBe("/otra-pantalla"));
  });

  it("no sigue un `from` que apunta a otro sitio", async () => {
    onLogin(() => ({ accessToken: buildToken(), refreshToken: "r" }));

    await renderSuspended(App, { route: "/login?from=//evil.example" });
    await fillAndSubmit("admin", "admin");

    expect(await screen.findByRole("heading", { name: "Panel" })).toBeTruthy();
    expect(useRouter().currentRoute.value.fullPath).toBe("/");
  });
});
