import { useCallback, useEffect, useState } from "react";
import { getContainerReconciliation } from "../api/container-reconciliation";
import type {
  ContainerReconciliation,
  ContainerReconciliationDiscrepancy,
} from "../api/container-reconciliation";
import { ApiError } from "../api/errors";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ErrorState } from "../components/error-state";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDateTime } from "../lib/business-date";

/** "+3" / "-2": el signo dice de qué lado está el faltante. */
function formatDifference(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}

/**
 * Qué significa la diferencia, en una frase, para no obligar a nadie a
 * reconstruir la resta mentalmente. `difference` es
 * `ledgerQuantity - materializedQuantity`.
 */
function describeDifference(discrepancy: ContainerReconciliationDiscrepancy): string {
  const gap = Math.abs(discrepancy.difference);
  const unidades = gap === 1 ? "envase" : "envases";
  return discrepancy.difference > 0
    ? `Al saldo le ${gap === 1 ? "falta" : "faltan"} ${gap} ${unidades}`
    : `El saldo tiene ${gap} ${unidades} de más`;
}

/**
 * El cuadre de envases: `GET /container-reconciliation`.
 *
 * Lo que hace falta que la pantalla deje claro es QUÉ se compara contra QUÉ,
 * porque de eso depende que el resultado signifique algo. Son dos cuentas
 * independientes del mismo hecho:
 *
 * - el **libro de movimientos** (`container_movements`), sumado desde cero
 *   por una consulta SQL escrita aparte a propósito, y
 * - el **saldo que muestran las pantallas**
 *   (`customer_container_balances`), que el sistema mantiene al día
 *   movimiento por movimiento.
 *
 * Que la reconstrucción esté escrita independientemente del código que
 * materializa no es un detalle de implementación: si compartieran función,
 * el cuadre solo probaría que algo coincide consigo mismo. Por eso la
 * pantalla lo dice — "dos cuentas independientes" — en vez de hablar de
 * tablas.
 *
 * El resultado esperado es la lista vacía, así que ese estado se muestra
 * como una buena noticia y no como una pantalla que parece rota.
 *
 * Un saldo NEGATIVO en el que las dos cuentas coinciden no aparece acá, y no
 * es un olvido: significa que el cliente devolvió más envases de los que el
 * libro decía que tenía, o sea que hubo una entrega sin registrar. Es un
 * hallazgo operativo real, pero no un descuadre de este cuadre. La pantalla
 * lo aclara para que nadie lo venga a buscar acá.
 */
export function ContainerReconciliationPage() {
  const { apiClient, user } = useAuth();
  const isAdmin = user?.roles.includes("ADMIN") ?? false;

  const [result, setResult] = useState<ContainerReconciliation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  useEffect(() => {
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    getContainerReconciliation(apiClient)
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // El 403 de Nest es genérico; el resto llega con su propio mensaje.
        setErrorMessage(
          error instanceof ApiError && error.status === 403
            ? "Solo un administrador puede correr el cuadre de envases."
            : error instanceof Error
              ? error.message
              : "No se pudo correr el cuadre de envases.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, isAdmin, reloadToken]);

  const recheck = useCallback(() => setReloadToken((token) => token + 1), []);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Cuadre de envases</h1>
          <p className="page-header__subtitle">
            {result === null
              ? "Compara el saldo de envases contra el libro de movimientos."
              : `Revisado el ${formatBusinessDateTime(result.checkedAt)}.`}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="button button--secondary"
            disabled={isLoading}
            onClick={recheck}
          >
            {isLoading ? "Revisando…" : "Volver a revisar"}
          </button>
        )}
      </div>

      {isAdmin ? (
        <>
          <ExplainerSection />

          <section className="card">
            <SlowRequestNotice show={isSlow && isLoading} />

            {errorMessage ? (
              <ErrorState message={errorMessage} onRetry={recheck} />
            ) : isLoading ? (
              <p className="state" role="status">
                Revisando el parque de envases…
              </p>
            ) : result === null ? null : result.discrepancies.length === 0 ? (
              <div className="state">
                <p className="state__title">Las dos cuentas coinciden</p>
                <p>
                  Ninguna ubicación tiene un saldo de envases distinto del que se desprende de sus
                  movimientos. El saldo que muestran las pantallas es confiable.
                </p>
              </div>
            ) : (
              <DiscrepancyTable result={result} />
            )}
          </section>
        </>
      ) : (
        <div className="state card">
          <p className="state__title">Este cuadre es solo para administradores</p>
          <p>
            Revisa el parque entero de envases y sirve para decidir si un saldo es confiable, así
            que lo corre el dueño de la planta.
          </p>
        </div>
      )}
    </AppShell>
  );
}

