import { HttpResponse, http } from "msw";
import type { UserRole } from "../api/types";
import { API_BASE_URL } from "../config";
import { server } from "./server";
import { buildToken } from "./tokens";

/**
 * Seeds a restored session the way AuthProvider expects to find one: a
 * refresh token on disk plus a refresh endpoint that hands back an access
 * token. Pages under ProtectedRoute need this before they render anything.
 */
export function signIn(roles: UserRole[] = ["ADMIN"]): void {
  localStorage.setItem("yacco.refreshToken", "refresh-valido");
  server.use(
    http.post(`${API_BASE_URL}/auth/refresh`, () =>
      HttpResponse.json({ accessToken: buildToken({ roles }) }),
    ),
  );
}
