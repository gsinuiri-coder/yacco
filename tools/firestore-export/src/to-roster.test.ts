import { describe, expect, it } from "vitest";
import { toRoster } from "./to-roster.js";
import type { CustomerDoc } from "./to-roster.js";

function doc(id: string, data: Partial<CustomerDoc["data"]> = {}): CustomerDoc {
  return {
    id,
    data: {
      name: `Cliente ${id}`,
      phone: "987654321",
      isActive: true,
      debtAmount: 0,
      tags: [],
      locations: [{ id: "l1", name: "Casa", address: "Jr. Uno 1", reference: "", locationUrl: "" }],
      ...data,
    },
  };
}

const lines = (csv: string) => csv.trim().split("\n");

describe("toRoster", () => {
  it("arma los 4 archivos con los encabezados que exige el cargador", () => {
    const { files } = toRoster([doc("a")]);

    expect(lines(files["customers.csv"])[0]).toBe("external_code,name,phone,zone,status,notes");
    expect(lines(files["locations.csv"])[0]).toBe(
      "location_code,customer_code,label,address,zone,maps_url,is_primary",
    );
    expect(lines(files["opening_containers.csv"])).toEqual([
      "location_code,qty_spout,qty_no_spout,confidence,notes",
    ]);
    expect(lines(files["opening_money.csv"])[0]).toBe("customer_code,amount,notes");
  });

  it("un cliente: su código es el id de Firestore, sin zona, activo, con su locación principal", () => {
    const { files } = toRoster([
      doc("abc", {
        tags: ["PARQUE", "EMPRESAS"],
        locations: [
          {
            id: "l9",
            name: "",
            address: "Av. Dos 2",
            reference: "Reja verde",
            locationUrl: "https://maps/x",
          },
        ],
      }),
    ]);

    expect(lines(files["customers.csv"])[1]).toBe(
      'abc,Cliente abc,987654321,,ACTIVE,"Etiquetas del sistema anterior: PARQUE, EMPRESAS"',
    );
    expect(lines(files["locations.csv"])[1]).toBe(
      "abc-L1,abc,Principal,Av. Dos 2,,Reja verde · https://maps/x,SI",
    );
  });

  it("la deuda va en centavos exactos, con signo: negativa es saldo a favor; cero no es fila", () => {
    const { files, report } = toRoster([
      doc("d", { debtAmount: 148 }),
      doc("c", { debtAmount: -12.5 }),
      doc("z", { debtAmount: 0 }),
    ]);

    expect(lines(files["opening_money.csv"]).slice(1)).toEqual(["d,148.00,", "c,-12.50,"]);
    expect(report.warnings["saldo a favor"]).toBe(1);
  });

  it("escapa comas y comillas como RFC4180", () => {
    const { files } = toRoster([doc("q", { name: 'Bodega "La Unión", Surco' })]);

    expect(lines(files["customers.csv"])[1]).toContain('"Bodega ""La Unión"", Surco"');
  });

  it("descarta sin nombre, duplicados exactos y sin locación, y dice por qué; el resto entra con aviso", () => {
    const { files, report } = toRoster([
      doc("ok1", { phone: "900000000" }),
      doc("ok2", { phone: "900000000" }),
      doc("sin-nombre", { name: "  " }),
      doc("dup", { name: "Cliente ok1", phone: "900000000" }),
      doc("sin-loc", { locations: [] }),
      doc("raro", {
        phone: "12345",
        locations: [{ id: "x", name: "", address: "", reference: "", locationUrl: "" }],
      }),
      doc("inactivo", { isActive: false }),
    ]);

    expect(report).toEqual({
      read: 7,
      loaded: 4,
      discarded: {
        "sin nombre": 1,
        "duplicado exacto (mismo nombre y teléfono)": 1,
        "sin locación": 1,
      },
      warnings: {
        "teléfono compartido con otro cliente": 2,
        "teléfono que no es un celular de 9 dígitos": 1,
        "sin dirección": 1,
      },
    });
    expect(
      lines(files["customers.csv"])
        .slice(1)
        .map((line) => line.split(",")[0]),
    ).toEqual(["ok1", "ok2", "raro", "inactivo"]);
    expect(lines(files["customers.csv"])[4]).toContain(",INACTIVE,");
  });
});
