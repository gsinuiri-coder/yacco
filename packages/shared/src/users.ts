import type { UserRole } from "./auth.js";

/** UserResponseDto. `passwordHash` never comes back. */
export interface User {
  id: string;
  name: string;
  username: string;
  active: boolean;
  roles: UserRole[];
  documentType?: string | null;
  documentNumber?: string | null;
  licenseNumber?: string | null;
  licenseCategory?: string | null;
  licenseExpiresOn?: string | null;
}

/** ListUsersQueryDto. Unpaginated; with no `active`, the API lists only active users. */
export interface UserListQuery {
  role?: UserRole;
  active?: boolean;
}

/** CreateUserDto: born active. */
export interface CreateUserBody {
  name: string;
  username: string;
  password: string;
  roles: UserRole[];
  documentType?: string;
  documentNumber?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresOn?: string;
}

/** UpdateUserDto: one change per PATCH on the users screen. */
export interface UpdateUserBody {
  name?: string;
  active?: boolean;
  password?: string;
  roles?: UserRole[];
  documentType?: string;
  documentNumber?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresOn?: string;
}

/** `@MinLength(8)` on both CreateUserDto.password and UpdateUserDto.password. */
export const MIN_PASSWORD_LENGTH = 8;
