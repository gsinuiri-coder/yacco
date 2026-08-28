import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../api/errors";
import { getRoute } from "../api/routes";
import type { Route } from "../api/routes";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import {
  RouteStatusBadge,
  STOP_ORIGIN_LABELS,
  StopStatusBadge,
} from "../components/route-status-badge";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDate, formatBusinessDateTime } from "../lib/business-date";

/**
 * La hoja de ruta como la lee la oficina: el día, el chofer y las paradas en
 * el orden en que el chofer las va a visitar. `GET /routes/:id` ya trae las
 * paradas ordenadas por `position`, así que esta pantalla no reordena nada.
 */
export function RouteDetailPage() {
  const { routeId } = useParams<{ routeId: string }>();
  const { apiClient } = useAuth();
  const navigate = useNavigate();

  const [route, setRoute] = useState<Route | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlowLoad = useSlowRequest(isLoading);

  useEffect(() => {
    if (!routeId) return;
    let ignore = false;
    setIsLoading(true);
    setLoadError(null);

    getRoute(apiClient, routeId)
      .then((response) => {
        if (!ignore) setRoute(response);
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setLoadError(error instanceof Error ? error : new Error("No se pudo cargar la ruta."));
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [apiClient, routeId, reloadToken]);

  const notFound = loadError instanceof ApiError && loadError.status === 404;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>{route ? `Ruta del ${formatBusinessDate(route.date)}` : "Ruta"}</h1>
          <p className="page-header__subtitle">{route ? route.driver.name : "Cargando…"}</p>
        </div>
        <Link to="/routes" className="button button--secondary">
          Volver a rutas
        </Link>
      </div>

      {isSlowLoad && isLoading && (
        <p className="notice notice--info" role="status">
          {SLOW_REQUEST_MESSAGE}
        </p>
      )}

      {isLoading ? (
        <p className="state card" role="status">
          Cargando ruta…
        </p>
      ) : notFound ? (
        <div className="state card">
          <p className="state__title">Esa ruta no existe</p>
          <div className="state__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void navigate("/routes")}
            >
              Volver a rutas
            </button>
          </div>
        </div>
      ) : loadError ? (
        <div className="state card">
          <p className="state__title">No se pudo cargar la ruta</p>
          <p role="alert">{loadError.message}</p>
          <div className="state__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              Reintentar
            </button>
          </div>
        </div>
      ) : route ? (
        <>
          <section className="card">
            <div className="card__body">
              <div className="form-grid">
                <div className="stat">
                  <span className="stat__label">Chofer</span>
                  <span className="stat__value">{route.driver.name}</span>
                </div>
                <div className="stat">
                  <span className="stat__label">Estado</span>
                  <span className="stat__value">
                    <RouteStatusBadge status={route.status} />
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">Zona</span>
                  <span className="stat__value">
                    {route.zone ? (
                      <span className="badge badge--muted">{route.zone.name}</span>
                    ) : (
                      <span className="cell-secondary">Sin zona</span>
                    )}
                  </span>
                </div>
                {/* "Creada" y no "Planificada": el estado de al lado ya se
                    llama Planificada y las dos cosas juntas se leen mal. */}
                <div className="stat">
                  <span className="stat__label">Creada</span>
                  <span className="stat__value">{formatBusinessDateTime(route.createdAt)}</span>
                </div>
              </div>
            </div>
          </section>

          <RouteStopsSection route={route} />
        </>
      ) : null}
    </AppShell>
  );
}

function RouteStopsSection({ route }: { route: Route }) {
  return (
    <section className="card">
      <div className="card__body">
        <h2>Paradas</h2>
        <p className="page-header__subtitle">En el orden en que el chofer las va a visitar.</p>
      </div>

      {route.stops.length === 0 ? (
        <div className="state">
          <p className="state__title">Esta ruta todavía no tiene paradas</p>
          <p>
            Cuando se le agreguen pedidos pendientes o clientes para autoventa, van a aparecer acá
            en el orden en que el chofer las va a visitar.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <caption className="visually-hidden">
              Paradas de la ruta con su orden, cliente, dirección, origen y estado
            </caption>
            <thead>
              <tr>
                <th scope="col">Orden</th>
                <th scope="col">Cliente</th>
                <th scope="col">Origen</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {route.stops.map((stop) => (
                <tr key={stop.id}>
                  <td>{stop.position}</td>
                  <td>
                    <div className="cell-primary">{stop.location.customer.name}</div>
                    {/* El nombre de la locación acompaña a la dirección: casi
                        siempre es "Principal", y solo distingue algo cuando el
                        cliente tiene más de un punto de entrega. */}
                    <div className="cell-secondary">
                      {stop.location.name} · {stop.location.address}
                    </div>
                  </td>
                  <td>{STOP_ORIGIN_LABELS[stop.origin]}</td>
                  <td>
                    <StopStatusBadge status={stop.status} />
                    {stop.failureReason && (
                      <div className="cell-secondary">{stop.failureReason}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
