import * as SecureStore from "expo-secure-store";

import { REFRESH_TOKEN_KEY, secureTokenStore } from "../src/session/secure-token-store";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => "refresh-guardado"),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

describe("el refresh vive en el almacenamiento seguro del sistema", () => {
  it("lee, guarda y borra bajo una sola clave", async () => {
    expect(await secureTokenStore.read()).toBe("refresh-guardado");
    await secureTokenStore.write("refresh-nuevo");
    await secureTokenStore.clear();

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, "refresh-nuevo");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
  });
});
