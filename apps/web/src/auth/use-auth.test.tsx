import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "./use-auth";

describe("useAuth", () => {
  it("falla si se usa fuera del AuthProvider", () => {
    // React escribe el error en consola antes de propagarlo; silenciarlo evita
    // ruido en el log de CI sin ocultar el fallo real del test.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth debe usarse dentro de <AuthProvider>",
    );

    consoleError.mockRestore();
  });
});
