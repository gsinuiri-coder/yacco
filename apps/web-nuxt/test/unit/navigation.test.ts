import { describe, expect, it } from "vitest";
import { isDriverOnly, isPlantOnly, visibleNavigation } from "../../app/utils/navigation";
import {
  ROLE_EXPLANATION,
  ROLE_LABEL,
  ROLE_ORDER,
  describeRoles,
  toggleRole,
} from "../../app/utils/user";

describe("navigation utils", () => {
  it("isDriverOnly identifica al chofer que no tiene roles de oficina ni de planta", () => {
    expect(isDriverOnly(["DRIVER"])).toBe(true);
    expect(isDriverOnly(["DRIVER", "SELLER"])).toBe(false);
    expect(isDriverOnly(["DRIVER", "ADMIN"])).toBe(false);
    expect(isDriverOnly(["DRIVER", "PLANT_SUPERVISOR"])).toBe(false);
    expect(isDriverOnly(["DRIVER", "PLANT_OPERATOR"])).toBe(false);
    expect(isDriverOnly(["PLANT_SUPERVISOR"])).toBe(false);
  });

  it("isPlantOnly identifica a roles de planta exclusivos", () => {
    expect(isPlantOnly(["PLANT_SUPERVISOR"])).toBe(true);
    expect(isPlantOnly(["PLANT_OPERATOR"])).toBe(true);
    expect(isPlantOnly(["PLANT_SUPERVISOR", "PLANT_OPERATOR"])).toBe(true);
    expect(isPlantOnly(["PLANT_SUPERVISOR", "ADMIN"])).toBe(false);
    expect(isPlantOnly(["PLANT_OPERATOR", "SELLER"])).toBe(false);
    expect(isPlantOnly(["PLANT_OPERATOR", "DRIVER"])).toBe(false);
  });

  it("supervisor de planta ve solo producción, inventario y movimientos", () => {
    const nav = visibleNavigation(["PLANT_SUPERVISOR"]);
    expect(nav).toHaveLength(1);
    expect(nav[0]?.label).toBe("Envases y producción");
    const paths = nav[0]?.links.map((link) => link.to);
    expect(paths).toEqual(["/production", "/inventory", "/container-movements"]);
  });

  it("operador de planta ve solo producción e inventario", () => {
    const nav = visibleNavigation(["PLANT_OPERATOR"]);
    expect(nav).toHaveLength(1);
    expect(nav[0]?.label).toBe("Envases y producción");
    const paths = nav[0]?.links.map((link) => link.to);
    expect(paths).toEqual(["/production", "/inventory"]);
  });

  it("operador que además es chofer ve reparto y su parte de planta", () => {
    const nav = visibleNavigation(["PLANT_OPERATOR", "DRIVER"]);
    expect(nav).toHaveLength(2);
    expect(nav[0]?.label).toBe("Reparto");
    expect(nav[0]?.links.map((link) => link.to)).toEqual(["/my-route"]);
    expect(nav[1]?.label).toBe("Envases y producción");
    expect(nav[1]?.links.map((link) => link.to)).toEqual(["/production", "/inventory"]);
  });

  it("supervisor que además es chofer ve reparto y sus tres pantallas de planta", () => {
    const nav = visibleNavigation(["PLANT_SUPERVISOR", "DRIVER"]);
    expect(nav).toHaveLength(2);
    expect(nav[0]?.label).toBe("Reparto");
    expect(nav[0]?.links.map((link) => link.to)).toEqual(["/my-route"]);
    expect(nav[1]?.label).toBe("Envases y producción");
    expect(nav[1]?.links.map((link) => link.to)).toEqual([
      "/production",
      "/inventory",
      "/container-movements",
    ]);
  });

  it("operador que además es vendedor ve el menú completo de oficina", () => {
    const nav = visibleNavigation(["PLANT_OPERATOR", "SELLER"]);
    expect(nav.map((section) => section.label)).toEqual([
      "Día a día",
      "Envases y producción",
      "Reportes",
      "Administración",
    ]);
  });

  it("la cuenta de verificación no ve ningún menú", () => {
    expect(visibleNavigation(["VIEWER"])).toEqual([]);
  });
});

describe("user utils", () => {
  it("ROLE_LABEL contiene etiquetas legibles en español de los roles de planta", () => {
    expect(ROLE_LABEL.PLANT_SUPERVISOR).toBe("Supervisor de planta");
    expect(ROLE_LABEL.PLANT_OPERATOR).toBe("Operador de planta");
  });

  it("ROLE_ORDER incluye los roles asignables de planta", () => {
    expect(ROLE_ORDER).toContain("PLANT_SUPERVISOR");
    expect(ROLE_ORDER).toContain("PLANT_OPERATOR");
  });

  it("ROLE_EXPLANATION explica los roles de planta", () => {
    expect(ROLE_EXPLANATION.PLANT_SUPERVISOR).toContain("producción");
    expect(ROLE_EXPLANATION.PLANT_OPERATOR).toContain("producción");
  });

  it("describeRoles formatea roles en español", () => {
    expect(describeRoles(["PLANT_SUPERVISOR"])).toBe("Supervisor de planta");
    expect(describeRoles(["PLANT_OPERATOR"])).toBe("Operador de planta");
    expect(describeRoles(["ADMIN", "PLANT_SUPERVISOR"])).toBe(
      "Administrador, Supervisor de planta",
    );
  });

  it("toggleRole agrega o quita un rol", () => {
    expect(toggleRole([], "PLANT_SUPERVISOR")).toEqual(["PLANT_SUPERVISOR"]);
    expect(toggleRole(["PLANT_SUPERVISOR"], "PLANT_SUPERVISOR")).toEqual([]);
  });
});
