import type { SetupChecklist } from "@yacco/shared";
import { describe, expect, it } from "vitest";
import { setupChecklistItems } from "../../app/utils/setup-checklist";

/** Una planta lista para operar: ningún pendiente. */
const READY: SetupChecklist & { locationsWithoutCoordinates: number } = {
  zonesWithoutDeliveryDays: [],
  activeDrivers: 2,
  activeSellers: 1,
  uncountedLocations: 0,
  locationsWithoutCoordinates: 0,
  activeTestUsers: 0,
  activeTestCustomers: 0,
  productsWithInitialListPrice: [],
};

function textsOf(
  overrides: Partial<SetupChecklist & { locationsWithoutCoordinates: number }>,
): string[] {
  return setupChecklistItems({ ...READY, ...overrides }).map((item) => item.text);
}

describe("setupChecklistItems", () => {
  it("sin pendientes no hay ítems: la tarjeta no se muestra", () => {
    expect(setupChecklistItems(READY)).toEqual([]);
  });

  it("zonas sin días, en singular y en plural, con enlace a Zonas", () => {
    expect(textsOf({ zonesWithoutDeliveryDays: [{ id: "z1", name: "Surco" }] })).toEqual([
      "La zona Surco no tiene días de reparto.",
    ]);
    const items = setupChecklistItems({
      ...READY,
      zonesWithoutDeliveryDays: [
        { id: "z1", name: "Surco" },
        { id: "z2", name: "Parque" },
      ],
    });
    expect(items).toEqual([
      {
        text: "Las zonas Surco y Parque no tienen días de reparto.",
        linkLabel: "Zonas",
        to: "/zones",
      },
    ]);
  });

  it("sin chofer o sin oficina activos lo dice, con enlace a Usuarios", () => {
    expect(setupChecklistItems({ ...READY, activeDrivers: 0, activeSellers: 0 })).toEqual([
      { text: "No hay ningún chofer activo.", linkLabel: "Usuarios", to: "/users" },
      {
        text: "No hay nadie de oficina activo (rol Vendedor).",
        linkLabel: "Usuarios",
        to: "/users",
      },
    ]);
  });

  it("ubicaciones sin contar enlazan a la lista filtrada", () => {
    expect(setupChecklistItems({ ...READY, uncountedLocations: 12 })).toEqual([
      {
        text: "Falta contar los bidones de 12 ubicaciones de clientes.",
        linkLabel: "Envases en poder de clientes",
        to: "/container-counts?uncountedOnly=true",
      },
    ]);
    expect(textsOf({ uncountedLocations: 1 })).toEqual([
      "Falta contar los bidones de 1 ubicación de cliente.",
    ]);
  });

  it("locales sin ubicación enlazan al padrón de clientes", () => {
    expect(
      setupChecklistItems({
        ...READY,
        locationsWithoutCoordinates: 12,
      }),
    ).toEqual([
      {
        text: "Falta cargar la ubicación de 12 locales.",
        linkLabel: "Clientes",
        to: "/customers",
      },
    ]);
    expect(textsOf({ locationsWithoutCoordinates: 1 })).toEqual([
      "Falta cargar la ubicación de 1 local.",
    ]);
  });

  it("usuarios y clientes de prueba activos piden darlos de baja", () => {
    expect(textsOf({ activeTestUsers: 3, activeTestCustomers: 1 })).toEqual([
      "Quedan 3 usuarios de prueba activos: dalos de baja antes de empezar.",
      "Queda 1 cliente de prueba activo (busca «PRUEBA»): dalo de baja antes de empezar.",
    ]);
    expect(textsOf({ activeTestUsers: 1, activeTestCustomers: 2 })).toEqual([
      "Queda 1 usuario de prueba activo: dalo de baja antes de empezar.",
      "Quedan 2 clientes de prueba activos (busca «PRUEBA»): dalos de baja antes de empezar.",
    ]);
  });

  it("precios de lista sin cambiar desde la carga, con enlace a Productos", () => {
    expect(
      setupChecklistItems({
        ...READY,
        productsWithInitialListPrice: [{ id: "p1", name: "Recarga 20L con caño" }],
      }),
    ).toEqual([
      {
        text: "El precio de Recarga 20L con caño sigue como se cargó al principio.",
        linkLabel: "Productos",
        to: "/products",
      },
    ]);
    expect(
      textsOf({
        productsWithInitialListPrice: [
          { id: "p1", name: "Bidón 20L con caño" },
          { id: "p2", name: "Bidón 20L sin caño" },
        ],
      }),
    ).toEqual([
      "Los precios de Bidón 20L con caño y Bidón 20L sin caño siguen como se cargaron al principio.",
    ]);
  });
});
