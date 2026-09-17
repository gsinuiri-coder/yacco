import type { UserRole } from "@yacco/shared";

export interface NavigationLink {
  label: string;
  icon: string;
  to: string;
  /** Si está, sólo lo ve quien tiene ese rol. */
  onlyFor?: UserRole;
}

export interface NavigationSection {
  label: string;
  links: NavigationLink[];
}

/**
 * La barra lateral, agrupada como se trabaja en la planta. Cada pantalla se
 * suma acá cuando se porta; un enlace a una pantalla que todavía no existe
 * sería un 404 disfrazado de menú.
 *
 * Un enlace se condiciona por rol SÓLO cuando la pantalla entera es de ese rol
 * (p. ej. el cuadre de envases es ADMIN): para una pantalla que todos pueden
 * leer, el control fino vive adentro de ella.
 */
export const NAVIGATION: NavigationSection[] = [
  {
    label: "Día a día",
    links: [{ label: "Panel", icon: "i-lucide-layout-dashboard", to: "/" }],
  },
];

export function visibleNavigation(roles: readonly UserRole[]): NavigationSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    links: section.links.filter((link) => !link.onlyFor || roles.includes(link.onlyFor)),
  })).filter((section) => section.links.length > 0);
}
