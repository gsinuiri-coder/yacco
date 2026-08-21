/**
 * Contratos derivados de apps/api/src/modules/auth. No inventar campos aquí:
 * si la API cambia, este archivo se actualiza contra los DTO reales.
 */

/** Roles emitidos por la API (enum UserRole en Prisma). */
export type UserRole = "ADMIN" | "SELLER" | "DRIVER";

/** Cuerpo de POST /auth/login (LoginDto). La API identifica por username, no por email. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** Respuesta de POST /auth/login (AuthTokensDto). */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Respuesta de POST /auth/refresh (RefreshResponseDto): solo renueva el access token. */
export interface RefreshResponse {
  accessToken: string;
}

/** Payload de los JWT firmados por AuthService. */
export interface AccessTokenPayload {
  sub: string;
  username: string;
  roles: UserRole[];
  type: "access" | "refresh";
}

/** Usuario tal como lo muestra la UI, derivado del access token. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  roles: UserRole[];
}
