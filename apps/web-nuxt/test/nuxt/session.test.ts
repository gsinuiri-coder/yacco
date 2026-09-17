import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { setResponseStatus } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "~/app.vue";
import { buildToken, recordBearers, resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

describe("sesión en el cliente", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
  });

  it("sin sesión, una pantalla protegida lleva al login y recuerda a dónde iba", async () => {
    await renderSuspended(App, { route: "/" });

    expect(await screen.findByRole("heading", { name: "Ingresar" })).toBeTruthy();
    expect(useRouter().currentRoute.value.fullPath).toBe("/login?from=/");
    // Nadie cerró una sesión: no hay nada vencido que avisar.
    expect(screen.queryByText("Tu sesión venció. Vuelve a ingresar.")).toBeNull();
  });

  it("al recargar, canjea el refresh token guardado y deja pasar", async () => {
    localStorage.setItem("yacco.refreshToken", "refresh-valido");
    const bearers = recordBearers("/auth/refresh");
    cleanups.push(
      registerEndpoint("/api/v1/auth/refresh", {
        method: "POST",
        handler: () => ({ accessToken: buildToken({ username: "vendedor1", roles: ["SELLER"] }) }),
      }),
    );

    await renderSuspended(App, { route: "/" });

    expect(await screen.findByRole("heading", { name: "Panel" })).toBeTruthy();
    expect(await screen.findByText("vendedor1")).toBeTruthy();
    // El refresh token viaja en Authorization, no en el cuerpo.
    expect(bearers()).toEqual(["Bearer refresh-valido"]);
  });

  it("si el refresh guardado ya no vale, lo borra y avisa en el login que la sesión venció", async () => {
    localStorage.setItem("yacco.refreshToken", "refresh-vencido");
    cleanups.push(
      registerEndpoint("/api/v1/auth/refresh", {
        method: "POST",
        handler: (event) => {
          setResponseStatus(event, 401);
          return { message: "Unauthorized" };
        },
      }),
    );

    await renderSuspended(App, { route: "/" });

    expect(await screen.findByRole("heading", { name: "Ingresar" })).toBeTruthy();
    expect(await screen.findByText("Tu sesión venció. Vuelve a ingresar.")).toBeTruthy();
    expect(localStorage.getItem("yacco.refreshToken")).toBeNull();
  });

  it("cerrar sesión vuelve al login SIN el aviso de sesión vencida", async () => {
    cleanups.push(signIn(["ADMIN"], "giancarlo"));

    await renderSuspended(App, { route: "/" });
    await screen.findByText("giancarlo");
    await userEvent.setup().click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("heading", { name: "Ingresar" })).toBeTruthy();
    expect(screen.queryByText("Tu sesión venció. Vuelve a ingresar.")).toBeNull();
    expect(localStorage.getItem("yacco.refreshToken")).toBeNull();
  });

  it("con sesión, entrar al login devuelve a la pantalla de antes", async () => {
    cleanups.push(signIn());

    await renderSuspended(App, { route: "/login" });
    await navigateTo("/login?from=/");

    await waitFor(() => expect(useRouter().currentRoute.value.fullPath).toBe("/"));
  });

  it("la barra lateral es un único landmark de navegación con el panel", async () => {
    cleanups.push(signIn());

    await renderSuspended(App, { route: "/" });

    const nav = await screen.findByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Panel" })).toBeTruthy();
  });
});
