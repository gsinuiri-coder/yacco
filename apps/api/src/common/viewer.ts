import { UserRole } from "@prisma/client";
import type { AuthenticatedRequest } from "../modules/auth/types/authenticated-request.js";

/** Quién está leyendo: su id y sus roles, tal como vienen en el token. */
export interface Viewer {
  id: string;
  roles: readonly UserRole[];
}

export function viewerFrom(request: AuthenticatedRequest): Viewer {
  return { id: request.user.sub, roles: request.user.roles };
}

/**
 * La oficina (ADMIN o SELLER) ve todo. Quien no es de la oficina es un chofer,
 * y un chofer ve solo lo que pasa por sus rutas: el chequeo por recurso lo hace
 * cada servicio, porque RolesGuard solo conoce el rol, no el recurso.
 */
export function isOffice(viewer: Viewer): boolean {
  return viewer.roles.includes(UserRole.ADMIN) || viewer.roles.includes(UserRole.SELLER);
}
