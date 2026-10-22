import { render, screen } from "@testing-library/react-native";

import { resolveApiUrl } from "../src/config";
import { Root, buildClient } from "../src/Root";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

describe("la URL de la API", () => {
  it("usa la que se fijó al armar el APK, sin las barras finales", () => {
    expect(resolveApiUrl(" https://api.yacco.example// ")).toBe("https://api.yacco.example");
  });

  it("sin configurar no inventa ninguna", () => {
    expect(resolveApiUrl(undefined)).toBeNull();
    expect(resolveApiUrl("  ")).toBeNull();
    expect(buildClient(undefined)).toBeNull();
  });
});

describe("la app armada", () => {
  it("con la URL configurada y sin sesión guardada abre en el ingreso", async () => {
    await render(<Root apiUrl="https://api.yacco.example" />);

    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeOnTheScreen();
  });

  it("armada sin la URL, lo dice en vez de intentar conectarse", async () => {
    await render(<Root apiUrl="" />);

    expect(
      await screen.findByRole("header", { name: "Falta la dirección del servidor" }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Ingresar" })).toBeNull();
  });
});
