import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { ContainerMovementType, ContainerState, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerCountsService } from "../container-counts/container-counts.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { SalesService } from "../sales/sales.service.js";
import { CONTAINER_TYPE_COLUMNS } from "./container-type-columns.js";
import type { ContainerTypeColumn } from "./container-type-columns.js";
import { parseAndValidateRoster } from "./parse-and-validate-roster.js";
import type { RosterSourceFiles } from "./parse-and-validate-roster.js";
import { computeRosterAggregates } from "./roster-aggregates.js";
import type {
  LoadSummary,
  RosterIssue,
  RosterLocation,
  ValidatedRoster,
} from "./roster-loader.types.js";

export interface RunRosterLoaderOptions {
  dir: string;
  /** "AAAA-MM-DD", a calendar day in America/Lima — see `limaCutoverInstant`. */
  cutoverDate: string;
  /** Without this, nothing is ever written — the loader defaults to dry-run. */
  commit: boolean;
  /** Username stamped as recordedById/countedById on every write. Default: "admin". */
  loaderUsername?: string;
}

export type RunRosterLoaderResult =
  { ok: false; issues: RosterIssue[] } | { ok: true; summary: LoadSummary };

interface FlowCounts {
  created: number;
  alreadyLoaded: number;
}

const DEFAULT_LOADER_USERNAME = "admin";
const OPENING_PAYMENT_METHOD_NAME = "Apertura";
const CUTOVER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTAINER_TYPE_COLUMN_ENTRIES = Object.entries(CONTAINER_TYPE_COLUMNS) as [
  ContainerTypeColumn,
  string,
][];

/**
 * Lima has no DST and sits at a fixed UTC-5, so its midnight is always
 * 05:00 UTC — the same conversion `ContainerMovementsService` uses for a
 * business-day filter. `cutoverDate` arrives as "AAAA-MM-DD" (CLAUDE.md: a
 * calendar day, never run through `new Date(...)`, which parses it as UTC
 * midnight and reads back a day earlier in Lima). Every write this loader
 * backdates uses this exact instant, so a cutover at the end of a month
 * never lands in the wrong one.
 */
export function limaCutoverInstant(cutoverDate: string): Date {
  const match = CUTOVER_DATE_PATTERN.exec(cutoverDate);
  if (match === null) {
    throw new Error(`--cutover-date debe tener el formato AAAA-MM-DD, recibido: "${cutoverDate}"`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 5, 0, 0));
}

function readSourceFiles(dir: string): RosterSourceFiles {
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  return {
    customersText: read("customers.csv"),
    locationsText: read("locations.csv"),
    containersText: read("opening_containers.csv"),
    moneyText: read("opening_money.csv"),
  };
}

function primaryLocationOf(locations: readonly RosterLocation[]): RosterLocation {
  const primary = locations.find((location) => location.isPrimary);
  if (primary === undefined) {
    // parseAndValidateRoster already guarantees exactly one primary per
    // customer before a `roster` is ever returned; reaching here means that
    // invariant broke elsewhere, not a bad input — hence the loud throw
    // instead of a RosterIssue.
    throw new Error("Invariante roto: cliente sin ubicación primaria llegó a la fase de escritura");
  }
  return primary;
}

/**
 * Carga del padrón real: lee los 4 CSV (clientes, ubicaciones, envases y
 * deuda de apertura), valida TODO en memoria, y recién si no hay ningún
 * error escribe — orquestando los servicios de dominio reales
 * (ContainerMovementsService, ContainerCountsService, SalesService), nunca
 * reimplementando su lógica.
 *
 * Confidencialidad: el padrón son ~500 personas reales. `LoadSummary` es la
 * ÚNICA forma en que este servicio comunica lo que hizo, y solo contiene
 * agregados (conteos, sumas, totales por zona/tipo) — nunca un nombre, un
 * teléfono, una dirección ni un monto individual. `RosterIssue` identifica
 * cada error por archivo y línea; ver parse-and-validate-roster.ts.
 */
