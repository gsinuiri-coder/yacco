import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createZone, listZones, updateZone } from "../api/zones";
import type { Weekday, Zone } from "../api/zones";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { ErrorState } from "../components/error-state";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { WithdrawConfirm } from "../components/withdraw-confirm";
import { useSlowRequest } from "../hooks/use-slow-request";

const NAME_REQUIRED_MESSAGE = "Escribe el nombre de la zona";

/**
 * What withdrawing means, in the owner's words, shown BEFORE they confirm.
 * Mirrors the API guard (ZonesService): customers keep their zone reference,
 * they just stop being groupable under it in new reports.
 */
const WITHDRAW_EXPLANATION =
  "Los clientes de esta zona no se reasignan: siguen existiendo tal cual. Solo deja de " +
  "ofrecerse para clientes nuevos y de agrupar reportes. Se puede reactivar después.";

const WEEKDAY_ORDER: Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

const WEEKDAY_LABELS: Record<Weekday, string> = {
  MONDAY: "Lunes",
  TUESDAY: "Martes",
  WEDNESDAY: "Miércoles",
  THURSDAY: "Jueves",
  FRIDAY: "Viernes",
  SATURDAY: "Sábado",
  SUNDAY: "Domingo",
};

/** A zone with no days yet is a real, honest state — see CreateZoneDto's own comment. */
function formatDeliveryDays(days: Weekday[]): string {
  if (days.length === 0) return "Sin días definidos";
  return WEEKDAY_ORDER.filter((day) => days.includes(day))
    .map((day) => WEEKDAY_LABELS[day])
    .join(", ");
}

function toggleDay(days: Weekday[], day: Weekday): Weekday[] {
  return days.includes(day) ? days.filter((current) => current !== day) : [...days, day];
}

