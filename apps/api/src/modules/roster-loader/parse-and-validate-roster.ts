import { parseCsv } from "./csv.js";
import type {
  Confidence,
  CustomerStatus,
  RosterContainerRow,
  RosterCustomer,
  RosterFileName,
  RosterIssue,
  RosterLocation,
  RosterMoneyRow,
  RosterParseResult,
} from "./roster-loader.types.js";

export interface RosterSourceFiles {
  customersText: string;
  locationsText: string;
  containersText: string;
  moneyText: string;
}

const CUSTOMERS_HEADER = ["external_code", "name", "phone", "zone", "status", "notes"];
const LOCATIONS_HEADER = [
  "location_code",
  "customer_code",
  "label",
  "address",
  "zone",
  "maps_url",
  "is_primary",
];
const CONTAINERS_HEADER = ["location_code", "qty_spout", "qty_no_spout", "confidence", "notes"];
const MONEY_HEADER = ["customer_code", "amount", "notes"];

/** A CSV row's cells, keyed by header name, plus where it came from. */
interface Record_ {
  line: number;
  cells: Record<string, string>;
}

/**
 * Turns raw CSV text into keyed records, pushing an issue instead of
 * throwing when the header doesn't match or a row has the wrong number of
 * columns — malformed rows are dropped from the returned list (harmless:
 * whenever `issues` ends up non-empty, `parseAndValidateRoster` discards
 * every parsed row anyway and writes nothing).
 */
function readRecords(
  file: RosterFileName,
  text: string,
  expectedHeader: string[],
  issues: RosterIssue[],
): Record_[] {
  const { header, rows } = parseCsv(text);
  const headerMatches =
    header.length === expectedHeader.length &&
    header.every((cell, index) => cell.trim() === expectedHeader[index]);
  if (!headerMatches) {
    issues.push({
      file,
      line: 1,
      message: `Encabezado inesperado: se esperaba "${expectedHeader.join(",")}"`,
    });
    return [];
  }

  const records: Record_[] = [];
  for (const row of rows) {
    if (row.cells.length !== expectedHeader.length) {
      issues.push({
        file,
        line: row.line,
        message: `La fila tiene ${row.cells.length} columna(s); se esperaban ${expectedHeader.length}`,
      });
      continue;
    }
    const cells: Record<string, string> = {};
    expectedHeader.forEach((key, index) => {
      cells[key] = row.cells[index] ?? "";
    });
    records.push({ line: row.line, cells });
  }
  return records;
}

const ROSTER_AMOUNT_PATTERN = /^-?\d{1,8}(\.\d{1,2})?$/;

function parseCustomers(text: string, issues: RosterIssue[]): RosterCustomer[] {
  const file: RosterFileName = "customers.csv";
  const records = readRecords(file, text, CUSTOMERS_HEADER, issues);
  const seenCodes = new Map<string, number>();
  const customers: RosterCustomer[] = [];

  for (const { line, cells } of records) {
    const externalCode = cells.external_code?.trim() ?? "";
    if (externalCode === "") {
      issues.push({ file, line, message: "external_code vacío" });
      continue;
    }
    const firstLine = seenCodes.get(externalCode);
    if (firstLine !== undefined) {
      issues.push({
        file,
        line,
        message: `external_code duplicado: "${externalCode}" (también en la línea ${firstLine})`,
      });
      continue;
    }
    seenCodes.set(externalCode, line);

    const statusRaw = cells.status?.trim().toUpperCase() ?? "";
    if (statusRaw !== "ACTIVE" && statusRaw !== "INACTIVE") {
      issues.push({
        file,
        line,
        message: `status fuera de rango: "${cells.status}" (debe ser ACTIVE o INACTIVE)`,
      });
      continue;
    }
    const status: CustomerStatus = statusRaw;

    const zoneRaw = cells.zone?.trim() ?? "";
    customers.push({
      externalCode,
      name: cells.name?.trim() ?? "",
      phone: cells.phone?.trim() ?? "",
      zoneName: zoneRaw === "" ? null : zoneRaw,
      status,
      line,
    });
  }
  return customers;
}

