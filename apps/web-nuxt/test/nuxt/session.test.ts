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

  it("al recargar, canjea la cookie del refresh y deja pasar", async () => {
    localStorage.setItem("yacco.session", "1");
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
    // El refresh va en la cookie httpOnly: nada en Authorization, porque
    // este código ni siquiera lo conoce.
    expect(bearers()).toEqual([undefined]);
  });

  it("si el refresh ya no vale, borra la marca y avisa en el login que la sesión venció", async () => {
    localStorage.setItem("yacco.session", "1");
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
    expect(localStorage.getItem("yacco.session")).toBeNull();
  });

  it("cerrar sesión le pide a la API que borre la cookie y vuelve al login SIN aviso", async () => {
    cleanups.push(signIn(["ADMIN"], "giancarlo"));
    let logouts = 0;
    cleanups.push(
      registerEndpoint("/api/v1/auth/logout", {
        method: "POST",
        handler: (event) => {
          logouts++;
          setResponseStatus(event, 204);
          return null;
        },
      }),
    );

    await renderSuspended(App, { route: "/" });
    await screen.findByText("giancarlo");
    await userEvent.setup().click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("heading", { name: "Ingresar" })).toBeTruthy();
    expect(screen.queryByText("Tu sesión venció. Vuelve a ingresar.")).toBeNull();
    expect(localStorage.getItem("yacco.session")).toBeNull();
    await waitFor(() => expect(logouts).toBe(1));
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