function sortByName(zones: Zone[]): Zone[] {
  return [...zones].sort((a, b) => a.name.localeCompare(b.name));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The catalog the roster and reports group customers by. Same asymmetric
 * roles as ContainerTypesPage (read ADMIN+SELLER, write ADMIN only) and the
 * same shape: add, rename/edit inline, withdraw with a confirmation step,
 * reactivate with none. Delivery days are never required — an empty list is
 * shown as "Sin días definidos", not as an error; see CreateZoneDto.
 */
export function ZonesPage() {
  const { apiClient, user } = useAuth();
  const isAdmin = user?.roles.includes("ADMIN") ?? false;

  const [zones, setZones] = useState<Zone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlow = useSlowRequest(isLoading);

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDeliveryDays, setNewDeliveryDays] = useState<Weekday[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDeliveryDays, setEditDeliveryDays] = useState<Weekday[]>([]);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSavingAction, setIsSavingAction] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    Promise.all([listZones(apiClient, { active: true }), listZones(apiClient, { active: false })])
      .then(([activeZones, withdrawnZones]) => {
        if (!cancelled) setZones(sortByName([...activeZones, ...withdrawnZones]));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error, "No se pudieron cargar las zonas."));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  function replaceZone(updated: Zone) {
    setZones((current) =>
      sortByName(current.map((zone) => (zone.id === updated.id ? updated : zone))),
    );
  }

  function handleStartAdd() {
    setIsAdding(true);
    setNewName("");
    setNewDeliveryDays([]);
    setCreateError(null);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    const name = newName.trim();
    if (name === "") {
      setCreateError(NAME_REQUIRED_MESSAGE);
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    createZone(apiClient, {
      name,
      ...(newDeliveryDays.length > 0 ? { deliveryDays: newDeliveryDays } : {}),
    })
      .then((created) => {
        setZones((current) => sortByName([...current, created]));
        setIsAdding(false);
      })
      .catch((error: unknown) => {
        // The API's message names the duplicate ("Ya existe una zona con el
        // nombre ..."); shown verbatim, it is the mistake the owner will
        // make most often.
        setCreateError(errorMessage(error, "No se pudo crear la zona."));
      })
      .finally(() => setIsCreating(false));
  }

  function handleStartEdit(zone: Zone) {
    setEditingId(zone.id);
    setEditName(zone.name);
    setEditDeliveryDays(zone.deliveryDays);
    setWithdrawingId(null);
    setActionError(null);
  }

  function handleSaveEdit(id: string) {
    if (isSavingAction) return;
    const name = editName.trim();
    if (name === "") {
      setActionError(NAME_REQUIRED_MESSAGE);
      return;
    }

    setIsSavingAction(true);
    setActionError(null);
    updateZone(apiClient, id, { name, deliveryDays: editDeliveryDays })
      .then((updated) => {
        replaceZone(updated);
        setEditingId(null);
      })
      .catch((error: unknown) => {
        setActionError(errorMessage(error, "No se pudo guardar la zona."));
      })
      .finally(() => setIsSavingAction(false));
  }

  function handleStartWithdraw(id: string) {
    setWithdrawingId(id);
    setEditingId(null);
    setActionError(null);
  }

  function handleSetActive(id: string, active: boolean) {
    if (isSavingAction) return;
    setIsSavingAction(true);
    setActionError(null);
    updateZone(apiClient, id, { active })
      .then((updated) => {
        replaceZone(updated);
        setWithdrawingId(null);
      })
      .catch((error: unknown) => {
        setActionError(
          errorMessage(
            error,
            active ? "No se pudo reactivar la zona." : "No se pudo retirar la zona.",
          ),
        );
      })
      .finally(() => setIsSavingAction(false));
  }

  const activeCount = zones.filter((zone) => zone.active).length;
  const withdrawnCount = zones.length - activeCount;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Zonas</h1>
          <p className="page-header__subtitle">
            {isLoading
              ? "Cargando…"
              : `${activeCount} en uso${withdrawnCount > 0 ? `, ${withdrawnCount} ${withdrawnCount === 1 ? "retirada" : "retiradas"}` : ""}`}
          </p>
        </div>
        {isAdmin && !isAdding && (
          <button
            type="button"
            className="button button--primary"
            onClick={handleStartAdd}
            disabled={isLoading}
          >
            Nueva zona
          </button>
        )}
      </div>

      <section className="card">
        <div className="card__body">
          <SlowRequestNotice show={isSlow && isLoading} />

          {createError && (
            <div className="notice notice--error" role="alert">
              {createError}
            </div>
          )}
          {actionError && (
            <div className="notice notice--error" role="alert">
              {actionError}
            </div>
          )}

          {isAdding && (
            <form className="form-grid" onSubmit={handleCreate} noValidate>
              <div className="field">
                <label className="field__label" htmlFor="newZoneName">
                  Nombre
                </label>
                <input
                  id="newZoneName"
                  type="text"
                  placeholder="Norte"
                  maxLength={80}
                  value={newName}
                  disabled={isCreating}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </div>
              <DeliveryDaysField
                idPrefix="newZone"
                label="Días de reparto (opcional)"
                value={newDeliveryDays}
                disabled={isCreating}
                onChange={setNewDeliveryDays}
              />
              <div className="form-actions form-grid__full">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setIsAdding(false)}
                  disabled={isCreating}
                >
                  Cancelar
                </button>
                <button type="submit" className="button button--primary" disabled={isCreating}>
                  {isCreating ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
          )}

          {loadError ? (
            <ErrorState message={loadError} onRetry={retry} />
          ) : isLoading ? (
            <p className="state" role="status">
              Cargando zonas…
            </p>
          ) : zones.length === 0 ? (
            <div className="state">
              <p className="state__title">Todavía no hay zonas</p>
              <p>Registra la primera para empezar a agrupar clientes y reportes por zona.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">
                  Zonas con sus días de reparto y estado
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Zona</th>
                    <th scope="col">Días de reparto</th>
                    <th scope="col">Estado</th>
                    {isAdmin && (
                      <th scope="col" className="table__actions">
                        <span className="visually-hidden">Acciones</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {zones.map((zone) => (
                    <tr key={zone.id}>
                      <td>
                        {editingId === zone.id ? (
                          <input
                            aria-label={`Nuevo nombre de ${zone.name}`}
                            type="text"
                            maxLength={80}
                            value={editName}
                            disabled={isSavingAction}
                            onChange={(event) => setEditName(event.target.value)}
                          />
                        ) : (
                          <span className="cell-primary">{zone.name}</span>
                        )}
                      </td>
                      <td>
                        {editingId === zone.id ? (
                          <DeliveryDaysField
                            idPrefix={`editZone-${zone.id}`}
                            label={`Días de reparto de ${zone.name}`}
                            hideLabel
                            value={editDeliveryDays}
                            disabled={isSavingAction}
                            onChange={setEditDeliveryDays}
                          />
                        ) : (
                          <span className="cell-secondary">
                            {formatDeliveryDays(zone.deliveryDays)}
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${zone.active ? "badge--active" : "badge--inactive"}`}
                        >
                          {zone.active ? "En uso" : "Retirada"}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="table__actions">
                          {withdrawingId === zone.id ? (
                            <WithdrawConfirm
                              itemLabel={zone.name}
                              explanation={WITHDRAW_EXPLANATION}
                              isSaving={isSavingAction}
                              onCancel={() => setWithdrawingId(null)}
                              onConfirm={() => handleSetActive(zone.id, false)}
                            />
                          ) : editingId === zone.id ? (
                            <>
                              <button
                                type="button"
                                className="button button--secondary"
                                onClick={() => setEditingId(null)}
                                disabled={isSavingAction}
                              >
                                Cancelar
                              </button>{" "}
                              <button
                                type="button"
                                className="button button--primary"
                                onClick={() => handleSaveEdit(zone.id)}
                                disabled={isSavingAction}
                              >
                                {isSavingAction ? "Guardando…" : "Guardar"}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="button button--ghost"
                                onClick={() => handleStartEdit(zone)}
                                disabled={isSavingAction}
                              >
                                Editar
                              </button>{" "}
                              {zone.active ? (
                                <button
                                  type="button"
                                  className="button button--ghost"
                                  onClick={() => handleStartWithdraw(zone.id)}
                                  disabled={isSavingAction}
                                >
                                  Retirar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="button button--ghost"
                                  onClick={() => handleSetActive(zone.id, true)}
                                  disabled={isSavingAction}
                                >
                                  {isSavingAction ? "Reactivando…" : "Reactivar"}
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
        </div>
      </section>
    </AppShell>
  );
}

interface DeliveryDaysFieldProps {
  idPrefix: string;
  label: string;
  /** The inline row edit names the days via the row's own accessible label instead. */
  hideLabel?: boolean;
  value: Weekday[];
  disabled: boolean;
  onChange: (days: Weekday[]) => void;
}

function DeliveryDaysField({
  idPrefix,
  label,
  hideLabel = false,
  value,
  disabled,
  onChange,
}: DeliveryDaysFieldProps) {
  const labelId = `${idPrefix}-label`;

  return (
    <div className="field form-grid__full">
      <span className={`field__label ${hideLabel ? "visually-hidden" : ""}`.trim()} id={labelId}>
        {label}
      </span>
      <div className="checkbox-group" role="group" aria-labelledby={labelId}>
        {WEEKDAY_ORDER.map((day) => (
          <div className="checkbox-field" key={day}>
            <input
              id={`${idPrefix}-${day}`}
              type="checkbox"
              checked={value.includes(day)}
              disabled={disabled}
              onChange={() => onChange(toggleDay(value, day))}
            />
            <label htmlFor={`${idPrefix}-${day}`}>{WEEKDAY_LABELS[day]}</label>
          </div>
        ))}
      </div>
    </div>
  );
}
