import { useEffect, useState } from "react";
import { getAccountStatement } from "../api/account-statement";
import type { AccountStatementEntry } from "../api/account-statement";
import { useAuth } from "../auth/use-auth";
import { formatBusinessDateTime } from "../lib/business-date";
import { formatMoney } from "../lib/money";
import { ErrorState } from "./error-state";

export interface CustomerAccountStatementSectionProps {
  customerId: string;
  /**
   * La ficha sube este contador cada vez que registra un cobro
   * (CustomerPaymentSection.onPaymentRegistered) para forzar una recarga:
   * un pago nuevo puede agregar una fila y mover closingBalance, y esta
   * sección no tiene otra forma de enterarse. Mismo mecanismo que
   * `reloadToken` de abajo, solo que ese lo dispara el propio botón
   * "Reintentar" de esta sección.
   */
  refreshSignal?: number;
}

const ENTRY_TYPE_LABELS: Record<AccountStatementEntry["type"], string> = {
  CHARGE: "Cargo",
  PAYMENT: "Abono",
};

type NonNullPaymentStatus = NonNullable<AccountStatementEntry["status"]>;

const PAYMENT_STATUS_LABELS: Record<NonNullPaymentStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  REJECTED: "Rechazado",
};

const PAYMENT_STATUS_BADGE_CLASS: Record<NonNullPaymentStatus, string> = {
  PENDING: "badge--warning",
  CONFIRMED: "badge--active",
  REJECTED: "badge--danger",
};

/**
 * Estado de cuenta (HU pendiente en backlog): cargos y abonos intercalados
 * de GET /customers/:id/account-statement, con el saldo corriente que ya
 * calcula el backend — no se recalcula acá. Mismo patrón que
 * CustomerPricesSection/CustomerPaymentSection: sección propia dentro de la
 * ficha, con su propio módulo de API.
 *
 * `openingBalance` del DTO NUNCA se muestra, a propósito: esta sección no
 * manda `from`, así que CustomersService.getAccountStatement lo deja fijo en
 * "0.00" para siempre (openingCaptured arranca en true cuando fromBoundary
 * es undefined) — no es "lo que el cliente debía antes de esta ventana", es
 * un cero que no representa historia real, y mostrárselo al dueño le diría
 * que cualquier cliente cargado del padrón arrancó en cero, lo cual es
 * falso. El arrastre real del padrón sigue visible como la fila con
 * isOpeningBalance en true dentro de `entries`. Si el día de mañana esta
 * pantalla ofrece un filtro `from`/`to`, openingBalance pasaría a
 * representar algo real y esta nota (y la razón para ignorarlo) quedaría
 * obsoleta — pero no lo agregues antes de eso.
 */
export function CustomerAccountStatementSection({
  customerId,
  refreshSignal,
}: CustomerAccountStatementSectionProps) {
  const { apiClient } = useAuth();

  const [entries, setEntries] = useState<AccountStatementEntry[]>([]);
  const [closingBalance, setClosingBalance] = useState("0.00");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    setIsLoading(true);
    setLoadError(null);

    getAccountStatement(apiClient, customerId)
      .then((statement) => {
        if (ignore) return;
        setEntries(statement.entries);
        setClosingBalance(statement.closingBalance);
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setLoadError(
            error instanceof Error ? error.message : "No se pudo cargar el estado de cuenta.",
          );
        }
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [apiClient, customerId, reloadToken, refreshSignal]);

  return (
    <section className="card">
      <div className="card__body">
        <div className="page-header">
          <h2>Estado de cuenta</h2>
          {!isLoading && loadError === null && (
            <span className="stat__value">{formatMoney(closingBalance)}</span>
          )}
        </div>

        {loadError !== null ? (
          <ErrorState message={loadError} onRetry={() => setReloadToken((token) => token + 1)} />
        ) : isLoading ? (
          <p className="state" role="status">
            Cargando estado de cuenta…
          </p>
        ) : entries.length === 0 ? (
          <p className="state">Sin movimientos todavía.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Estado de cuenta del cliente</caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Tipo</th>
                  <th scope="col" className="table__numeric">
                    Monto
                  </th>
                  <th scope="col" className="table__numeric">
                    Saldo
                  </th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.saleId ?? entry.paymentId ?? entry.date}>
                    <td>{formatBusinessDateTime(entry.date)}</td>
                    <td>
                      {ENTRY_TYPE_LABELS[entry.type]}
                      {entry.isOpeningBalance && (
                        <>
                          {" "}
                          <span className="badge badge--muted">Saldo inicial</span>
                        </>
                      )}
                    </td>
                    <td className="table__numeric">{formatMoney(entry.amount)}</td>
                    <td className="table__numeric">{formatMoney(entry.runningBalance)}</td>
                    <td>
                      {entry.type === "PAYMENT" ? (
                        <>
                          {entry.paymentMethodName}
                          {entry.status !== null && (
                            <>
                              {" "}
                              <span className={`badge ${PAYMENT_STATUS_BADGE_CLASS[entry.status]}`}>
                                {PAYMENT_STATUS_LABELS[entry.status]}
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        entry.locationName !== null && (
                          <span className="cell-secondary">{entry.locationName}</span>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
