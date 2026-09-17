/**
 * Auth contracts, derived from apps/api/src/modules/auth. Nothing here is
 * invented: when the API changes, this file changes against the real DTOs.
 */

/** Roles issued by the API (Prisma enum UserRole). */
export type UserRole = "ADMIN" | "SELLER" | "DRIVER";

/** Body of POST /auth/login (LoginDto). The API identifies by username, not email. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** Response of POST /auth/login (AuthTokensDto). */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Response of POST /auth/refresh: it only renews the access token. */
export interface RefreshResponse {
  accessToken: string;
}

/** Payload signed into both JWTs by AuthService. */
export interface AccessTokenPayload {
  sub: string;
  username: string;
  roles: UserRole[];
  type: "access" | "refresh";
}

/** The signed-in user as the UI shows it, read from the access token. */
export interface SessionUser {
  id: string;
  username: string;
  roles: UserRole[];
}
