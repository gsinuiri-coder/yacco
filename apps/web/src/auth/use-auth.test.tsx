import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL } from "../config";
import { server } from "../test/server";
import { buildToken } from "../test/tokens";
import { AuthProvider } from "./auth-provider";
import { useAuth } from "./use-auth";

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

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

  describe("sessionExpired", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    // Esta es la distinción por la que existe el cambio: un logout a
    // propósito nunca debe leerse como una sesión vencida.
    it("un logout manual NO deja marcada la sesión como expirada", async () => {
      localStorage.setItem("yacco.refreshToken", "refresh-valido");
      server.use(
        http.post(`${API_BASE_URL}/auth/refresh`, () =>
          HttpResponse.json({ accessToken: buildToken() }),
        ),
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.isRestoringSession).toBe(false));
      expect(result.current.user).not.toBeNull();

      act(() => {
        result.current.logout();
      });

      await waitFor(() => expect(result.current.user).toBeNull());
      expect(result.current.sessionExpired).toBe(false);
    });

    it("un refresh token vencido al restaurar la sesión sí la deja marcada como expirada", async () => {
      localStorage.setItem("yacco.refreshToken", "refresh-vencido");
      server.use(
        http.post(`${API_BASE_URL}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.isRestoringSession).toBe(false));

      expect(result.current.user).toBeNull();
      expect(result.current.sessionExpired).toBe(true);
    });
  });
});
