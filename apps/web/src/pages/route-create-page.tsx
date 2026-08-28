import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { createRoute } from "../api/routes";
import { listUsers } from "../api/users";
import type { User } from "../api/users";
import { listZones } from "../api/zones";
import type { Zone } from "../api/zones";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";
import { todayInLima } from "../lib/business-date";

/**
 * Planificar es solo decidir el día y el chofer: `POST /routes` crea la ruta
 * VACÍA. Las paradas se agregan una por una desde el detalle, y la zona es
 * una etiqueta para agrupar y filtrar — no arma la ruta con los clientes de
 * esa zona. El formulario lo dice para que nadie espere lo contrario.
 */
export function RouteCreatePage() {
  const { apiClient } = useAuth();
  const navigate = useNavigate();

  const [date, setDate] = useState(todayInLima());
  const [driverId, setDriverId] = useState("");
  const [zoneId, setZoneId] = useState("");

  const [drivers, setDrivers] = useState<User[]>([]);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(true);
  const [zones, setZones] = useState<Zone[]>([]);

  const [driverError, setDriverError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isSlow = useSlowRequest(isSubmitting);

  // Choferes activos, del endpoint de usuarios filtrando por rol: el servidor
  // ya excluye a los desactivados, y RoutesService rechaza a un chofer
  // inactivo con 400 — ofrecerlo sería construir un error.
  useEffect(() => {
    let cancelled = false;
    listUsers(apiClient, { role: "DRIVER" })
      .then((response) => {
        if (!cancelled) setDrivers(response);
      })
      .catch(() => {
        if (!cancelled) setDrivers([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDrivers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  useEffect(() => {
    let cancelled = false;
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Cubre un segundo submit que llegue antes de que el botón deshabilitado
    // se vuelva a pintar; el clic ya lo bloquea `disabled`.
    if (isSubmitting) return;
    if (driverId === "") {
      setDriverError("Elige el chofer que va a hacer la ruta");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    createRoute(apiClient, { driverId, date, ...(zoneId ? { zoneId } : {}) })
      .then((route) => void navigate(`/routes/${route.id}`))
      .catch((error: unknown) => {
        // El 400 de la API nombra el problema concreto (chofer ya con ruta
        // ese día, chofer desactivado); se muestra tal cual para que este
        // mensaje no se despegue del que mantiene el backend.
        setSubmitError(error instanceof Error ? error.message : "No se pudo planificar la ruta.");
        setIsSubmitting(false);
      });
  }

  const hasNoDrivers = !isLoadingDrivers && drivers.length === 0;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Planificar ruta</h1>
          <p className="page-header__subtitle">
            La ruta nace planificada y vacía: las paradas y la carga se agregan después.
          </p>
        </div>
      </div>

      <form className="card" onSubmit={handleSubmit} noValidate>
        <div className="card__body">
          {submitError && (
            <div className="notice notice--error" role="alert">
              {submitError}
            </div>
          )}

          {hasNoDrivers && (
            <div className="notice notice--warning" role="status">
              No hay choferes activos para asignar. Da de alta un usuario con rol de chofer antes de
              planificar la ruta.
            </div>
          )}

          <div className="form-grid">
            <div className="field">
              <label className="field__label" htmlFor="routeDate">
                Día de la ruta
              </label>
              <input
                id="routeDate"
                type="date"
                value={date}
                disabled={isSubmitting}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="routeDriver">
                Chofer
              </label>
              <select
                id="routeDriver"
                value={driverId}
                disabled={isSubmitting || hasNoDrivers}
                onChange={(event) => {
                  setDriverId(event.target.value);
                  setDriverError(undefined);
                }}
              >
                <option value="">Elige un chofer</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
              {driverError && <span className="field__error">{driverError}</span>}
              <span className="field__hint">Un chofer solo puede tener una ruta por día.</span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="routeZone">
                Zona (opcional)
              </label>
              <select
                id="routeZone"
                value={zoneId}
                disabled={isSubmitting}
                onChange={(event) => setZoneId(event.target.value)}
              >
                <option value="">Sin zona</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
              <span className="field__hint">
                Solo sirve para agrupar y filtrar rutas; no agrega los clientes de la zona.
              </span>
            </div>
          </div>

          <SlowRequestNotice show={isSlow && isSubmitting} />

          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={isSubmitting}
              onClick={() => void navigate("/routes")}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={isSubmitting || hasNoDrivers}
            >
              {isSubmitting ? "Planificando…" : "Planificar ruta"}
            </button>
          </div>
        </div>
      </form>
    </AppShell>
  );
}
