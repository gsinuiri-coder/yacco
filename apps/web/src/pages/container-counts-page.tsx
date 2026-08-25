import { useCallback, useEffect, useState } from "react";
import { CONTAINER_BALANCES_PAGE_SIZE, listContainerBalances } from "../api/container-balances";
import type {
  ContainerBalanceListParams,
  ContainerBalanceRow,
  PaginatedContainerBalances,
} from "../api/container-balances";
import { listContainerTypes } from "../api/container-types";
import type { ContainerType } from "../api/container-types";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ContainerCountForm } from "../components/container-count-form";
import { ErrorState } from "../components/error-state";
import { PaginationNav } from "../components/pagination-nav";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDateTime } from "../lib/business-date";

/** A count older than this is "old": it says little about today. */
const OLD_COUNT_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The filter is "counted before this INSTANT". The date input yields a
 * calendar day as text; the start of that day in Lima is written as text
 * too (fixed -05:00 offset, no DST in Peru), never via `new Date(day)`,
 * which would read it as UTC midnight — the previous evening in Lima.
 */
export function startOfLimaDay(businessDate: string): string | undefined {
  return BUSINESS_DATE_PATTERN.test(businessDate) ? `${businessDate}T00:00:00-05:00` : undefined;
}

/** Days elapsed since an instant; `lastCountedAt` is a real instant, so `Date` is right here. */
function daysSince(instant: string, now: number): number {
  return Math.floor((now - new Date(instant).getTime()) / DAY_MS);
}

interface Progress {
  total: number;
  uncounted: number;
}

const COLUMN_COUNT = 6;

/**
 * The work list for the container audit: ~750 containers across ~500
 * customer locations, counted one by one. The owner opens it asking "who is
 * left?", so what it communicates at all times is progress — locations
 * counted vs. still to count, over the whole roster, independent of the
 * page or filter on screen — and each row's state: never counted, counted
 * (and how long ago), a negative balance (a delivery nobody recorded), a
 * deactivated customer or location (included on purpose, marked, never
 * hidden). Counting happens inside the row; afterwards the same page of the
 * report is reloaded, so the balance and the date on screen always come
 * from the API.
 *
 * No zone filter although the API supports it: the web has no zones
 * catalog endpoint to read the options from, and a catalog is never typed
 * by hand or derived from another resource.
 */
