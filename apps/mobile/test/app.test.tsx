import { fireEvent, render, screen } from "@testing-library/react-native";

import { App } from "../src/App";
import { createApiClient } from "../src/session/api-client";
import { DRIVER, fakeServer, memoryStore } from "./fakes";

const BASE = "https://api.example.test";
const OFFLINE_TEXT = "Sin conexión con el servidor. Tu sesión sigue abierta.";

async function renderApp(
  store: ReturnType<typeof memoryStore>,
  server: ReturnType<typeof fakeServer>,
) {
  await render(
    <App client={createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl })} />,
  );
}

async function fillLogin(username: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText("Usuario"), username);
  await fireEvent.changeText(screen.getByLabelText("Contraseña"), password);
  await fireEvent.press(screen.getByRole("button", { name: "Ingresar" }));
}

describe("ingreso del chofer", () => {
  it("sin sesión guardada pide usuario y contraseña, y al ingresar saluda al chofer", async () => {
    const store = memoryStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-1", refreshToken: "refresh-1" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(store, server);
    await screen.findByLabelText("Usuario");

    await fillLogin("  chofer.juan ", "una-clave");

    expect(await screen.findByRole("header", { name: "Hola, chofer.juan" })).toBeOnTheScreen();
    expect(server.calls[0]?.body).toEqual({ username: "chofer.juan", password: "una-clave" });
    expect(store.value).toBe("refresh-1");
  });

  it("sin usuario o contraseña avisa y no llama al servidor", async () => {
    const server = fakeServer();
    await renderApp(memoryStore(), server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "");

    expect(screen.getByRole("alert")).toHaveTextContent("Ingresa usuario y contraseña.");
    expect(server.calls).toHaveLength(0);
  });

  it("con la contraseña equivocada no dice si el usuario existe", async () => {
    const server = fakeServer({ status: 401, body: { message: "Credenciales inválidas" } });
    await renderApp(memoryStore(), server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "otra-clave");

    expect(await screen.findByRole("alert")).toHaveTextContent("Usuario o contraseña incorrectos.");
  });

  it("un usuario de oficina ve «Solo choferes» y queda en el ingreso", async () => {
    const store = memoryStore();
    const server = fakeServer({ status: 403, body: { message: "La app es solo para choferes" } });
    await renderApp(store, server);
    await screen.findByLabelText("Usuario");

    await fillLogin("oficina", "una-clave");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo choferes. La oficina entra por la web.",
    );
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeOnTheScreen();
    expect(store.value).toBeNull();
  });

  it("sin señal al ingresar pide revisar la señal", async () => {
    const server = fakeServer(new TypeError("Network request failed"));
    await renderApp(memoryStore(), server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "una-clave");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar con el servidor. Revisa tu señal e inténtalo de nuevo.",
    );
  });

  it("otro error del servidor muestra su mensaje", async () => {
    const server = fakeServer({ status: 429, body: { message: "Demasiados intentos" } });
    await renderApp(memoryStore(), server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "una-clave");

    expect(await screen.findByRole("alert")).toHaveTextContent("Demasiados intentos");
  });
});

describe("la sesión de 30 días al abrir la app", () => {
  it("con un refresh guardado entra directo, sin pedir la contraseña", async () => {
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(memoryStore("refresh-guardado"), server);

    expect(await screen.findByRole("header", { name: "Hola, chofer.juan" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
  });

  it("sin señal entra igual: la sesión sigue abierta", async () => {
    const store = memoryStore("refresh-guardado");
    await renderApp(store, fakeServer(new TypeError("Network request failed")));

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe("refresh-guardado");
  });

  it("un error del servidor al abrir tampoco cierra la sesión", async () => {
    const store = memoryStore("refresh-guardado");
    await renderApp(store, fakeServer({ status: 503 }));

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe("refresh-guardado");
  });

  it("si la señal se corta justo después de ingresar, queda adentro igual", async () => {
    const store = memoryStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-1", refreshToken: "refresh-1" } },
      new TypeError("Network request failed"),
    );
    await renderApp(store, server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "una-clave");

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe("refresh-1");
  });

  it("si el administrador cortó la sesión desde «Usuarios», vuelve al ingreso avisando que venció", async () => {
    const store = memoryStore("refresh-revocado");
    await renderApp(
      store,
      fakeServer({ status: 401, body: { message: "Credenciales inválidas" } }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tu sesión venció. Vuelve a ingresar.",
    );
    expect(store.value).toBeNull();
  });

  it("si le sacaron el rol de chofer, vuelve al ingreso con «Solo choferes»", async () => {
    const store = memoryStore("refresh-guardado");
    await renderApp(
      store,
      fakeServer({ status: 403, body: { message: "La app es solo para choferes" } }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo choferes. La oficina entra por la web.",
    );
    expect(store.value).toBeNull();
  });

  it("si el almacenamiento seguro no se puede leer, pide ingresar sin avisos", async () => {
    const store = memoryStore();
    store.read = () => Promise.reject(new Error("Keystore no disponible"));
    await renderApp(store, fakeServer());

    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si no se pudo borrar el refresh, avisa y deja intentar de nuevo", async () => {
    const store = memoryStore("refresh-guardado");
    store.clear = () => Promise.reject(new Error("Keystore no disponible"));
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(store, server);
    await screen.findByRole("header", { name: "Hola, chofer.juan" });

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cerrar la sesión. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("cerrar sesión borra el refresh y vuelve al ingreso sin el aviso de vencida", async () => {
    const store = memoryStore("refresh-guardado");
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(store, server);
    await screen.findByRole("header", { name: "Hola, chofer.juan" });

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByLabelText("Usuario")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(store.value).toBeNull();
  });
});
