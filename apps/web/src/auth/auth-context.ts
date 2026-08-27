import { createContext } from "react";
import type { ApiClient } from "../api/api-client";
import type { AuthenticatedUser, LoginRequest } from "../api/types";

export interface AuthContextValue {
  user: AuthenticatedUser | null;
  /** Distingue "aún no sé si hay sesión" de "no hay sesión". */
  isRestoringSession: boolean;
  /**
   * True cuando la sesión terminó porque venció (refresh fallido, en vivo o
   * al restaurarla al cargar la página) en vez de un logout manual desde
   * AppShell. ProtectedRoute la lleva a /login para que el aviso de sesión
   * vencida no aparezca cuando el usuario cerró sesión a propósito.
   */
  sessionExpired: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  apiClient: ApiClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