export function ContainerCountsPage() {
  const { apiClient } = useAuth();

  const [uncountedOnly, setUncountedOnly] = useState(false);
  const [withDiscrepancies, setWithDiscrepancies] = useState(false);
  const [countedBeforeDay, setCountedBeforeDay] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PaginatedContainerBalances | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  const [progress, setProgress] = useState<Progress | null>(null);
  const [containerTypes, setContainerTypes] = useState<ContainerType[]>([]);
  const [countingLocationId, setCountingLocationId] = useState<string | null>(null);
  const [lastRegisteredLocation, setLastRegisteredLocation] = useState<string | null>(null);

  const countedBefore = startOfLimaDay(countedBeforeDay);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    const params: ContainerBalanceListParams = {
      page,
      limit: CONTAINER_BALANCES_PAGE_SIZE,
      ...(uncountedOnly ? { uncountedOnly: true } : {}),
      ...(withDiscrepancies ? { withDiscrepancies: true } : {}),
      ...(countedBefore ? { countedBefore } : {}),
    };
    listContainerBalances(apiClient, params)
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error ? error.message : "No se pudo cargar la lista de envases.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, page, uncountedOnly, withDiscrepancies, countedBefore, reloadToken]);

  // Progress is over the whole roster, so it is asked for separately from
  // the filtered page: two one-row requests whose `total` is the number.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listContainerBalances(apiClient, { page: 1, limit: 1 }),
      listContainerBalances(apiClient, { page: 1, limit: 1, uncountedOnly: true }),
    ])
      .then(([all, uncounted]) => {
        if (!cancelled) setProgress({ total: all.total, uncounted: uncounted.total });
      })
      .catch(() => {
        // The list's own error state covers the failure; progress just stays unknown.
        if (!cancelled) setProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    listContainerTypes(apiClient)
      .then((types) => {
        if (!cancelled) setContainerTypes(types);
      })
      .catch(() => {
        // Without the catalog, the sheet still offers the types the report
        // lists; only "another type found" is unavailable.
        if (!cancelled) setContainerTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  function handleRegistered(row: ContainerBalanceRow) {
    setCountingLocationId(null);
    setLastRegisteredLocation(`${row.customer.name} — ${row.location.name}`);
    reload();
  }

  const rows = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;
  const hasFilters = uncountedOnly || withDiscrepancies || countedBeforeDay !== "";
  const now = Date.now();

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Envases en poder de clientes</h1>
          <p className="page-header__subtitle" role="status">
            {progress === null
              ? "Calculando el avance…"
              : `${progress.total - progress.uncounted} de ${progress.total} ubicaciones contadas · ${progress.uncounted} sin contar`}
          </p>
        </div>
      </div>

      <section className="card">
        <div className="toolbar">
          <div className="checkbox-field">
            <input
              id="uncountedOnly"
              type="checkbox"
              checked={uncountedOnly}
              onChange={(event) => {
                setUncountedOnly(event.target.checked);
                setPage(1);
              }}
            />
            <label htmlFor="uncountedOnly">Solo sin contar</label>
          </div>
          <div className="checkbox-field">
            <input
              id="withDiscrepancies"
              type="checkbox"
              checked={withDiscrepancies}
              onChange={(event) => {
                setWithDiscrepancies(event.target.checked);
                setPage(1);
              }}
            />
            <label htmlFor="withDiscrepancies">Solo con entregas sin registrar</label>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="countedBefore">
              Contadas antes del
            </label>
            <input
              id="countedBefore"
              type="date"
              value={countedBeforeDay}
              onChange={(event) => {
                setCountedBeforeDay(event.target.value);
                setPage(1);
              }}
            />
          </div>
          {hasFilters && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setUncountedOnly(false);
                setWithDiscrepancies(false);
                setCountedBeforeDay("");
                setPage(1);
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="card__body">
          <p className="page-header__subtitle">
            {isLoading && result === null
              ? "Cargando…"
              : `${total} ${total === 1 ? "ubicación" : "ubicaciones"}${hasFilters ? " con este filtro" : ""}`}
          </p>
          {lastRegisteredLocation && (
            <div className="notice notice--info" role="status">
              Conteo registrado: {lastRegisteredLocation}.
            </div>
          )}
        </div>

        <SlowRequestNotice show={isSlow && isLoading} />

        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={reload} />
        ) : isLoading && result === null ? (
          <p className="state" role="status">
            Cargando ubicaciones…
          </p>
        ) : rows.length === 0 ? (
          <div className="state">
            <p className="state__title">
              {hasFilters ? "Ninguna ubicación con este filtro" : "Todavía no hay ubicaciones"}
            </p>
            <p>
              {hasFilters
                ? "Cambia o limpia los filtros."
                : "Las ubicaciones de los clientes aparecerán aquí para contarlas."}
            </p>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">
                  Envases en poder de cada ubicación de cliente y última vez que se contaron
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col">Ubicación</th>
                    <th scope="col">Zona</th>
                    <th scope="col" className="table__numeric">
                      Envases
                    </th>
                    <th scope="col">Última vez que se contó</th>
                    <th scope="col" className="table__actions">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <BalanceRow
                      key={row.location.id}
                      row={row}
                      now={now}
                      isCounting={countingLocationId === row.location.id}
                      containerTypes={containerTypes}
                      onStartCount={() => {
                        setCountingLocationId(row.location.id);
                        setLastRegisteredLocation(null);
                      }}
                      onCancelCount={() => setCountingLocationId(null)}
                      onRegistered={() => handleRegistered(row)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <PaginationNav
              displayPage={result?.page ?? page}
              page={page}
              totalPages={totalPages}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          </>
        )}
      </section>
    </AppShell>
  );
}

interface BalanceRowProps {
  row: ContainerBalanceRow;
  now: number;
  isCounting: boolean;
  containerTypes: ContainerType[];
  onStartCount: () => void;
  onCancelCount: () => void;
  onRegistered: () => void;
}

function BalanceRow({
  row,
  now,
  isCounting,
  containerTypes,
  onStartCount,
  onCancelCount,
  onRegistered,
}: BalanceRowProps) {
  const hasNegative = row.containers.some((container) => container.quantity < 0);
  const isOld = row.lastCountedAt !== null && daysSince(row.lastCountedAt, now) > OLD_COUNT_DAYS;

  return (
    <>
      <tr>
        <td>
          <div className="cell-primary">{row.customer.name}</div>
          {!row.customer.active && <span className="badge badge--warning">Cliente de baja</span>}
        </td>
        <td>
          <div>{row.location.name}</div>
          {!row.location.active && <span className="badge badge--warning">Ubicación retirada</span>}
        </td>
        <td>
          {row.zone ? (
            <span className="badge badge--muted">{row.zone.name}</span>
          ) : (
            <span className="cell-secondary">Sin zona</span>
          )}
        </td>
        <td className="table__numeric">
          <div className="cell-primary">{row.totalQuantity}</div>
          {row.containers.length > 0 && (
            <div className="cell-secondary">
              {row.containers.map((container, index) => (
                <span key={container.containerType.id}>
                  {index > 0 && " · "}
                  <span className={container.quantity < 0 ? "table__cell--negative" : undefined}>
                    {container.quantity} {container.containerType.name}
                  </span>
                </span>
              ))}
            </div>
          )}
          {hasNegative && <span className="badge badge--danger">Entrega sin registrar</span>}
        </td>
        <td>
          {row.lastCountedAt === null ? (
            <span className="badge badge--info">Sin contar</span>
          ) : (
            <>
              <div>{formatBusinessDateTime(row.lastCountedAt)}</div>
              {isOld && (
                <span className="badge badge--warning">Hace más de {OLD_COUNT_DAYS} días</span>
              )}
            </>
          )}
        </td>
        <td className="table__actions">
          {!isCounting && (
            <button type="button" className="button button--ghost" onClick={onStartCount}>
              Contar
            </button>
          )}
        </td>
      </tr>
      {isCounting && (
        <tr>
          <td colSpan={COLUMN_COUNT}>
            <ContainerCountForm
              row={row}
              containerTypes={containerTypes}
              onCancel={onCancelCount}
              onRegistered={onRegistered}
            />
          </td>
        </tr>
      )}
    </>
  );
}
