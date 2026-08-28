/**
 * Contracts derived from apps/api/src/modules/users. Do not invent fields
 * here: if the API changes, this file is updated against the real DTOs.
 */
import type { ApiClient } from "./api-client";

/** Enum UserRole en Prisma. */
export type UserRole = "ADMIN" | "SELLER" | "DRIVER";

/** UserResponseDto: passwordHash nunca aparece en la respuesta. */
export interface User {
  id: string;
  name: string;
  username: string;
  active: boolean;
  roles: UserRole[];
}

/** ListUsersQueryDto. */
export interface UserListParams {
  role?: UserRole;
  active?: boolean;
}

function buildListQuery(params: UserListParams): string {
  const query = new URLSearchParams();
  if (params.role !== undefined) query.set("role", params.role);
  if (params.active !== undefined) query.set("active", String(params.active));
  return query.toString();
}

/**
 * Sin paginar: el endpoint devuelve un array plano. Con params vacíos, el
 * servidor ya filtra a los activos, igual que listZones/listPaymentMethods,
 * así que el select de chofer solo manda role=DRIVER.
 */
export function listUsers(apiClient: ApiClient, params: UserListParams = {}): Promise<User[]> {
  const query = buildListQuery(params);
  return apiClient.request<User[]>(`/users${query ? `?${query}` : ""}`);
}