function parseLocations(
  text: string,
  issues: RosterIssue[],
  customerCodes: ReadonlySet<string>,
): RosterLocation[] {
  const file: RosterFileName = "locations.csv";
  const records = readRecords(file, text, LOCATIONS_HEADER, issues);
  const seenLocationCodes = new Map<string, number>();
  const locations: RosterLocation[] = [];

  for (const { line, cells } of records) {
    const locationCode = cells.location_code?.trim() ?? "";
    if (locationCode === "") {
      issues.push({ file, line, message: "location_code vacío" });
      continue;
    }
    const firstLine = seenLocationCodes.get(locationCode);
    if (firstLine !== undefined) {
      issues.push({
        file,
        line,
        message: `location_code duplicado: "${locationCode}" (también en la línea ${firstLine})`,
      });
      continue;
    }
    seenLocationCodes.set(locationCode, line);

    const customerCode = cells.customer_code?.trim() ?? "";
    if (!customerCodes.has(customerCode)) {
      issues.push({
        file,
        line,
        message: `customer_code huérfano: "${customerCode}" no existe en customers.csv`,
      });
      continue;
    }

    const isPrimaryRaw = cells.is_primary?.trim().toUpperCase() ?? "";
    if (isPrimaryRaw !== "SI" && isPrimaryRaw !== "NO") {
      issues.push({
        file,
        line,
        message: `is_primary fuera de rango: "${cells.is_primary}" (debe ser SI o NO)`,
      });
      continue;
    }

    locations.push({
      locationCode,
      customerCode,
      label: cells.label?.trim() ?? "",
      // May legitimately be empty: not every address is known yet (CLAUDE.md
      // rule below only forbids offering an unknown catalog id — an address
      // is free text, and customer_locations.address is NOT NULL, so an
      // unknown one is stored as "", never invented).
      address: cells.address?.trim() ?? "",
      addressReference: cells.maps_url?.trim() ?? "",
      isPrimary: isPrimaryRaw === "SI",
      line,
    });
  }
  return locations;
}

/**
 * Cross-file: every customer must resolve to EXACTLY one primary location.
 * Needs both lists together, so it runs after both are parsed rather than
 * inside `parseLocations`.
 */
function validatePrimaryLocations(
  customers: readonly RosterCustomer[],
  locationsByCustomerCode: ReadonlyMap<string, RosterLocation[]>,
  issues: RosterIssue[],
): void {
  for (const customer of customers) {
    const locations = locationsByCustomerCode.get(customer.externalCode) ?? [];
    const primaries = locations.filter((location) => location.isPrimary);
    if (primaries.length === 0) {
      issues.push({
        file: "customers.csv",
        line: customer.line,
        message: `El cliente "${customer.externalCode}" no tiene ubicación primaria en locations.csv`,
      });
    } else if (primaries.length > 1) {
      for (const extra of primaries.slice(1)) {
        issues.push({
          file: "locations.csv",
          line: extra.line,
          message: `El cliente "${customer.externalCode}" tiene más de una ubicación primaria (locations.csv:${primaries[0]?.line})`,
        });
      }
    }
  }
}

function parseNonNegativeInt(raw: string | undefined): number | "invalid" | "negative" {
  const trimmed = raw?.trim() ?? "";
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-\d+$/.test(trimmed)) return "negative";
  return "invalid";
}

function parseContainers(
  text: string,
  issues: RosterIssue[],
  locationCodes: ReadonlySet<string>,
): RosterContainerRow[] {
  const file: RosterFileName = "opening_containers.csv";
  const records = readRecords(file, text, CONTAINERS_HEADER, issues);
  const seenLocationCodes = new Map<string, number>();
  const rows: RosterContainerRow[] = [];

  for (const { line, cells } of records) {
    const locationCode = cells.location_code?.trim() ?? "";
    if (locationCode === "") {
      issues.push({ file, line, message: "location_code vacío" });
      continue;
    }
    if (!locationCodes.has(locationCode)) {
      issues.push({
        file,
        line,
        message: `location_code huérfano: "${locationCode}" no existe en locations.csv`,
      });
      continue;
    }
    const firstLine = seenLocationCodes.get(locationCode);
    if (firstLine !== undefined) {
      issues.push({
        file,
        line,
        message: `location_code duplicado: "${locationCode}" (también en la línea ${firstLine})`,
      });
      continue;
    }
    seenLocationCodes.set(locationCode, line);

    const qtySpout = parseNonNegativeInt(cells.qty_spout);
    const qtyNoSpout = parseNonNegativeInt(cells.qty_no_spout);
    let hasQuantityIssue = false;
    for (const [column, value] of [
      ["qty_spout", qtySpout],
      ["qty_no_spout", qtyNoSpout],
    ] as const) {
      if (value === "negative") {
        issues.push({ file, line, message: `${column} no puede ser negativo: "${cells[column]}"` });
        hasQuantityIssue = true;
      } else if (value === "invalid") {
        issues.push({
          file,
          line,
          message: `${column} debe ser un número entero: "${cells[column]}"`,
        });
        hasQuantityIssue = true;
      }
    }
    if (hasQuantityIssue) continue;

    const confidenceRaw = cells.confidence?.trim().toUpperCase() ?? "";
    if (confidenceRaw !== "HIGH" && confidenceRaw !== "ESTIMATED") {
      issues.push({
        file,
        line,
        message: `confidence fuera de rango: "${cells.confidence}" (debe ser HIGH o ESTIMATED)`,
      });
      continue;
    }
    const confidence: Confidence = confidenceRaw;

    // Both branches above already excluded "negative"/"invalid".
    rows.push({
      locationCode,
      qtySpout: qtySpout as number,
      qtyNoSpout: qtyNoSpout as number,
      confidence,
      line,
    });
  }
  return rows;
}

