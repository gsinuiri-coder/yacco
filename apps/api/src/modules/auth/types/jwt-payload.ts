import type { UserRole } from "@prisma/client";

export type JwtTokenType = "access" | "refresh";

export interface JwtPayload {
  sub: string;
  username: string;
  roles: UserRole[];
  type: JwtTokenType;
}
