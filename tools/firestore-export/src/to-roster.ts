/**
 * Del `customers.json` del sistema viejo a los 4 CSV que lee `pnpm
 * load:roster` (apps/api/src/modules/roster-loader). Lo que se decidió y por
 * qué está en el supuesto 14 de docs/supuestos-por-validar.md; en corto:
 *
 * - `external_code` es el id del documento de Firestore: único y estable, y
 *   permite volver a correr la carga sin duplicar (el cargador es idempotente
 *   por ese código).
 * - Se DESCARTA solo lo que no se puede cargar sin inventar: sin nombre, un
 *   duplicado exacto (mismo nombre y mismo teléfono) o un cliente sin
 *   locación. Todo lo demás entra, y lo raro se AVISA: descartar por teléfono
 *   compartido dejaría afuera a clientes reales con deuda.
 * - Zona vacía: las etiquetas del sistema viejo mezclan zonas (PARQUE, SURCO)
 *   con categorías (EMPRESAS, DISTRIBUIDOR). Van a la columna `notes`, que
 *   el cargador lee pero NO guarda (backlog: «El cargador del padrón
 *   descarta las notas del cliente»).
 * - Envases: el sistema viejo no tiene saldos cargados (`containerBalances`
 *   vacío en todos), así que `opening_containers.csv` va vacío y los envases
 *   salen del conteo físico, no de un número inventado.
 * - Deuda: `debtAmount` a centavos exactos, con signo (negativa = saldo a favor).
 *
 * Nada de esto imprime datos de una persona: `report` son solo cuentas.
 */

export interface CustomerLocationDoc {
  id?: string;
  name?: string;
  address?: string;
  reference?: string;
  locationUrl?: string;
}

export interface CustomerDoc {
  id: string;
  data: {
    name?: string;
    phone?: string;
    isActive?: boolean;
    debtAmount?: number;
    tags?: string[];
    locations?: CustomerLocationDoc[];
  };
}

export type RosterFiles = Record<
  "customers.csv" | "locations.csv" | "opening_containers.csv" | "opening_money.csv",
  string
>;

export interface RosterReport {
  read: number;
  loaded: number;
  discarded: Record<string, number>;
  warnings: Record<string, number>;
}

const HEADERS = {
  customers: ["external_code", "name", "phone", "zone", "status", "notes"],
  locations: [
    "location_code",
    "customer_code",
    "label",
    "address",
    "zone",
    "maps_url",
    "is_primary",
  ],
  containers: ["location_code", "qty_spout", "qty_no_spout", "confidence", "notes"],
  money: ["customer_code", "amount", "notes"],
};

const MOBILE_PHONE = /^9\d{8}$/;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function normalized(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function digits(text: string): string {
  return text.replace(/\D/g, "");
}

/** `debtAmount` en centavos exactos: 148 -> "148.00", -12.5 -> "-12.50". */
function money(amount: number): string {
  const cents = Math.round(amount * 100);
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function count(tally: Record<string, number>, reason: string): void {
  tally[reason] = (tally[reason] ?? 0) + 1;
}

export function toRoster(docs: readonly CustomerDoc[]): {
  files: RosterFiles;
  report: RosterReport;
} {
  const discarded: Record<string, number> = {};
  const warnings: Record<string, number> = {};
  const seen = new Set<string>();
  const kept: CustomerDoc[] = [];

  for (const doc of docs) {
    const name = (doc.data.name ?? "").trim();
    const phone = digits(doc.data.phone ?? "");
    if (name === "") {
      count(discarded, "sin nombre");
      continue;
    }
    const identity = `${normalized(name)}|${phone}`;
    if (seen.has(identity)) {
      count(discarded, "duplicado exacto (mismo nombre y teléfono)");
      continue;
    }
    if ((doc.data.locations ?? []).length === 0) {
      count(discarded, "sin locación");
      continue;
    }
    seen.add(identity);
    kept.push(doc);
  }

  const customersByPhone = new Map<string, number>();
  for (const doc of kept) {
    const phone = digits(doc.data.phone ?? "");
    customersByPhone.set(phone, (customersByPhone.get(phone) ?? 0) + 1);
  }

  const customerRows: string[][] = [];
  const locationRows: string[][] = [];
  const moneyRows: string[][] = [];
  for (const doc of kept) {
    const phone = digits(doc.data.phone ?? "");
    if ((customersByPhone.get(phone) ?? 0) > 1)
      count(warnings, "teléfono compartido con otro cliente");
    if (!MOBILE_PHONE.test(phone)) count(warnings, "teléfono que no es un celular de 9 dígitos");

    const tags = doc.data.tags ?? [];
    customerRows.push([
      doc.id,
      (doc.data.name ?? "").trim(),
      (doc.data.phone ?? "").trim(),
      "",
      doc.data.isActive === false ? "INACTIVE" : "ACTIVE",
      tags.length > 0 ? `Etiquetas del sistema anterior: ${tags.join(", ")}` : "",
    ]);

    (doc.data.locations ?? []).forEach((location, index) => {
      const address = (location.address ?? "").trim();
      if (address === "") count(warnings, "sin dirección");
      locationRows.push([
        `${doc.id}-L${index + 1}`,
        doc.id,
        (location.name ?? "").trim() || "Principal",
        address,
        "",
        [location.reference, location.locationUrl]
          .map((part) => (part ?? "").trim())
          .filter((part) => part !== "")
          .join(" · "),
        index === 0 ? "SI" : "NO",
      ]);
    });

    const debt = doc.data.debtAmount ?? 0;
    if (Math.round(debt * 100) !== 0) {
      if (debt < 0) count(warnings, "saldo a favor");
      moneyRows.push([doc.id, money(debt), ""]);
    }
  }

  return {
    files: {
      "customers.csv": csv(HEADERS.customers, customerRows),
      "locations.csv": csv(HEADERS.locations, locationRows),
      "opening_containers.csv": csv(HEADERS.containers, []),
      "opening_money.csv": csv(HEADERS.money, moneyRows),
    },
    report: { read: docs.length, loaded: kept.length, discarded, warnings },
  };
}