function parseMoney(
  text: string,
  issues: RosterIssue[],
  customerCodes: ReadonlySet<string>,
): RosterMoneyRow[] {
  const file: RosterFileName = "opening_money.csv";
  const records = readRecords(file, text, MONEY_HEADER, issues);
  const seenCustomerCodes = new Map<string, number>();
  const rows: RosterMoneyRow[] = [];

  for (const { line, cells } of records) {
    const customerCode = cells.customer_code?.trim() ?? "";
    if (customerCode === "") {
      issues.push({ file, line, message: "customer_code vacío" });
      continue;
    }
    if (!customerCodes.has(customerCode)) {
      issues.push({
        file,
        line,
        message: `customer_code huérfano: "${customerCode}" no existe en customers.csv`,
      });
      continue;
    }
    const firstLine = seenCustomerCodes.get(customerCode);
    if (firstLine !== undefined) {
      issues.push({
        file,
        line,
        message: `customer_code duplicado: "${customerCode}" (también en la línea ${firstLine})`,
      });
      continue;
    }
    seenCustomerCodes.set(customerCode, line);

    const amountRaw = cells.amount?.trim() ?? "";
    // Blank = "no genera nada", the same as an explicit 0 — not an error.
    if (amountRaw === "") {
      rows.push({ customerCode, amount: "0", line });
      continue;
    }
    if (!ROSTER_AMOUNT_PATTERN.test(amountRaw)) {
      issues.push({ file, line, message: `amount no es un monto válido: "${amountRaw}"` });
      continue;
    }
    rows.push({ customerCode, amount: amountRaw, line });
  }
  return rows;
}

function groupByCustomerCode(locations: readonly RosterLocation[]): Map<string, RosterLocation[]> {
  const grouped = new Map<string, RosterLocation[]>();
  for (const location of locations) {
    const bucket = grouped.get(location.customerCode);
    if (bucket === undefined) {
      grouped.set(location.customerCode, [location]);
    } else {
      bucket.push(location);
    }
  }
  return grouped;
}

/**
 * Phase 1, in full: parses and cross-validates the 4 files, entirely in
 * memory, and returns EVERY issue found — never stops at the first one.
 * Only when `issues` is empty does the result carry a `roster`; a caller
 * must never act on the parsed rows otherwise (see each `parse*` helper's
 * comment: rows are dropped from their arrays on error, so a partial
 * `roster` would be actively wrong, not just incomplete).
 *
 * Does not touch the database: the container-type and loader-user
 * preconditions that also must pass before any write are checked
 * separately, in RosterLoaderService — this function is pure so it can be
 * unit-tested with literal CSV strings.
 */
export function parseAndValidateRoster(files: RosterSourceFiles): RosterParseResult {
  const issues: RosterIssue[] = [];

  const customers = parseCustomers(files.customersText, issues);
  const customerCodes = new Set(customers.map((customer) => customer.externalCode));

  const locations = parseLocations(files.locationsText, issues, customerCodes);
  const locationsByCustomerCode = groupByCustomerCode(locations);
  validatePrimaryLocations(customers, locationsByCustomerCode, issues);

  const locationCodes = new Set(locations.map((location) => location.locationCode));
  const containers = parseContainers(files.containersText, issues, locationCodes);
  const containersByLocationCode = new Map(
    containers.map((row) => [row.locationCode, row] as const),
  );

  const money = parseMoney(files.moneyText, issues, customerCodes);
  const moneyByCustomerCode = new Map(money.map((row) => [row.customerCode, row] as const));

  if (issues.length > 0) {
    return { issues };
  }
  return {
    issues: [],
    roster: { customers, locationsByCustomerCode, containersByLocationCode, moneyByCustomerCode },
  };
}