@Injectable()
export class RosterLoaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containerMovementsService: ContainerMovementsService,
    private readonly containerCountsService: ContainerCountsService,
    private readonly salesService: SalesService,
  ) {}

  async run(options: RunRosterLoaderOptions): Promise<RunRosterLoaderResult> {
    let cutoverInstant: Date;
    try {
      cutoverInstant = limaCutoverInstant(options.cutoverDate);
    } catch (error) {
      return {
        ok: false,
        issues: [{ file: "(config)", line: 0, message: (error as Error).message }],
      };
    }

    let files: RosterSourceFiles;
    try {
      files = readSourceFiles(options.dir);
    } catch (error) {
      return {
        ok: false,
        issues: [
          {
            file: "(config)",
            line: 0,
            message: `No se pudieron leer los archivos en "${options.dir}": ${(error as Error).message}`,
          },
        ],
      };
    }

    const parseResult = parseAndValidateRoster(files);
    if (parseResult.roster === undefined) {
      return { ok: false, issues: parseResult.issues };
    }
    const roster = parseResult.roster;

    const loaderUsername = options.loaderUsername ?? DEFAULT_LOADER_USERNAME;
    const preconditions = await this.checkPreconditions(loaderUsername);
    if (preconditions.issues.length > 0 || preconditions.loaderUserId === null) {
      return { ok: false, issues: preconditions.issues };
    }

    const aggregates = computeRosterAggregates(roster);

    if (!options.commit) {
      const flows = await this.readOnlyLoadState(roster, preconditions.containerTypeIdByColumn);
      return {
        ok: true,
        summary: { committed: false, ...aggregates, ...flows },
      };
    }

    const flows = await this.commitRoster(
      roster,
      cutoverInstant,
      preconditions.containerTypeIdByColumn,
      preconditions.loaderUserId,
    );
    return {
      ok: true,
      summary: { committed: true, ...aggregates, ...flows },
    };
  }

  /**
   * Read-only preconditions checked BEFORE any write, dry-run or not — the
   * task's "fail loudly in phase 1" for the container types applies to the
   * whole precondition set, not literally to file parsing alone (parsing
   * itself never touches the database). Returns issues in the exact same
   * shape file/line validation does, so a missing catalog entry is reported
   * next to a CSV mistake, not as a different kind of failure.
   */
  private async checkPreconditions(loaderUsername: string): Promise<{
    issues: RosterIssue[];
    containerTypeIdByColumn: Map<ContainerTypeColumn, string>;
    loaderUserId: string | null;
  }> {
    const issues: RosterIssue[] = [];
    const containerTypeIdByColumn = new Map<ContainerTypeColumn, string>();

    for (const [column, typeName] of CONTAINER_TYPE_COLUMN_ENTRIES) {
      const containerType = await this.prisma.containerType.findUnique({
        where: { name: typeName },
        select: { id: true },
      });
      if (containerType === null) {
        issues.push({
          file: "(config)",
          line: 0,
          message: `El tipo de envase "${typeName}" (columna ${column}) no existe en el catálogo`,
        });
      } else {
        containerTypeIdByColumn.set(column, containerType.id);
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { username: loaderUsername },
      select: { id: true },
    });
    let loaderUserId: string | null = null;
    if (user === null) {
      issues.push({
        file: "(config)",
        line: 0,
        message: `El usuario "${loaderUsername}" no existe (usa --user para indicar otro)`,
      });
    } else {
      loaderUserId = user.id;
    }

    return { issues, containerTypeIdByColumn, loaderUserId };
  }

  /**
   * Dry-run: same created/already-loaded split a commit would report, but
   * from READS only — resolved by the natural keys the source already
   * carries (external_code / location_code), never by writing anything
   * first. A location or customer that doesn't exist yet simply has no
   * matching movement/count/charge/credit either, so it counts as
   * "created" (would be).
   */
  private async readOnlyLoadState(
    roster: ValidatedRoster,
    containerTypeIdByColumn: ReadonlyMap<ContainerTypeColumn, string>,
  ): Promise<{
    containerMovements: FlowCounts;
    confirmatoryCounts: FlowCounts;
    openingCharges: FlowCounts;
    openingCredits: FlowCounts;
  }> {
    const containerMovements: FlowCounts = { created: 0, alreadyLoaded: 0 };
    const confirmatoryCounts: FlowCounts = { created: 0, alreadyLoaded: 0 };
    const openingCharges: FlowCounts = { created: 0, alreadyLoaded: 0 };
    const openingCredits: FlowCounts = { created: 0, alreadyLoaded: 0 };

    for (const customer of roster.customers) {
      const existingCustomer = await this.prisma.customer.findUnique({
        where: { externalCode: customer.externalCode },
        select: { id: true },
      });
      const customerId = existingCustomer?.id;

      const locations = roster.locationsByCustomerCode.get(customer.externalCode) ?? [];
      for (const location of locations) {
        const existingLocation = await this.prisma.customerLocation.findUnique({
          where: { externalCode: location.locationCode },
          select: { id: true },
        });
        const locationId = existingLocation?.id;
        const containerRow = roster.containersByLocationCode.get(location.locationCode);
        if (containerRow === undefined) continue;

        for (const [column] of CONTAINER_TYPE_COLUMN_ENTRIES) {
          const quantity = column === "qtySpout" ? containerRow.qtySpout : containerRow.qtyNoSpout;
          if (quantity <= 0) continue;
          const containerTypeId = containerTypeIdByColumn.get(column);
          if (containerTypeId === undefined) continue; // reported by checkPreconditions already

          const existingMovement =
            locationId === undefined
              ? null
              : await this.prisma.containerMovement.findFirst({
                  where: {
                    type: ContainerMovementType.OPENING_BALANCE,
                    locationId,
                    containerTypeId,
                  },
                  select: { id: true },
                });
          if (existingMovement !== null) {
            containerMovements.alreadyLoaded += 1;
          } else {
            containerMovements.created += 1;
          }

          if (containerRow.confidence !== "HIGH") continue;
          const existingCount =
            locationId === undefined
              ? null
              : await this.prisma.containerCount.findFirst({
                  where: { locationId, containerTypeId },
                  select: { id: true },
                });
          if (existingCount !== null) {
            confirmatoryCounts.alreadyLoaded += 1;
          } else {
            confirmatoryCounts.created += 1;
          }
        }
      }

      const moneyRow = roster.moneyByCustomerCode.get(customer.externalCode);
      if (moneyRow === undefined) continue;
      const amount = new Prisma.Decimal(moneyRow.amount);
      if (amount.isZero()) continue;

      const alreadyLoaded =
        customerId === undefined ? false : await this.hasOpeningEntry(customerId);
      const bucket = amount.gt(0) ? openingCharges : openingCredits;
      if (alreadyLoaded) {
        bucket.alreadyLoaded += 1;
      } else {
        bucket.created += 1;
      }
    }

    return { containerMovements, confirmatoryCounts, openingCharges, openingCredits };
  }

  private async hasOpeningEntry(customerId: string): Promise<boolean> {
    const existingCharge = await this.prisma.sale.findFirst({
      where: { isOpeningBalance: true, location: { customerId } },
      select: { id: true },
    });
    if (existingCharge !== null) return true;
    const existingCredit = await this.prisma.payment.findFirst({
      where: { isOpeningBalance: true, customerId },
      select: { id: true },
    });
    return existingCredit !== null;
  }

  /**
   * The write path. Order matches the spec exactly:
   *   1. Zones (upsert by name, shared across customers — not scoped to
   *      any one customer's transaction).
   *   2-4. Per customer, ONE transaction: customer + all its locations +
   *      all its opening-balance movements. A failure here leaves NOTHING
   *      for that customer written; the next customer is unaffected.
   *   4b. Confirmatory counts (HIGH confidence). Deliberately its own
   *      step, outside that transaction: ContainerCountsService.create()
   *      always opens its own (it has no external-client variant) —
   *      reusing it beats hand-rolling its balance-diff/adjustment logic.
   *      Idempotent by the pre-check below, so a crash between the
   *      transaction and this step is safe to retry.
   *   5. Money — same reasoning: SalesService's two methods are each
   *      already atomic, just not composable into an outer transaction.
   *   6. Deactivation, LAST: createOpeningCharge/-Credit both reject an
   *      inactive customer, and a customer who stopped buying can still
   *      owe money and hold containers on the street.
   */
  private async commitRoster(
    roster: ValidatedRoster,
    cutoverInstant: Date,
    containerTypeIdByColumn: ReadonlyMap<ContainerTypeColumn, string>,
    loaderUserId: string,
  ): Promise<{
    containerMovements: FlowCounts;
    confirmatoryCounts: FlowCounts;
    openingCharges: FlowCounts;
    openingCredits: FlowCounts;
  }> {
    const containerMovements: FlowCounts = { created: 0, alreadyLoaded: 0 };
    const confirmatoryCounts: FlowCounts = { created: 0, alreadyLoaded: 0 };
    const openingCharges: FlowCounts = { created: 0, alreadyLoaded: 0 };
    const openingCredits: FlowCounts = { created: 0, alreadyLoaded: 0 };

    // Step 1: zones.
    const zoneIdByName = new Map<string, string>();
    for (const customer of roster.customers) {
      if (customer.zoneName === null || zoneIdByName.has(customer.zoneName)) continue;
      const zone = await this.prisma.zone.upsert({
        where: { name: customer.zoneName },
        update: {},
        create: { name: customer.zoneName, deliveryDays: [] },
      });
      zoneIdByName.set(customer.zoneName, zone.id);
    }

    // Only needed if some customer has an opening credit, but cheap and
    // idempotent enough to always upsert up front rather than branch on it.
    // Always active: false, on both branches — this is a synthetic method
    // to satisfy Payment.paymentMethodId's FK for a debt/credit the customer
    // already carried at cutover, never a real way anyone chooses to collect
    // money. Now that GET /payment-methods exists, an active row here would
    // show up as a real collection option; `update` forces it back to false
    // even if a hand-made row (or an earlier version of this loader) left it
    // active — see the standalone deactivation migration for existing rows.
    const openingPaymentMethod = await this.prisma.paymentMethod.upsert({
      where: { name: OPENING_PAYMENT_METHOD_NAME },
      update: { active: false },
      create: { name: OPENING_PAYMENT_METHOD_NAME, active: false },
    });

    for (const customer of roster.customers) {
      const locations = roster.locationsByCustomerCode.get(customer.externalCode) ?? [];
      primaryLocationOf(locations); // throws loudly if the phase-1 invariant somehow broke

      const { customerId, locationIdByCode } = await this.prisma.$transaction(
        async (tx) => {
          const customerRow = await tx.customer.upsert({
            where: { externalCode: customer.externalCode },
            update: {
              name: customer.name,
              zoneId:
                customer.zoneName === null ? null : (zoneIdByName.get(customer.zoneName) ?? null),
            },
            create: {
              externalCode: customer.externalCode,
              name: customer.name,
              zoneId:
                customer.zoneName === null ? null : (zoneIdByName.get(customer.zoneName) ?? null),
              // Always active on create, even for a roster row marked
              // INACTIVE — see step 6 below for why.
              active: true,
            },
            select: { id: true },
          });

          const locationIdByCode = new Map<string, string>();
          for (const location of locations) {
            const locationRow = await tx.customerLocation.upsert({
              where: { externalCode: location.locationCode },
              update: {
                name: location.label,
                address: location.address,
                addressReference: location.addressReference,
                // locations.csv carries no phone column of its own — the
                // source records exactly one phone per customer
                // (customers.csv), and customer_locations.phone is NOT
                // NULL, so every location of a customer inherits it.
                phone: customer.phone,
                isPrimary: location.isPrimary,
              },
              create: {
                customerId: customerRow.id,
                externalCode: location.locationCode,
                name: location.label,
                address: location.address,
                addressReference: location.addressReference,
                phone: customer.phone,
                isPrimary: location.isPrimary,
              },
              select: { id: true },
            });
            locationIdByCode.set(location.locationCode, locationRow.id);

            const containerRow = roster.containersByLocationCode.get(location.locationCode);
            if (containerRow === undefined) continue;

            for (const [column, typeName] of CONTAINER_TYPE_COLUMN_ENTRIES) {
              const quantity =
                column === "qtySpout" ? containerRow.qtySpout : containerRow.qtyNoSpout;
              if (quantity <= 0) continue;
              const containerTypeId = containerTypeIdByColumn.get(column);
              if (containerTypeId === undefined) {
                throw new Error(
                  `Invariante roto: tipo de envase de la columna "${column}" (${typeName}) no resuelto`,
                );
              }

              const existingMovement = await tx.containerMovement.findFirst({
                where: {
                  type: ContainerMovementType.OPENING_BALANCE,
                  locationId: locationRow.id,
                  containerTypeId,
                },
                select: { id: true },
              });
              if (existingMovement !== null) {
                containerMovements.alreadyLoaded += 1;
                continue;
              }
              await this.containerMovementsService.createWithinTransaction(
                tx,
                {
                  type: ContainerMovementType.OPENING_BALANCE,
                  containerTypeId,
                  quantity,
                  toState: ContainerState.WITH_CUSTOMER,
                  locationId: locationRow.id,
                },
                loaderUserId,
                { occurredAt: cutoverInstant },
              );
              containerMovements.created += 1;
            }
          }

          return { customerId: customerRow.id, locationIdByCode };
        },
        { timeout: 20000 },
      );

      // Step 4b: confirmatory counts.
      for (const location of locations) {
        const containerRow = roster.containersByLocationCode.get(location.locationCode);
        if (containerRow === undefined || containerRow.confidence !== "HIGH") continue;
        const locationId = locationIdByCode.get(location.locationCode);
        if (locationId === undefined) continue;

        for (const [column] of CONTAINER_TYPE_COLUMN_ENTRIES) {
          const quantity = column === "qtySpout" ? containerRow.qtySpout : containerRow.qtyNoSpout;
          if (quantity <= 0) continue;
          const containerTypeId = containerTypeIdByColumn.get(column);
          if (containerTypeId === undefined) continue;

          const existingCount = await this.prisma.containerCount.findFirst({
            where: { locationId, containerTypeId },
            select: { id: true },
          });
          if (existingCount !== null) {
            confirmatoryCounts.alreadyLoaded += 1;
            continue;
          }
          await this.containerCountsService.create(
            { locationId, containerTypeId, countedQuantity: quantity },
            loaderUserId,
            { occurredAt: cutoverInstant },
          );
          confirmatoryCounts.created += 1;
        }
      }

      // Step 5: money.
      const moneyRow = roster.moneyByCustomerCode.get(customer.externalCode);
      if (moneyRow !== undefined) {
        const amount = new Prisma.Decimal(moneyRow.amount);
        if (!amount.isZero()) {
          const alreadyLoaded = await this.hasOpeningEntry(customerId);
          if (amount.gt(0)) {
            if (alreadyLoaded) {
              openingCharges.alreadyLoaded += 1;
            } else {
              await this.salesService.createOpeningCharge(
                {
                  customerId,
                  amount: amount.toFixed(2),
                  soldAt: cutoverInstant,
                  externalId: customer.externalCode,
                },
                loaderUserId,
              );
              openingCharges.created += 1;
            }
          } else {
            if (alreadyLoaded) {
              openingCredits.alreadyLoaded += 1;
            } else {
              await this.salesService.createOpeningCredit(
                {
                  customerId,
                  paymentMethodId: openingPaymentMethod.id,
                  amount: amount.abs().toFixed(2),
                  paidAt: cutoverInstant,
                },
                loaderUserId,
              );
              openingCredits.created += 1;
            }
          }
        }
      }

      // Step 6: deactivate LAST — see the method doc comment above.
      if (customer.status === "INACTIVE") {
        await this.prisma.customer.update({ where: { id: customerId }, data: { active: false } });
      }
    }

    return { containerMovements, confirmatoryCounts, openingCharges, openingCredits };
  }
}
