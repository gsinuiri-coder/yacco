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
    links: [
      { label: "Panel", icon: "i-lucide-layout-dashboard", to: "/" },
      { label: "Clientes", icon: "i-lucide-users", to: "/customers" },
      { label: "Pedidos", icon: "i-lucide-clipboard-list", to: "/orders" },
      { label: "Rutas", icon: "i-lucide-truck", to: "/routes" },
      { label: "Pagos", icon: "i-lucide-wallet", to: "/payments" },
    ],
  },
  {
    label: "Envases y producción",
    links: [
      { label: "Producción", icon: "i-lucide-factory", to: "/production" },
      { label: "Tipos de envase", icon: "i-lucide-package", to: "/container-types" },
      { label: "Inventario de envases", icon: "i-lucide-package-open", to: "/inventory" },
      {
        label: "Envases en poder de clientes",
        icon: "i-lucide-clipboard-check",
        to: "/container-counts",
      },
      {
        label: "Movimientos de envases",
        icon: "i-lucide-package-search",
        to: "/container-movements",
      },
      {
        label: "Cuadre de envases",
        icon: "i-lucide-scale",
        to: "/container-reconciliation",
        onlyFor: "ADMIN",
      },
    ],
  },
  {
    // HU-19, HU-20, HU-21: la spec los pide para el administrador, y la API
    // los reserva a ese rol.
    label: "Reportes",
    links: [
      {
        label: "Deuda por cliente",
        icon: "i-lucide-hand-coins",
        to: "/reports/debt",
        onlyFor: "ADMIN",
      },
      {
        label: "Envases prestados",
        icon: "i-lucide-container",
        to: "/reports/loaned-containers",
        onlyFor: "ADMIN",
      },
      {
        label: "Producción por período",
        icon: "i-lucide-chart-no-axes-column",
        to: "/reports/production",
        onlyFor: "ADMIN",
      },
    ],
  },
  {
    label: "Administración",
    links: [
      { label: "Zonas", icon: "i-lucide-map-pin", to: "/zones" },
      { label: "Usuarios", icon: "i-lucide-user-cog", to: "/users" },
    ],
  },
];

export function visibleNavigation(roles: readonly UserRole[]): NavigationSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    links: section.links.filter((link) => !link.onlyFor || roles.includes(link.onlyFor)),
  })).filter((section) => section.links.length > 0);
}
