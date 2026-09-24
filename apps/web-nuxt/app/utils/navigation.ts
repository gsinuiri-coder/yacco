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

/** La pantalla del chofer en la calle: sus rutas del día, en el celular. */
export const MY_ROUTE_PATH = "/my-route";
const MY_ROUTE: NavigationLink = { label: "Mi ruta", icon: "i-lucide-map", to: MY_ROUTE_PATH };

/**
 * Quien reparte y no es de la oficina. Para esa persona la app es «Mi ruta» y
 * nada más: el resto del menú son pantallas de la oficina que la API igual le
 * negaría (supuesto 12 de docs/supuestos-por-validar.md).
 */
export function isDriverOnly(roles: readonly UserRole[]): boolean {
  return roles.includes("DRIVER") && !roles.includes("ADMIN") && !roles.includes("SELLER");
}

export function visibleNavigation(roles: readonly UserRole[]): NavigationSection[] {
  if (isDriverOnly(roles)) return [{ label: "Reparto", links: [MY_ROUTE] }];
  return NAVIGATION.map((section, index) => ({
    ...section,
    links: [
      ...section.links.filter((link) => !link.onlyFor || roles.includes(link.onlyFor)),
      // Alguien de la oficina que además reparte también tiene su ruta a mano.
      ...(index === 0 && roles.includes("DRIVER") ? [MY_ROUTE] : []),
    ],
  })).filter((section) => section.links.length > 0);
}
