import { useCallback, useEffect, useState } from "react";
import { listContainerInventory } from "../api/container-inventory";
import type { ContainerInventoryItem } from "../api/container-inventory";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ErrorState } from "../components/error-state";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";
import {
  CONTAINER_STATE_LABELS,
  CONTAINER_STATE_ORDER,
  hasNegativeQuantity,
  pivotInventory,
  totalInventory,
} from "../lib/container-inventory";
import type { InventoryRow } from "../lib/container-inventory";

export function InventoryPage() {
  const { apiClient } = useAuth();
  const [items, setItems] = useState<ContainerInventoryItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    listContainerInventory(apiClient)
      .then((response) => {
        if (!cancelled) setItems(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error ? error.message : "No se pudo cargar el inventario.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const rows = items ? pivotInventory(items) : [];
  const total = totalInventory(rows);
  // Empty means the ledger has no rows at all — never "the quantities sum to
  // zero". Filling a batch with no prior fleet entry nets EMPTY_AT_PLANT and
  // FULL_AT_PLANT to exactly zero on real, present rows; a sum-based check
  // would misread that as "no movements yet" and hide the matrix.
  const isEmpty = items !== null && items.length === 0;
  const showNegativeNotice = hasNegativeQuantity(rows);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Inventario de envases</h1>
          <p className="page-header__subtitle">
            El total son los envases de la empresa: todo lo que entró menos lo que salió por venta,
            daño o pérdida.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card__body">
          <SlowRequestNotice show={isSlow && isLoading} />

          {errorMessage ? (
            <ErrorState message={errorMessage} onRetry={retry} />
          ) : isLoading ? (
            <p className="state" role="status">
              Cargando inventario…
            </p>
          ) : isEmpty ? (
            <EmptyState />
          ) : (
            <>
              {showNegativeNotice && (
                <div className="notice notice--warning" role="alert">
                  Hay valores negativos: se registraron más envases llenados que vacíos disponibles.
                  Faltan registrar entradas de envases.
                </div>
              )}

              <div className="table-scroll">
                <table className="table">
                  <caption className="visually-hidden">
                    Inventario de envases por tipo y estado
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Tipo de envase</th>
                      {CONTAINER_STATE_ORDER.map((state) => (
                        <th key={state} scope="col" className="table__numeric">
                          {CONTAINER_STATE_LABELS[state]}
                        </th>
                      ))}
                      <th scope="col" className="table__numeric">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <InventoryRowView key={row.containerTypeId} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-muted">
                Total general: <strong>{total}</strong> {total === 1 ? "envase" : "envases"}
              </p>
            </>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function InventoryRowView({ row }: { row: InventoryRow }) {
  return (
    <tr>
      <td className="cell-primary">{row.containerTypeName}</td>
      {CONTAINER_STATE_ORDER.map((state) => (
        <td key={state} className="table__numeric">
          <Quantity value={row.byState[state]} />
        </td>
      ))}
      <td className="table__numeric">
        <strong>
          <Quantity value={row.total} />
        </strong>
      </td>
    </tr>
  );
}

/** A negative quantity is a real signal, never zeroed, absolute-valued or hidden. */
function Quantity({ value }: { value: number }) {
  if (value >= 0) return <>{value}</>;
  return (
    <span className="table__cell--negative">
      <span aria-hidden="true">{value}</span>
      <span className="visually-hidden">
        {value}: hay más envases llenados que vacíos registrados, faltan registrar entradas de
        envases
      </span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="state">
      <p className="state__title">Todavía no hay movimientos de envases</p>
      <p>El inventario aparecerá aquí en cuanto se registre producción o entradas de envases.</p>
    </div>
  );
}
