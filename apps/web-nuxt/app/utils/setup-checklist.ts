import type { SetupChecklist } from "@yacco/shared";

/** Un pendiente de la tarjeta «Puesta en marcha»: qué falta y dónde se hace. */
export interface SetupChecklistItem {
  text: string;
  linkLabel: string;
  to: string;
}

const LIST_FORMAT = new Intl.ListFormat("es-PE", { style: "long", type: "conjunction" });

function names(references: { name: string }[]): string {
  return LIST_FORMAT.format(references.map((reference) => reference.name));
}

/**
 * Lo que le falta a la planta antes de operar con datos reales, en el orden
 * de docs/carga-datos-reales.md. Lista vacía: la tarjeta no se muestra.
 */
export function setupChecklistItems(checklist: SetupChecklist): SetupChecklistItem[] {
  const items: SetupChecklistItem[] = [];
  const users = { linkLabel: "Usuarios", to: "/users" };

  const prices = checklist.productsWithInitialListPrice;
  if (prices.length > 0) {
    items.push({
      text:
        prices.length === 1
          ? `El precio de ${names(prices)} sigue como se cargó al principio.`
          : `Los precios de ${names(prices)} siguen como se cargaron al principio.`,
      linkLabel: "Productos",
      to: "/products",
    });
  }
  if (checklist.activeDrivers === 0) {
    items.push({ text: "No hay ningún chofer activo.", ...users });
  }
  if (checklist.activeSellers === 0) {
    items.push({ text: "No hay nadie de oficina activo (rol Vendedor).", ...users });
  }
  if (checklist.activeTestUsers > 0) {
    items.push({
      text:
        checklist.activeTestUsers === 1
          ? "Queda 1 usuario de prueba activo: dalo de baja antes de empezar."
          : `Quedan ${checklist.activeTestUsers} usuarios de prueba activos: dalos de baja antes de empezar.`,
      ...users,
    });
  }
  const zones = checklist.zonesWithoutDeliveryDays;
  if (zones.length > 0) {
    items.push({
      text:
        zones.length === 1
          ? `La zona ${names(zones)} no tiene días de reparto.`
          : `Las zonas ${names(zones)} no tienen días de reparto.`,
      linkLabel: "Zonas",
      to: "/zones",
    });
  }
  if (checklist.uncountedLocations > 0) {
    items.push({
      text:
        checklist.uncountedLocations === 1
          ? "Falta contar los bidones de 1 ubicación de cliente."
          : `Falta contar los bidones de ${checklist.uncountedLocations} ubicaciones de clientes.`,
      linkLabel: "Envases en poder de clientes",
      to: "/container-counts?uncountedOnly=true",
    });
  }
  if (checklist.locationsWithoutCoordinates > 0) {
    items.push({
      text:
        checklist.locationsWithoutCoordinates === 1
          ? "Falta cargar la ubicación de 1 local."
          : `Falta cargar la ubicación de ${checklist.locationsWithoutCoordinates} locales.`,
      linkLabel: "Clientes",
      to: "/customers",
    });
  }
  if (checklist.activeTestCustomers > 0) {
    items.push({
      text:
        checklist.activeTestCustomers === 1
          ? "Queda 1 cliente de prueba activo (busca «PRUEBA»): dalo de baja antes de empezar."
          : `Quedan ${checklist.activeTestCustomers} clientes de prueba activos (busca «PRUEBA»): dalos de baja antes de empezar.`,
      linkLabel: "Clientes",
      to: "/customers",
    });
  }
  return items;
}
