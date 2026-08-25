/**
 * A validation problem found in one of the 4 source files. Identified by
 * FILE and LINE, never by name — the roster is ~500 real people, and a
 * validation error is exactly the kind of message that ends up pasted into
 * a chat or a ticket. `line` counts the header as line 1, matching what a
 * person sees opening the file in a spreadsheet. `field`/`code` (business
 * identifiers like an external_code — not personal data) may appear in
 * `message` when they help locate the row; `name`, `phone`, `address` and
 * `amount` never do.
 */
export interface RosterIssue {
  file: RosterFileName | "(config)";
  line: number;
  message: string;
}

export type RosterFileName =
  "customers.csv" | "locations.csv" | "opening_containers.csv" | "opening_money.csv";

export type CustomerStatus = "ACTIVE" | "INACTIVE";
export type Confidence = "HIGH" | "ESTIMATED";

export interface RosterCustomer {
  externalCode: string;
  name: string;
  phone: string;
  /** Empty string in the source means "no zone" — normalized to null here. */
  zoneName: string | null;
  status: CustomerStatus;
  line: number;
}

export interface RosterLocation {
  locationCode: string;
  customerCode: string;
  label: string;
  /** May be empty: not every location's exact address is known yet. */
  address: string;
  /** From `maps_url` -> `customer_locations.address_reference`. May be empty. */
  addressReference: string;
  isPrimary: boolean;
  line: number;
}

export interface RosterContainerRow {
  locationCode: string;
  qtySpout: number;
  qtyNoSpout: number;
  confidence: Confidence;
  line: number;
}

export interface RosterMoneyRow {
  customerCode: string;
  /** Decimal string, sign preserved: positive = debt, negative = credit. */
  amount: string;
  line: number;
}

/**
 * The 4 files, parsed AND cross-validated: every reference resolves, every
 * enum is in range, every "exactly one primary" holds. Only produced when
 * there are zero issues — see `parseAndValidateRoster`. Locations are keyed
 * by customer, containers/money by their own row's key, so the loader never
 * re-scans the flat lists per customer.
 */
export interface ValidatedRoster {
  customers: RosterCustomer[];
  locationsByCustomerCode: ReadonlyMap<string, RosterLocation[]>;
  containersByLocationCode: ReadonlyMap<string, RosterContainerRow>;
  moneyByCustomerCode: ReadonlyMap<string, RosterMoneyRow>;
}

export type RosterParseResult =
  { issues: RosterIssue[]; roster?: undefined } | { issues: []; roster: ValidatedRoster };

/**
 * Aggregates only — this is the entire contract for what the loader is
 * allowed to print. No customer name, phone, address or amount ever flows
 * into any of these fields; see the module's README-style comment in
 * roster-loader.service.ts for the reasoning.
 */
export interface LoadSummary {
  committed: boolean;
  customers: { total: number; active: number; inactive: number };
  customersByZone: ReadonlyMap<string, number>;
  locations: { total: number };
  containerMovements: { created: number; alreadyLoaded: number };
  containerTotalsByType: ReadonlyMap<string, number>;
  confirmatoryCounts: { created: number; alreadyLoaded: number };
  pendingToCount: number;
  openingCharges: { created: number; alreadyLoaded: number };
  openingCredits: { created: number; alreadyLoaded: number };
  netDebtTotal: string;
}
