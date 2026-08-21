import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createApiClient } from "../api/api-client";
import { decodeAccessToken } from "../api/decode-token";
import type { AuthenticatedUser, LoginRequest } from "../api/types";
import { API_BASE_URL } from "../config";
import { AuthContext } from "./auth-context";
import type { AuthContextValue } from "./auth-context";
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from "./token-storage";

export function AuthProvider({ children }: { children: ReactNode }) {
  // El access token vive en una ref, no en el estado: el apiClient necesita
  // leer siempre el valor vigente sin recrearse en cada renovación.
  const accessTokenRef = useRef<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  const applyAccessToken = useCallback((token: string | null) => {
    accessTokenRef.current = token;
    setUser(token ? decodeAccessToken(token) : null);
  }, []);

  const endSession = useCallback(() => {
    clearRefreshToken();
    applyAccessToken(null);
  }, [applyAccessToken]);

  const apiClient = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getAccessToken: () => accessTokenRef.current,
        getRefreshToken: readRefreshToken,
        onAccessTokenRefreshed: applyAccessToken,
        onSessionExpired: endSession,
      }),
    [applyAccessToken, endSession],
  );

  // Al recargar la página el access token en memoria se pierde; si queda un
  // refresh token en disco se canjea por uno nuevo antes de decidir si hay sesión.
  useEffect(() => {
    if (!readRefreshToken()) {
      setIsRestoringSession(false);
      return;
    }

    let cancelled = false;
    void apiClient
      .refreshAccessToken()
      .then((token) => {
        if (!cancelled) {
          applyAccessToken(token);
        }
      })
      .catch(() => {
        if (!cancelled) {
          endSession();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRestoringSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, applyAccessToken, endSession]);

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const tokens = await apiClient.login(credentials);
      writeRefreshToken(tokens.refreshToken);
      applyAccessToken(tokens.accessToken);
    },
    [apiClient, applyAccessToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, isRestoringSession, login, logout: endSession, apiClient }),
    [user, isRestoringSession, login, endSession, apiClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
