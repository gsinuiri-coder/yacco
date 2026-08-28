import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../api/errors";
import {
  finishRoute,
  getRoute,
  removeRouteStop,
  reorderRouteStops,
  startRoute,
} from "../api/routes";
import type { Route, RouteStop } from "../api/routes";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import {
  RouteStatusBadge,
  STOP_ORIGIN_LABELS,
  StopStatusBadge,
} from "../components/route-status-badge";
import { RouteLoadsSection } from "../components/route-loads-section";
import { RouteStopForm } from "../components/route-stop-form";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDate, formatBusinessDateTime } from "../lib/business-date";

/** PLANNED e IN_PROGRESS todavía se editan; FINISHED y SETTLED, nunca. */
function isEditable(route: Route): boolean {
  return route.status === "PLANNED" || route.status === "IN_PROGRESS";
}

function describeActionError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * La hoja de ruta como la arma y la lee la oficina: el día, el chofer y las
 * paradas en el orden en que el chofer las va a visitar, con lo que hace
 * falta para armarla — agregar, quitar, reordenar — y los dos botones que
 * mueven la ruta: iniciar y terminar.
 *
 * Toda acción recarga la ruta desde `GET /routes/:id` en vez de recomponer el
 * estado a mano: las posiciones las asigna el servidor, y una parada que otro
 * resolvió mientras tanto tiene que aparecer.
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

  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [isConfirmingFinish, setIsConfirmingFinish] = useState(false);

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

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  function handleStart() {
    if (!routeId || isActing) return;
    setIsActing(true);
    setActionError(null);
    startRoute(apiClient, routeId)
      .then((updated) => setRoute(updated))
      .catch((error: unknown) => {
        // 409: alguien más la inició o la terminó entre la carga y el clic.
        // La pantalla se recarga para mostrar lo que realmente pasó.
        setActionError(describeActionError(error, "No se pudo iniciar la ruta."));
        reload();
      })
      .finally(() => setIsActing(false));
  }

  function handleFinish() {
    if (!routeId || isActing) return;
    setIsActing(true);
    setActionError(null);
    finishRoute(apiClient, routeId)
      .then((updated) => {
        setRoute(updated);
        setIsConfirmingFinish(false);
      })
      .catch((error: unknown) => {
        setActionError(describeActionError(error, "No se pudo terminar la ruta."));
        setIsConfirmingFinish(false);
        reload();
      })
      .finally(() => setIsActing(false));
  }

  const notFound = loadError instanceof ApiError && loadError.status === 404;
  const pendingStops = route?.stops.filter((stop) => stop.status === "PENDING").length ?? 0;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>{route ? `Ruta del ${formatBusinessDate(route.date)}` : "Ruta"}</h1>
          <p className="page-header__subtitle">{route ? route.driver.name : "Cargando…"}</p>
        </div>
        <div className="page-header__actions">
          {route?.status === "PLANNED" && (
            <button
              type="button"
              className="button button--primary"
              disabled={isActing}
              onClick={handleStart}
            >
              {isActing ? "Iniciando…" : "Iniciar ruta"}
            </button>
          )}
          {route?.status === "IN_PROGRESS" && !isConfirmingFinish && (
            <button
              type="button"
              className="button button--primary"
              disabled={isActing}
              onClick={() => setIsConfirmingFinish(true)}
            >
              Terminar ruta
            </button>
          )}
          <Link to="/routes" className="button button--secondary">
            Volver a rutas
          </Link>
        </div>
      </div>

      {actionError && (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      )}

      {isConfirmingFinish && (
        <div className="card card__body" role="group" aria-label="Confirmar el fin de la ruta">
          <p>
            {pendingStops === 0
              ? "Todas las paradas están resueltas. Al terminar la ruta ya no se pueden marcar paradas ni cambiar su orden."
              : pendingStops === 1
                ? "Queda 1 parada sin resolver. Se puede terminar igual, pero después ya no se puede marcar."
                : `Quedan ${pendingStops} paradas sin resolver. Se puede terminar igual, pero después ya no se pueden marcar.`}
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={isActing}
              onClick={() => setIsConfirmingFinish(false)}
            >
              No, todavía no
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={isActing}
              onClick={handleFinish}
            >
              {isActing ? "Terminando…" : "Sí, terminar la ruta"}
            </button>
          </div>
        </div>
      )}

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
            <button type="button" className="button button--secondary" onClick={reload}>
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

          <RouteStopsSection route={route} onChanged={reload} />

          <RouteLoadsSection route={route} />
        </>
      ) : null}
    </AppShell>
  );
}

