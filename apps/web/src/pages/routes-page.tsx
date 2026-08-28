import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ROUTES_PAGE_SIZE, listRoutes } from "../api/routes";
import type { PaginatedRoutes, Route, RouteStatus } from "../api/routes";
import { listUsers } from "../api/users";
import type { User } from "../api/users";
import { listZones } from "../api/zones";
import type { Zone } from "../api/zones";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ErrorState } from "../components/error-state";
import { PaginationNav } from "../components/pagination-nav";
import { ROUTE_STATUS_LABELS, RouteStatusBadge } from "../components/route-status-badge";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { StatusFilterSelect } from "../components/status-filter-select";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDate } from "../lib/business-date";

type StatusFilter = RouteStatus | "all";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  ...(Object.entries(ROUTE_STATUS_LABELS) as [RouteStatus, string][]).map(([value, label]) => ({
    value,
    label,
  })),
];

/**
 * Lo que la oficina quiere ver de un vistazo: cuántas paradas tiene la ruta y
 * cuántas quedan sin resolver. El conteo sale de `route.stops`, que
 * `GET /routes` ya devuelve completo (ROUTE_INCLUDE incluye las paradas), así
 * que la lista no necesita ninguna llamada extra por fila.
 */
function count(quantity: number, singular: string, plural: string): string {
  return `${quantity} ${quantity === 1 ? singular : plural}`;
}

function summarizeStops(route: Route): { total: string; resolved: string | null } {
  const total = route.stops.length;
  if (total === 0) {
    return { total: "Sin paradas", resolved: null };
  }
  const delivered = route.stops.filter((stop) => stop.status === "DELIVERED").length;
  const failed = route.stops.filter((stop) => stop.status === "FAILED").length;
  const pending = total - delivered - failed;

  // El desglose solo aparece cuando ya se resolvió alguna parada: en una ruta
  // recién planificada "3 pendientes" debajo de "3 paradas" no dice nada.
  const parts: string[] = [];
  if (delivered > 0) parts.push(count(delivered, "entregada", "entregadas"));
  if (failed > 0) parts.push(count(failed, "no entregada", "no entregadas"));
  if (pending > 0 && parts.length > 0) parts.push(count(pending, "pendiente", "pendientes"));

  return {
    total: count(total, "parada", "paradas"),
    resolved: parts.length === 0 ? null : parts.join(" · "),
  };
}

export function RoutesPage() {
  const { apiClient } = useAuth();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [date, setDate] = useState("");
  const [driverId, setDriverId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PaginatedRoutes | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  const [drivers, setDrivers] = useState<User[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    listRoutes(apiClient, {
      page,
      limit: ROUTES_PAGE_SIZE,
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
      ...(date ? { date } : {}),
      ...(driverId ? { driverId } : {}),
      ...(zoneId ? { zoneId } : {}),
    })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error ? error.message : "No se pudo cargar la lista de rutas.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, page, statusFilter, date, driverId, zoneId, reloadToken]);

  // Los dos catálogos de los filtros, cada uno de su propio endpoint. Si
  // alguno falla, el filtro queda sin opciones pero la lista sigue en pie:
  // ninguno de los dos es necesario para leer las rutas.
  useEffect(() => {
    let cancelled = false;
    listUsers(apiClient, { role: "DRIVER" })
      .then((response) => {
        if (!cancelled) setDrivers(response);
      })
      .catch(() => {
        if (!cancelled) setDrivers([]);
      });
    listZones(apiClient, { active: true })
      .then((response) => {
        if (!cancelled) setZones(response);
      })
      .catch(() => {
        if (!cancelled) setZones([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const clearFilters = useCallback(() => {
    setStatusFilter("all");
    setDate("");
    setDriverId("");
    setZoneId("");
    setPage(1);
  }, []);

  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;
  const routes = result?.data ?? [];
  const hasFilters = statusFilter !== "all" || date !== "" || driverId !== "" || zoneId !== "";

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Rutas</h1>
          <p className="page-header__subtitle">
            {isLoading && result === null
              ? "Cargando…"
              : `${total} ${total === 1 ? "ruta" : "rutas"}${hasFilters ? " con este filtro" : ""}`}
          </p>
        </div>
        <Link to="/routes/new" className="button button--primary">
          Planificar ruta
        </Link>
      </div>

      <section className="card">
        <div className="toolbar">
          <div className="field">
            <label className="field__label" htmlFor="routeDate">
              Día
            </label>
            <input
              id="routeDate"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="routeDriver">
              Chofer
            </label>
            <select
              id="routeDriver"
              value={driverId}
              onChange={(event) => {
                setDriverId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="routeZone">
              Zona
            </label>
            <select
              id="routeZone"
              value={zoneId}
              onChange={(event) => {
                setZoneId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </div>
          <StatusFilterSelect
            id="routeStatusFilter"
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={(status) => {
              setStatusFilter(status);
              setPage(1);
            }}
          />
          {hasFilters && (
            <button type="button" className="button button--secondary" onClick={clearFilters}>
              Limpiar filtros
            </button>
          )}
        </div>

        <SlowRequestNotice show={isSlow && isLoading} />

        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={retry} />
        ) : isLoading ? (
          <p className="state" role="status">
            Cargando rutas…
          </p>
        ) : routes.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">
                  Rutas con día, chofer, zona, estado y cuántas paradas tienen
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Día</th>
                    <th scope="col">Chofer</th>
                    <th scope="col">Zona</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Paradas</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <RouteRow
                      key={route.id}
                      route={route}
                      onOpen={() => void navigate(`/routes/${route.id}`)}
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

function RouteRow({ route, onOpen }: { route: Route; onOpen: () => void }) {
  const stops = summarizeStops(route);

  return (
    <tr
      className="table__row--clickable"
      role="link"
      tabIndex={0}
      aria-label={`Ver la ruta de ${route.driver.name} del ${formatBusinessDate(route.date)}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <td>{formatBusinessDate(route.date)}</td>
      <td>{route.driver.name}</td>
      <td>
        {route.zone ? (
          <span className="badge badge--muted">{route.zone.name}</span>
        ) : (
          <span className="cell-secondary">Sin zona</span>
        )}
      </td>
      <td>
        <RouteStatusBadge status={route.status} />
      </td>
      <td>
        <div className="cell-primary">{stops.total}</div>
        {stops.resolved && <div className="cell-secondary">{stops.resolved}</div>}
      </td>
    </tr>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="state">
      <p className="state__title">
        {hasFilters ? "Ninguna ruta coincide con el filtro" : "Todavía no hay rutas"}
      </p>
      <p>
        {hasFilters
          ? "Prueba con otro día, chofer, zona o estado."
          : "Planifica la ruta del día para empezar a cargar el camión."}
      </p>
    </div>
  );
}
