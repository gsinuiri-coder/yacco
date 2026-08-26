import { Prisma } from "@prisma/client";
import { CONTAINER_TYPE_COLUMNS } from "./container-type-columns.js";
import type { ContainerTypeColumn } from "./container-type-columns.js";
import type { ValidatedRoster } from "./roster-loader.types.js";

export interface RosterAggregates {
  customers: { total: number; active: number; inactive: number };
  customersByZone: Map<string, number>;
  locations: { total: number };
  containerTotalsByType: Map<string, number>;
  pendingToCount: number;
  netDebtTotal: string;
}

const NO_ZONE_LABEL = "(sin zona)";

/**
 * Everything in `LoadSummary` that depends ONLY on the parsed roster, never
 * on what is already in the database — so it is identical whether this is
 * a dry run or a commit, and is pure (no PrismaService) on purpose: it is
 * fully exercised by unit tests with literal fixtures, unlike the
 * created/already-loaded counters in RosterLoaderService, which genuinely
 * need a database to answer.
 */
export function computeRosterAggregates(roster: ValidatedRoster): RosterAggregates {
  const customers = { total: roster.customers.length, active: 0, inactive: 0 };
  const customersByZone = new Map<string, number>();
  for (const customer of roster.customers) {
    if (customer.status === "ACTIVE") {
      customers.active += 1;
    } else {
      customers.inactive += 1;
    }
    const zone = customer.zoneName ?? NO_ZONE_LABEL;
    customersByZone.set(zone, (customersByZone.get(zone) ?? 0) + 1);
  }

  let locationsTotal = 0;
  for (const locations of roster.locationsByCustomerCode.values()) {
    locationsTotal += locations.length;
  }

  const containerTypeColumns = Object.entries(CONTAINER_TYPE_COLUMNS) as [
    ContainerTypeColumn,
    string,
  ][];
  const containerTotalsByType = new Map<string, number>();
  let pendingToCount = 0;
  for (const row of roster.containersByLocationCode.values()) {
    let touchedAny = false;
    for (const [column, typeName] of containerTypeColumns) {
      const quantity = column === "qtySpout" ? row.qtySpout : row.qtyNoSpout;
      if (quantity <= 0) continue;
      containerTotalsByType.set(typeName, (containerTotalsByType.get(typeName) ?? 0) + quantity);
      touchedAny = true;
    }
    // A location with everything at 0 got nothing written, so there is
    // nothing there to go count either.
    if (row.confidence === "ESTIMATED" && touchedAny) {
      pendingToCount += 1;
    }
  }

  let netDebt = new Prisma.Decimal(0);
  for (const row of roster.moneyByCustomerCode.values()) {
    netDebt = netDebt.plus(row.amount);
  }

  return {
    customers,
    customersByZone,
    locations: { total: locationsTotal },
    containerTotalsByType,
    pendingToCount,
    netDebtTotal: netDebt.toFixed(2),
  };
}
