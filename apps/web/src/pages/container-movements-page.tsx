import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import type { ContainerState } from "../api/container-inventory";
import { listContainerTypes } from "../api/container-types";
import type { ContainerType } from "../api/container-types";
import {
  CONTAINER_MOVEMENTS_PAGE_SIZE,
  createContainerMovement,
  listContainerMovements,
} from "../api/container-movements";
import type {
  ContainerMovement,
  ContainerMovementType,
  PaginatedContainerMovements,
} from "../api/container-movements";
import type { Customer } from "../api/customers";
import { listCustomerLocations } from "../api/customer-locations";
import type { CustomerLocation } from "../api/customer-locations";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { CustomerSelect } from "../components/customer-select";
import { ErrorState } from "../components/error-state";
import { PaginationNav } from "../components/pagination-nav";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDateTime } from "../lib/business-date";
import {
  CONTAINER_MOVEMENT_TYPE_LABELS,
  CONTAINER_STATE_ORIGIN_LABELS,
  formatStateTransition,
} from "../lib/container-movement-labels";
import {
  ALLOWED_MOVEMENT_TYPES,
  destinationFor,
  originsFor,
} from "../lib/container-movement-transitions";
import type { AllowedMovementType } from "../lib/container-movement-transitions";

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function ContainerMovementsPage() {
  const { apiClient } = useAuth();

  // --- Catálogo de tipos de envase: lo usan el alta y el filtro del historial ---
  const [containerTypes, setContainerTypes] = useState<ContainerType[]>([]);
  const [isLoadingContainerTypes, setIsLoadingContainerTypes] = useState(true);
  const [containerTypesError, setContainerTypesError] = useState<string | null>(null);
  const [containerTypesReloadToken, setContainerTypesReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingContainerTypes(true);
    setContainerTypesError(null);

    listContainerTypes(apiClient)
      .then((data) => {
        if (!cancelled) setContainerTypes(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setContainerTypesError(
          error instanceof Error ? error.message : "No se pudo cargar el catálogo de envases.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingContainerTypes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, containerTypesReloadToken]);

  // --- Alta de movimiento ---------------------------------------------------
  const [type, setType] = useState<AllowedMovementType | "">("");
  const [containerTypeId, setContainerTypeId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [originChoice, setOriginChoice] = useState<ContainerState | "">("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [locationId, setLocationId] = useState("");

  const [locations, setLocations] = useState<CustomerLocation[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [locationsReloadToken, setLocationsReloadToken] = useState(0);

  const [typeError, setTypeError] = useState<string | undefined>(undefined);
  const [containerTypeError, setContainerTypeError] = useState<string | undefined>(undefined);
  const [quantityError, setQuantityError] = useState<string | undefined>(undefined);
  const [originError, setOriginError] = useState<string | undefined>(undefined);
  const [customerError, setCustomerError] = useState<string | undefined>(undefined);
  const [locationError, setLocationError] = useState<string | undefined>(undefined);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const isSlowSubmit = useSlowRequest(isSubmitting);

  const origins = type === "" ? [] : originsFor(type);
  const requiresOriginChoice = origins.length > 1;
  const effectiveOrigin: ContainerState | null | undefined = requiresOriginChoice
    ? originChoice === ""
      ? undefined
      : originChoice
    : (origins[0] ?? null);
  const touchesCustomer = effectiveOrigin === "WITH_CUSTOMER";

  useEffect(() => {
    if (!touchesCustomer || customer === null) {
      setLocations([]);
      setIsLoadingLocations(false);
      setLocationsError(null);
      return;
    }
    let cancelled = false;
    setIsLoadingLocations(true);
    setLocationsError(null);

    listCustomerLocations(apiClient, customer.id)
      .then((data) => {
        if (!cancelled) setLocations(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLocationsError(
          error instanceof Error ? error.message : "No se pudieron cargar las locaciones.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLocations(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, touchesCustomer, customer, locationsReloadToken]);

  function handleTypeChange(value: string) {
    setType(value as AllowedMovementType | "");
    setTypeError(undefined);
    setOriginChoice("");
    setOriginError(undefined);
    setCustomer(null);
    setCustomerError(undefined);
    setLocationId("");
    setLocationError(undefined);
  }

  function handleOriginChange(value: string) {
    setOriginChoice(value as ContainerState);
    setOriginError(undefined);
    setCustomer(null);
    setCustomerError(undefined);
    setLocationId("");
    setLocationError(undefined);
  }

  function handleCustomerChange(next: Customer | null) {
    setCustomer(next);
    setCustomerError(undefined);
    setLocationId("");
    setLocationError(undefined);
  }

  function validate(): boolean {
    const nextTypeError = type === "" ? "Elige una operación" : undefined;
    const nextContainerTypeError = containerTypeId === "" ? "Elige un tipo de envase" : undefined;
    const parsedQuantity = parseQuantity(quantity);
    const nextQuantityError =
      parsedQuantity === null || parsedQuantity < 1
        ? "La cantidad debe ser un número entero mayor que 0"
        : undefined;
    const nextOriginError =
      requiresOriginChoice && originChoice === "" ? "Elige el estado de origen" : undefined;
    const nextCustomerError = touchesCustomer && customer === null ? "Elige un cliente" : undefined;
    const nextLocationError =
      touchesCustomer && customer !== null && locationId === "" ? "Elige una locación" : undefined;

    setTypeError(nextTypeError);
    setContainerTypeError(nextContainerTypeError);
    setQuantityError(nextQuantityError);
    setOriginError(nextOriginError);
    setCustomerError(nextCustomerError);
    setLocationError(nextLocationError);

    return [
      nextTypeError,
      nextContainerTypeError,
      nextQuantityError,
      nextOriginError,
      nextCustomerError,
      nextLocationError,
    ].every((error) => error === undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guards a stray second submit event arriving before the disabled button
    // re-renders — the click itself is also blocked by `disabled`.
    if (isSubmitting) return;
    if (!validate() || type === "") return;

    const origin = requiresOriginChoice ? (originChoice as ContainerState) : (origins[0] ?? null);
    const destination = destinationFor(type);

    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);
    createContainerMovement(apiClient, {
      type,
      containerTypeId,
      quantity: Number(quantity.trim()),
      ...(origin !== null ? { fromState: origin } : {}),
      ...(destination !== null ? { toState: destination } : {}),
      ...(touchesCustomer ? { locationId } : {}),
    })
      .then(() => {
        setSuccessMessage("Movimiento registrado.");
        setType("");
        setContainerTypeId("");
        setQuantity("");
        setOriginChoice("");
        setCustomer(null);
        setLocationId("");
        setListReloadToken((token) => token + 1);
      })
      .catch((error: unknown) => {
        // The API's 400 names the concrete problem (transición inválida,
        // locación ajena); shown verbatim so it never drifts from the
        // backend's own message.
        setSubmitError(
          error instanceof Error ? error.message : "No se pudo registrar el movimiento.",
        );
      })
      .finally(() => setIsSubmitting(false));
  }

  // --- Historial del libro ---------------------------------------------------
  const [historyType, setHistoryType] = useState<ContainerMovementType | "">("");
  const [historyContainerTypeId, setHistoryContainerTypeId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PaginatedContainerMovements | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listErrorMessage, setListErrorMessage] = useState<string | null>(null);
  const [listReloadToken, setListReloadToken] = useState(0);
  const isSlowList = useSlowRequest(isLoadingList);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingList(true);
    setListErrorMessage(null);

    listContainerMovements(apiClient, {
      page,
      limit: CONTAINER_MOVEMENTS_PAGE_SIZE,
      ...(historyType ? { type: historyType } : {}),
      ...(historyContainerTypeId ? { containerTypeId: historyContainerTypeId } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    })
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setListErrorMessage(
          error instanceof Error ? error.message : "No se pudo cargar el historial.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingList(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, page, historyType, historyContainerTypeId, dateFrom, dateTo, listReloadToken]);

  const listRetry = useCallback(() => setListReloadToken((token) => token + 1), []);

  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;
  const movements = result?.data ?? [];
  const hasFilters =
    historyType !== "" || historyContainerTypeId !== "" || dateFrom !== "" || dateTo !== "";

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Movimientos de envases</h1>
          <p className="page-header__subtitle">
            El libro no se edita ni se borra: un error se corrige registrando el movimiento inverso,
            nunca cambiando este.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card__body">
          <div className="page-header">
            <h2>Registrar movimiento</h2>
          </div>

          {successMessage && (
            <div className="notice notice--info" role="status">
              {successMessage} <Link to="/inventory">Ver inventario actualizado</Link>
            </div>
          )}
          {submitError && (
            <div className="notice notice--error" role="alert">
              {submitError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-grid">
              <div className="field">
                <label className="field__label" htmlFor="movementType">
                  Operación
                </label>
                <select
                  id="movementType"
                  value={type}
                  disabled={isSubmitting}
                  onChange={(event) => handleTypeChange(event.target.value)}
                >
                  <option value="">Selecciona una operación</option>
                  {ALLOWED_MOVEMENT_TYPES.map((movementType) => (
                    <option key={movementType} value={movementType}>
                      {CONTAINER_MOVEMENT_TYPE_LABELS[movementType]}
                    </option>
                  ))}
                </select>
                {typeError && <span className="field__error">{typeError}</span>}
              </div>

              <div className="field">
                <label className="field__label" htmlFor="movementContainerType">
                  Tipo de envase
                </label>
                <select
                  id="movementContainerType"
                  value={containerTypeId}
                  disabled={isSubmitting || isLoadingContainerTypes}
                  onChange={(event) => {
                    setContainerTypeId(event.target.value);
                    setContainerTypeError(undefined);
                  }}
                >
                  <option value="">
                    {isLoadingContainerTypes ? "Cargando…" : "Selecciona un tipo de envase"}
                  </option>
                  {containerTypes.map((containerType) => (
                    <option key={containerType.id} value={containerType.id}>
                      {containerType.name}
                    </option>
                  ))}
                </select>
                {containerTypeError && <span className="field__error">{containerTypeError}</span>}
              </div>

              <div className="field">
                <label className="field__label" htmlFor="movementQuantity">
                  Cantidad
                </label>
                <input
                  id="movementQuantity"
                  type="number"
                  min={1}
                  step={1}
                  value={quantity}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setQuantityError(undefined);
                  }}
                />
                {quantityError && <span className="field__error">{quantityError}</span>}
              </div>

              {requiresOriginChoice && (
                <div className="field">
                  <label className="field__label" htmlFor="movementOrigin">
                    ¿De dónde sale?
                  </label>
                  <select
                    id="movementOrigin"
                    value={originChoice}
                    disabled={isSubmitting}
                    onChange={(event) => handleOriginChange(event.target.value)}
                  >
                    <option value="">Selecciona el origen</option>
                    {origins.map(
                      (state) =>
                        state !== null && (
                          <option key={state} value={state}>
                            {CONTAINER_STATE_ORIGIN_LABELS[state]}
                          </option>
                        ),
                    )}
                  </select>
                  {originError && <span className="field__error">{originError}</span>}
                </div>
              )}

              {touchesCustomer && (
                <>
                  <div className="form-grid__full">
                    <CustomerSelect
                      id="movementCustomer"
                      label="Cliente"
                      value={customer}
                      onChange={handleCustomerChange}
                    />
                    {customerError && <span className="field__error">{customerError}</span>}
                  </div>

                  {customer && (
                    <div className="field">
                      <label className="field__label" htmlFor="movementLocation">
                        Locación
                      </label>
                      {locationsError ? (
                        <ErrorState
                          message={locationsError}
                          onRetry={() => setLocationsReloadToken((token) => token + 1)}
                        />
                      ) : isLoadingLocations ? (
                        <select id="movementLocation" disabled>
                          <option>Cargando…</option>
                        </select>
                      ) : locations.length === 0 ? (
                        <p className="field__error" id="movementLocation">
                          Este cliente no tiene locaciones registradas.
                        </p>
                      ) : (
                        <>
                          <select
                            id="movementLocation"
                            value={locationId}
                            disabled={isSubmitting}
                            onChange={(event) => {
                              setLocationId(event.target.value);
                              setLocationError(undefined);
                            }}
                          >
                            <option value="">Selecciona una locación</option>
                            {locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.name} ({location.address})
                              </option>
                            ))}
                          </select>
                          {locationError && <span className="field__error">{locationError}</span>}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <SlowRequestNotice show={isSlowSubmit && isSubmitting} />

            <div className="form-actions">
              <button type="submit" className="button button--primary" disabled={isSubmitting}>
                {isSubmitting ? "Registrando…" : "Registrar movimiento"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card__body">
          <h2>Historial</h2>
          <p className="page-header__subtitle">
            {isLoadingList && result === null
              ? "Cargando…"
              : `${total} ${total === 1 ? "movimiento" : "movimientos"}${hasFilters ? " con este filtro" : ""}`}
          </p>
        </div>
        <div className="toolbar">
          <div className="field">
            <label className="field__label" htmlFor="historyType">
              Operación
            </label>
            <select
              id="historyType"
              value={historyType}
              onChange={(event) => {
                setHistoryType(event.target.value as ContainerMovementType | "");
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {(Object.keys(CONTAINER_MOVEMENT_TYPE_LABELS) as ContainerMovementType[]).map(
                (movementType) => (
                  <option key={movementType} value={movementType}>
                    {CONTAINER_MOVEMENT_TYPE_LABELS[movementType]}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="historyContainerType">
              Tipo de envase
            </label>
            <select
              id="historyContainerType"
              value={historyContainerTypeId}
              onChange={(event) => {
                setHistoryContainerTypeId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {containerTypes.map((containerType) => (
                <option key={containerType.id} value={containerType.id}>
                  {containerType.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="historyDateFrom">
              Desde
            </label>
            <input
              id="historyDateFrom"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="historyDateTo">
              Hasta
            </label>
            <input
              id="historyDateTo"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
          {hasFilters && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setHistoryType("");
                setHistoryContainerTypeId("");
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <SlowRequestNotice show={isSlowList && isLoadingList} />

        {containerTypesError && (
          <ErrorState
            message={containerTypesError}
            onRetry={() => setContainerTypesReloadToken((token) => token + 1)}
          />
        )}

        {listErrorMessage ? (
          <ErrorState message={listErrorMessage} onRetry={listRetry} />
        ) : isLoadingList ? (
          <p className="state" role="status">
            Cargando historial…
          </p>
        ) : movements.length === 0 ? (
          <HistoryEmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <caption className="visually-hidden">
                  Libro de movimientos de envases con fecha, operación, tipo, cantidad y estados
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Operación</th>
                    <th scope="col">Tipo de envase</th>
                    <th scope="col" className="table__numeric">
                      Cantidad
                    </th>
                    <th scope="col">De → a</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <MovementRow key={movement.id} movement={movement} />
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

function MovementRow({ movement }: { movement: ContainerMovement }) {
  return (
    <tr>
      <td>{formatBusinessDateTime(movement.occurredAt)}</td>
      <td>{CONTAINER_MOVEMENT_TYPE_LABELS[movement.type]}</td>
      <td>{movement.containerType.name}</td>
      <td className="table__numeric">{movement.quantity}</td>
      <td className="cell-secondary">
        {formatStateTransition(movement.fromState, movement.toState)}
      </td>
    </tr>
  );
}

function HistoryEmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="state">
      <p className="state__title">
        {hasFilters ? "Ningún movimiento coincide con el filtro" : "Todavía no hay movimientos"}
      </p>
      <p>
        {hasFilters
          ? "Prueba con otra operación, tipo de envase o rango de fechas."
          : "Los movimientos registrados aparecerán aquí."}
      </p>
    </div>
  );
}
