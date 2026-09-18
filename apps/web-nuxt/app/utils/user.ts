import type { UserRole } from "@yacco/shared";

/** Vocabulario de la planta: nadie dice "SELLER". */
export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrador",
  SELLER: "Vendedor",
  DRIVER: "Chofer",
};

export const ROLE_ORDER: readonly UserRole[] = ["ADMIN", "SELLER", "DRIVER"];

/**
 * Qué habilita cada rol, en el vocabulario de la planta. Se muestra al
 * corregir roles porque el caso que más confunde no es agregar sino quitar:
 * sacarle "Chofer" a alguien que además es "Vendedor" NO le achica el
 * acceso a rutas, se lo agranda (un vendedor ve y opera TODAS las rutas).
 */
export const ROLE_EXPLANATION: Record<UserRole, string> = {
  ADMIN: "Ve y hace todo: precios, cobranzas, usuarios y el cuadre de envases.",
  SELLER: "Toma pedidos y planifica rutas. Ve y opera las rutas de todos los choferes.",
  DRIVER: "Sale a repartir. Ve y opera solo las rutas que tiene a su nombre.",
};

export function describeRoles(roles: readonly UserRole[]): string {
  return ROLE_ORDER.filter((role) => roles.includes(role))
    .map((role) => ROLE_LABEL[role])
    .join(", ");
}

export function toggleRole(roles: readonly UserRole[], role: UserRole): UserRole[] {
  return roles.includes(role) ? roles.filter((current) => current !== role) : [...roles, role];
}

export function sortUsersByName<T extends { name: string }>(users: readonly T[]): T[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
