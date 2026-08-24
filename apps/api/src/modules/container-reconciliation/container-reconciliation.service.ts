import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type {
  ContainerReconciliationDiscrepancyDto,
  ContainerReconciliationResponseDto,
} from "./dto/container-reconciliation-response.dto.js";

interface DiscrepancyRow {
  location_id: string | null;
  location_name: string | null;
  container_type_id: string;
  container_type_name: string | null;
  ledger_quantity: number;
  materialized_quantity: number;
}

@Injectable()
export class ContainerReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compares `customer_container_balances` (what the system currently
   * believes) against a fresh reconstruction from `container_movements`
   * (what actually happened) — a report, never a repair. Reporting instead
   * of fixing is deliberate: silently repairing would erase the evidence of
   * whatever bug caused the mismatch, and this system's rule is that
   * discrepancies get recorded, never suppressed. Deciding to repair one is
   * a separate, explicit decision for another PR.
   *
   * Deliberately hand-written SQL, not a call into
   * `ContainerMovementsService.createWithinTransaction` and not a function
   * shared with it: if reconciliation reused the code that materializes the
   * balance, this would only ever prove that a function agrees with
   * itself — a bug in that shared logic would pass every single time.
   * Written independently, this is a second opinion on the same ledger: it
   * is exactly the check that would have caught the upsert/`increment` bug
   * from S2 (see the comment in `ContainerMovementsService.createWithinTransaction`
   * on why it reads the balance and writes the absolute result instead of
   * using Prisma's `upsert` `increment`, which silently overwrote instead of
   * adding) the day it shipped, instead of relying on someone noticing a
   * customer's balance was wrong.
   *
   * The reconstruction rule mirrors exactly what the movements service
   * applies when a movement touches a balance: only movements with
   * `WITH_CUSTOMER` on one side count; add the quantity when
   * `WITH_CUSTOMER` is the destination, subtract it when it is the origin;
   * group by (location, container type). No type in the transition matrix
   * has `WITH_CUSTOMER` on both `from_state` and `to_state`, so there is no
   * ambiguous case to resolve.
   *
   * The comparison is a FULL OUTER JOIN between that reconstruction and the
   * materialized balance, treating whichever side is absent as 0. Four
   * cases fall out of it:
   *   a) The pair exists on both sides with different quantities — a plain
   *      mismatch.
   *   b) The ledger has movements but there is no balance row — a mismatch:
   *      materialization never ran, or the row was lost.
   *   c) A balance row exists with no movements behind it at all — a
   *      mismatch, and the worst kind: a balance with no originating ledger
   *      entry, exactly what an append-only ledger exists to make
   *      impossible.
   *   d) The reconstruction is 0 and the row is absent, OR the
   *      reconstruction is 0 and the row is 0 — MATCHES, not reported. A
   *      zero-quantity row is legitimate (5 delivered, 5 picked back up)
   *      and so is having no row at all (the pair was never touched). This
   *      is the obvious false positive this routine must never produce, so
   *      the WHERE below excludes it by construction: a pair untouched on
   *      both sides never even appears in this query's output.
   */
  async check(): Promise<ContainerReconciliationResponseDto> {
    const rows = await this.prisma.$queryRaw<DiscrepancyRow[]>`
      WITH ledger AS (
        SELECT
          location_id,
          container_type_id,
          SUM(
            CASE
              WHEN to_state = 'WITH_CUSTOMER' THEN quantity
              WHEN from_state = 'WITH_CUSTOMER' THEN -quantity
              ELSE 0
            END
          )::integer AS ledger_quantity
        FROM container_movements
        WHERE from_state = 'WITH_CUSTOMER' OR to_state = 'WITH_CUSTOMER'
        GROUP BY location_id, container_type_id
      )
      SELECT
        COALESCE(ledger.location_id, balance.location_id) AS location_id,
        location.name AS location_name,
        COALESCE(ledger.container_type_id, balance.container_type_id) AS container_type_id,
        container_type.name AS container_type_name,
        COALESCE(ledger.ledger_quantity, 0)::integer AS ledger_quantity,
        COALESCE(balance.quantity, 0)::integer AS materialized_quantity
      FROM ledger
      FULL OUTER JOIN customer_container_balances AS balance
        ON balance.location_id = ledger.location_id
        AND balance.container_type_id = ledger.container_type_id
      -- LEFT JOIN, not INNER: an INNER JOIN would silently drop any row
      -- whose location_id/container_type_id doesn't resolve — including a
      -- WITH_CUSTOMER movement with a NULL location_id. The movements
      -- service's own guard makes that impossible today, but this routine
      -- exists precisely so it never has to trust that invariant: a check
      -- that produces false negatives is worse than no check at all,
      -- because it manufactures confidence. An orphaned row must show up,
      -- never silently disappear.
      LEFT JOIN customer_locations AS location
        ON location.id = COALESCE(ledger.location_id, balance.location_id)
      LEFT JOIN container_types AS container_type
        ON container_type.id = COALESCE(ledger.container_type_id, balance.container_type_id)
      WHERE COALESCE(ledger.ledger_quantity, 0) <> COALESCE(balance.quantity, 0)
      ORDER BY location.name, container_type.name
    `;

    const discrepancies: ContainerReconciliationDiscrepancyDto[] = rows.map((row) => ({
      locationId: row.location_id,
      locationName: row.location_name,
      containerTypeId: row.container_type_id,
      containerTypeName: row.container_type_name,
      ledgerQuantity: row.ledger_quantity,
      materializedQuantity: row.materialized_quantity,
      difference: row.ledger_quantity - row.materialized_quantity,
    }));

    return {
      checkedAt: new Date(),
      discrepancyCount: discrepancies.length,
      discrepancies,
    };
  }
}
