import type { UserRole } from "@prisma/client";

export type JwtTokenType = "access" | "refresh";

export interface JwtPayload {
  sub: string;
  username: string;
  roles: UserRole[];
  type: JwtTokenType;
  /**
   * Solo en el refresh token: la `users.token_version` al emitirlo (D-024). Un
   * token emitido antes de que existiera no la trae y se lee como 0.
   */
  tv?: number;
  /**
   * Solo en el refresh token de la app del chofer: dura 30 días y viaja en el
   * cuerpo, no en la cookie. Cada estrategia acepta únicamente el suyo.
   */
  client?: "mobile";
}
