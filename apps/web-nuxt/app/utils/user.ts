import type { UserRole } from "@yacco/shared";

/** Vocabulario de la planta: nadie dice "SELLER". */
export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrador",
  SELLER: "Vendedor",
  DRIVER: "Chofer",
  VIEWER: "Cuenta de verificación",
};

/** Los roles que se le asignan a una persona. VIEWER no: ver ROLE_DISPLAY_ORDER. */
export type AssignableRole = Exclude<UserRole, "VIEWER">;

/** Los que ofrecen el alta, la corrección de roles y el filtro de Usuarios. */
export const ROLE_ORDER: readonly AssignableRole[] = ["ADMIN", "SELLER", "DRIVER"];

/**
 * Para describir los roles de alguien que YA existe. VIEWER es la cuenta
 * técnica del smoke del deploy: no se ofrece nunca, pero si aparece en la
 * lista tiene que decir qué es y no quedar en blanco.
 */
const ROLE_DISPLAY_ORDER: readonly UserRole[] = [...ROLE_ORDER, "VIEWER"];

/**
 * Qué habilita cada rol, en el vocabulario de la planta. Se muestra al
 * corregir roles porque el caso que más confunde no es agregar sino quitar:
 * sacarle "Chofer" a alguien que además es "Vendedor" NO le achica el
 * acceso a rutas, se lo agranda (un vendedor ve y opera TODAS las rutas).
 */
export const ROLE_EXPLANATION: Record<AssignableRole, string> = {
  ADMIN: "Ve y hace todo: precios, cobranzas, usuarios y el cuadre de envases.",
  SELLER: "Toma pedidos y planifica rutas. Ve y opera las rutas de todos los choferes.",
  DRIVER: "Sale a repartir. Ve y opera solo las rutas que tiene a su nombre.",
};

export function describeRoles(roles: readonly UserRole[]): string {
  return ROLE_DISPLAY_ORDER.filter((role) => roles.includes(role))
    .map((role) => ROLE_LABEL[role])
    .join(", ");
}

export function toggleRole(roles: readonly UserRole[], role: UserRole): UserRole[] {
  return roles.includes(role) ? roles.filter((current) => current !== role) : [...roles, role];
}

export function sortUsersByName<T extends { name: string }>(users: readonly T[]): T[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
