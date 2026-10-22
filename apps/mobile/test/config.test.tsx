import { render, screen } from "@testing-library/react-native";

import { LOCAL_API_URL, resolveApiUrl } from "../src/config";
import { Root } from "../src/Root";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

describe("la URL de la API", () => {
  it("usa la que se fijó al armar el APK, sin la barra final", () => {
    expect(resolveApiUrl(" https://api.yacco.example/ ")).toBe("https://api.yacco.example");
  });

  it("sin configurar, apunta a la API local desde el emulador", () => {
    expect(resolveApiUrl(undefined)).toBe(LOCAL_API_URL);
    expect(resolveApiUrl("  ")).toBe(LOCAL_API_URL);
  });
});

describe("la app armada", () => {
  it("sin sesión guardada en el celular abre en el ingreso", async () => {
    await render(<Root />);

    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeOnTheScreen();
  });
});