function RouteStopsSection({ route, onChanged }: { route: Route; onChanged: () => void }) {
  const { apiClient } = useAuth();
  const [isAdding, setIsAdding] = useState(false);
  const [busyStopId, setBusyStopId] = useState<string | null>(null);
  const [removingStopId, setRemovingStopId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  const editable = isEditable(route);
  const stops = route.stops;

  /**
   * Mover una parada es reordenar la ruta entera: `PATCH .../stops/reorder`
   * toma la lista COMPLETA, no un parche. Subir/bajar en vez de arrastrar
   * porque se opera con teclado y en pantallas chicas, y porque cada
   * movimiento es un cambio que se puede describir en voz alta.
   */
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stops.length || busyStopId !== null) return;

    const stopIds = stops.map((stop) => stop.id);
    const moved = stopIds[index] as string;
    stopIds[index] = stopIds[target] as string;
    stopIds[target] = moved;

    setBusyStopId(moved);
    setStopError(null);
    reorderRouteStops(apiClient, route.id, stopIds)
      .then(() => onChanged())
      .catch((error: unknown) => {
        setStopError(describeActionError(error, "No se pudo cambiar el orden de las paradas."));
      })
      .finally(() => setBusyStopId(null));
  }

  function remove(stop: RouteStop) {
    if (busyStopId !== null) return;
    setBusyStopId(stop.id);
    setStopError(null);
    removeRouteStop(apiClient, route.id, stop.id)
      .then(() => {
        setRemovingStopId(null);
        onChanged();
      })
      .catch((error: unknown) => {
        setStopError(describeActionError(error, "No se pudo quitar la parada."));
        setRemovingStopId(null);
      })
      .finally(() => setBusyStopId(null));
  }

  return (
    <section className="card">
      <div className="card__body">
        <h2>Paradas</h2>
        <p className="page-header__subtitle">En el orden en que el chofer las va a visitar.</p>
        {editable && !isAdding && (
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setIsAdding(true);
                setStopError(null);
              }}
            >
              Agregar parada
            </button>
          </div>
        )}
      </div>

      {isAdding && (
        <RouteStopForm
          routeId={route.id}
          onCancel={() => setIsAdding(false)}
          onAdded={() => {
            setIsAdding(false);
            onChanged();
          }}
        />
      )}

      {stopError && (
        <div className="card__body">
          <p className="notice notice--error" role="alert">
            {stopError}
          </p>
        </div>
      )}

      {stops.length === 0 ? (
        <div className="state">
          <p className="state__title">Esta ruta todavía no tiene paradas</p>
          <p>
            {editable
              ? "Agrega los pedidos que va a entregar el chofer, o un cliente al que le vas a vender en la calle."
              : "Esta ruta terminó sin paradas: nunca se le agregó ninguna."}
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
                {editable && (
                  <th scope="col" className="table__actions">
                    <span className="visually-hidden">Acciones</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {stops.map((stop, index) => (
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
                  {editable && (
                    <td className="table__actions">
                      {removingStopId === stop.id ? (
                        <span
                          role="group"
                          aria-label={`Confirmar quitar a ${stop.location.customer.name}`}
                        >
                          ¿Quitar esta parada?{" "}
                          <button
                            type="button"
                            className="button button--ghost"
                            disabled={busyStopId !== null}
                            onClick={() => setRemovingStopId(null)}
                          >
                            No
                          </button>
                          <button
                            type="button"
                            className="button button--ghost"
                            disabled={busyStopId !== null}
                            onClick={() => remove(stop)}
                          >
                            Sí, quitar
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="button button--ghost"
                            aria-label={`Subir la parada de ${stop.location.customer.name}`}
                            disabled={index === 0 || busyStopId !== null}
                            onClick={() => move(index, -1)}
                          >
                            Subir
                          </button>
                          <button
                            type="button"
                            className="button button--ghost"
                            aria-label={`Bajar la parada de ${stop.location.customer.name}`}
                            disabled={index === stops.length - 1 || busyStopId !== null}
                            onClick={() => move(index, 1)}
                          >
                            Bajar
                          </button>
                          {/* Una parada ya resuelta tiene venta y movimientos
                              de envases colgando: la API la rechaza y acá ni
                              siquiera se ofrece. */}
                          {stop.status === "PENDING" && (
                            <button
                              type="button"
                              className="button button--ghost"
                              aria-label={`Quitar la parada de ${stop.location.customer.name}`}
                              disabled={busyStopId !== null}
                              onClick={() => setRemovingStopId(stop.id)}
                            >
                              Quitar
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
