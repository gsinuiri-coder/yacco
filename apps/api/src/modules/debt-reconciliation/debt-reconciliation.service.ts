import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { DebtReconciliationResponseDto } from "./dto/debt-reconciliation-response.dto.js";

interface DiscrepancyRow {
  customer_id: string | null;
  customer_name: string | null;
  ledger_balance: string;
  materialized_balance: string;
  difference: string;
}

@Injectable()
export class DebtReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * El cuadre del dinero: `customers.debt_balance` contra la deuda
   * reconstruida desde cero con SQL propio, escrito aparte de lo que la
   * materializa (`SalesService`, `PaymentsService`) para ser una segunda
   * opinión y no una función comprobándose a sí misma — el mismo diseño que
   * `ContainerReconciliationService`.
   *
   * La regla es la de todo el sistema: una venta no anulada suma su total; un
   * cobro CONFIRMED no anulado lo resta; un cobro PENDING o REJECTED no
   * cuenta. Los registros de apertura del padrón (`is_opening_balance`) entran
   * como cualquier otro: son cargos y abonos legítimos.
   *
   * `sales` no tiene `customer_id`: se agrupa por cliente a través de su
   * ubicación. `payments` sí lo tiene. Todos los joins de resolución son LEFT
   * y los cruces FULL OUTER, para que una fila huérfana aparezca en vez de
   * perderse. Informa y no repara. El dinero sale como texto con dos
   * decimales, nunca como número.
   */
  async check(): Promise<DebtReconciliationResponseDto> {
    const rows = await this.prisma.$queryRaw<DiscrepancyRow[]>`
      WITH sale_totals AS (
        SELECT location.customer_id, SUM(sale.total) AS total
        FROM sales AS sale
        LEFT JOIN customer_locations AS location ON location.id = sale.location_id
        WHERE sale.voided_at IS NULL
        GROUP BY location.customer_id
      ),
      payment_totals AS (
        SELECT customer_id, SUM(amount) AS total
        FROM payments
        WHERE status = 'CONFIRMED' AND voided_at IS NULL
        GROUP BY customer_id
      ),
      ledger AS (
        SELECT
          COALESCE(sale_totals.customer_id, payment_totals.customer_id) AS customer_id,
          COALESCE(sale_totals.total, 0) - COALESCE(payment_totals.total, 0) AS balance
        FROM sale_totals
        FULL OUTER JOIN payment_totals ON payment_totals.customer_id = sale_totals.customer_id
      )
      SELECT
        COALESCE(ledger.customer_id, customer.id) AS customer_id,
        customer.name AS customer_name,
        COALESCE(ledger.balance, 0)::numeric(14, 2)::text AS ledger_balance,
        COALESCE(customer.debt_balance, 0)::numeric(14, 2)::text AS materialized_balance,
        (COALESCE(ledger.balance, 0) - COALESCE(customer.debt_balance, 0))::numeric(14, 2)::text
          AS difference
      FROM ledger
      FULL OUTER JOIN customers AS customer ON customer.id = ledger.customer_id
      WHERE COALESCE(ledger.balance, 0) <> COALESCE(customer.debt_balance, 0)
      ORDER BY customer.name NULLS FIRST
    `;

    const discrepancies = rows.map((row) => ({
      customerId: row.customer_id,
      customerName: row.customer_name,
      ledgerBalance: row.ledger_balance,
      materializedBalance: row.materialized_balance,
      difference: row.difference,
    }));
    return { checkedAt: new Date(), discrepancyCount: discrepancies.length, discrepancies };
  }
}