function ExplainerSection() {
  return (
    <section className="card">
      <div className="card__body">
        <h2>Qué se compara</h2>
        <p>
          Dos cuentas <strong>independientes</strong> del mismo hecho, hechas por caminos distintos
          a propósito:
        </p>
        <div className="form-grid">
          <div className="stat">
            <span className="stat__label">Según el libro</span>
            <span className="stat__value">Lo que pasó</span>
            <span className="stat__note">
              Cada entrega y cada devolución registrada, sumadas desde cero.
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Según el saldo</span>
            <span className="stat__value">Lo que el sistema muestra</span>
            <span className="stat__note">
              El número que ven las pantallas de envases y el estado de cuenta.
            </span>
          </div>
        </div>
        <p>
          Si las dos coinciden, el saldo es confiable. Si no, acá se ve exactamente dónde. Este
          cuadre <strong>informa y no corrige</strong>: reparar en silencio borraría el rastro de lo
          que salió mal.
        </p>
        <p className="cell-secondary">
          Un saldo negativo en el que las dos cuentas coinciden no aparece acá: no es un descuadre
          sino una entrega que nunca se registró, y se ve en el saldo de envases del cliente.
        </p>
      </div>
    </section>
  );
}

function DiscrepancyTable({ result }: { result: ContainerReconciliation }) {
  const count = result.discrepancyCount;

  return (
    <>
      <div className="card__body">
        <p className="notice notice--warning" role="status">
          {count === 1
            ? "Hay 1 saldo que no coincide con sus movimientos."
            : `Hay ${count} saldos que no coinciden con sus movimientos.`}{" "}
          Nada se corrigió: esto es lo que hay que revisar.
        </p>
      </div>
      <div className="table-scroll">
        <table className="table">
          <caption className="visually-hidden">
            Saldos de envases que no coinciden con el libro de movimientos
          </caption>
          <thead>
            <tr>
              <th scope="col">Ubicación</th>
              <th scope="col">Tipo de envase</th>
              <th scope="col" className="table__numeric">
                Según el libro
              </th>
              <th scope="col" className="table__numeric">
                Según el saldo
              </th>
              <th scope="col">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {result.discrepancies.map((discrepancy) => (
              <tr
                key={`${discrepancy.locationId ?? "sin-ubicacion"}-${discrepancy.containerTypeId}`}
              >
                <td>
                  {discrepancy.locationName === null ? (
                    <>
                      <div className="cell-primary">Ubicación desconocida</div>
                      {/* El nombre nulo ES el hallazgo: el movimiento apunta a
                          una ubicación que no existe, o a ninguna. Se muestra
                          el id crudo porque es lo único que hay para
                          rastrearlo. */}
                      <div className="cell-secondary">
                        {discrepancy.locationId ?? "el movimiento no indica ubicación"}
                      </div>
                    </>
                  ) : (
                    <div className="cell-primary">{discrepancy.locationName}</div>
                  )}
                </td>
                <td>
                  {discrepancy.containerTypeName === null ? (
                    <>
                      <div className="cell-primary">Tipo de envase desconocido</div>
                      <div className="cell-secondary">{discrepancy.containerTypeId}</div>
                    </>
                  ) : (
                    discrepancy.containerTypeName
                  )}
                </td>
                <td className="table__numeric">{discrepancy.ledgerQuantity}</td>
                <td className="table__numeric">{discrepancy.materializedQuantity}</td>
                <td>
                  <div className="cell-primary money--owed">
                    {formatDifference(discrepancy.difference)}
                  </div>
                  <div className="cell-secondary">{describeDifference(discrepancy)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
