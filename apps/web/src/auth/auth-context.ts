import { createContext } from "react";
import type { ApiClient } from "../api/api-client";
import type { AuthenticatedUser, LoginRequest } from "../api/types";

export interface AuthContextValue {
  user: AuthenticatedUser | null;
  /** Distingue "aún no sé si hay sesión" de "no hay sesión". */
  isRestoringSession: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  apiClient: ApiClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
