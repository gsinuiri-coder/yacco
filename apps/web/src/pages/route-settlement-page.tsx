import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { listContainerTypes } from "../api/container-types";
import type { ContainerType } from "../api/container-types";
import { ApiError } from "../api/errors";
import {
  containerDifference,
  expectedFullReturn,
  getRouteSettlement,
  settleRoute,
} from "../api/route-settlement";
import type {
  RouteSettlement,
  RouteSettlementDifferences,
  RouteSettlementExpected,
  RouteSettlementView,
} from "../api/route-settlement";
import { getRoute } from "../api/routes";
import type { Route } from "../api/routes";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { RouteStatusBadge } from "../components/route-status-badge";
import { SettlementEmptiesCount } from "../components/settlement-empties-count";
import type { EmptiesCountType } from "../components/settlement-empties-count";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatBusinessDate, formatBusinessDateTime } from "../lib/business-date";
import { formatDifference } from "../lib/difference";
import { formatMoney } from "../lib/money";

function parseCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Un campo vacío es cero: al volver de ruta el camión se descarga entero. */
function parseEmptiesCount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  return parseCount(trimmed);
}

/**
 * Los tipos que se pueden contar: el catálogo activo MÁS cualquiera que el
 * libro diga que se recogió. Un tipo retirado que todavía vuelve del camión
 * tiene que poder contarse, y `GET /container-types` no lo devuelve.
 */
function countableTypes(
  containerTypes: ContainerType[],
  expected: RouteSettlementExpected,
): EmptiesCountType[] {
  const fromCatalog = containerTypes.map((type) => ({ id: type.id, name: type.name }));
  const missing = expected.emptiesPickedUpByType
    .filter((line) => !containerTypes.some((type) => type.id === line.containerTypeId))
    .map((line) => ({ id: line.containerTypeId, name: line.containerTypeName }));
  return [...fromCatalog, ...missing];
}

/**
 * La liquidación de la ruta (HU-17). Es la pantalla contra la que se cuentan
 * los envases en la puerta de la planta, así que sirve ANTES de liquidar:
 * muestra lo que dice el libro, pide los dos únicos números que cuenta una
 * persona —llenos que volvieron y vacíos descargados— y recién entonces
 * calcula las diferencias.
 *
 * Una diferencia se muestra con su número y su razón, y **nunca** bloquea el
 * cierre: es la misma filosofía que el resto del sistema. La nota libre está
 * ahí justamente para explicarla.
 */
export function RouteSettlementPage() {
  const { routeId } = useParams<{ routeId: string }>();
  const { apiClient } = useAuth();
  const navigate = useNavigate();

  const [route, setRoute] = useState<Route | null>(null);
  const [view, setView] = useState<RouteSettlementView | null>(null);
  const [containerTypes, setContainerTypes] = useState<ContainerType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isSlowLoad = useSlowRequest(isLoading);

  const [fullReturned, setFullReturned] = useState("");
  /** Lo escrito por tipo de envase, en crudo, indexado por su id. */
  const [emptiesByType, setEmptiesByType] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [differences, setDifferences] = useState<RouteSettlementDifferences | null>(null);

  useEffect(() => {
    if (!routeId) return;
    let ignore = false;
    setIsLoading(true);
    setLoadError(null);

    Promise.all([
      getRoute(apiClient, routeId),
      getRouteSettlement(apiClient, routeId),
      // El catálogo se lee de su propio endpoint, nunca se deriva de otro
      // recurso: es lo que arma la hoja de conteo de vacíos por tipo.
      listContainerTypes(apiClient),
    ])
      .then(([routeResponse, viewResponse, containerTypesResponse]) => {
        if (ignore) return;
        setRoute(routeResponse);
        setView(viewResponse);
        setContainerTypes(containerTypesResponse);
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setLoadError(
          error instanceof Error ? error : new Error("No se pudo cargar la liquidación."),
        );
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [apiClient, routeId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !routeId) return;

    const returned = parseCount(fullReturned);
    if (returned === null) {
      setValidationError("Los llenos que volvieron deben ser un número entero, 0 o más");
      return;
    }
    const invalid = countedEmpties.find((row) => row.quantity === null);
    if (invalid !== undefined) {
      setValidationError(
        `Los vacíos contados de ${invalid.type.name} deben ser un número entero, 0 o más`,
      );
      return;
    }

    setValidationError(null);
    setIsSubmitting(true);
    setSubmitError(null);
    settleRoute(apiClient, routeId, {
      fullReturned: returned,
      // Solo las líneas con algo: contar cero de un tipo no es un movimiento.
      emptiesCollected: countedEmpties
        .filter((row) => (row.quantity ?? 0) > 0)
        .map((row) => ({ containerTypeId: row.type.id, quantity: row.quantity as number })),
      ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
    })
      .then((response) => {
        setDifferences(response.differences);
        reload();
      })
      .catch((error: unknown) => {
        // El 403 (solo ADMIN liquida) y el 409 (la ruta no está terminada, o
        // ya se liquidó) llegan del backend con su mensaje; el 403 de Nest es
        // genérico, así que ese sí se traduce al vocabulario de la planta.
        if (error instanceof ApiError && error.status === 403) {
          setSubmitError("Solo un administrador puede liquidar la ruta.");
        } else {
          setSubmitError(error instanceof Error ? error.message : "No se pudo liquidar la ruta.");
        }
        setIsSubmitting(false);
      });
  }

  const notFound = loadError instanceof ApiError && loadError.status === 404;
  const settlement = view?.settlement ?? null;
  const canSettle = route?.status === "FINISHED" && settlement === null;

  const emptiesTypes = view === null ? [] : countableTypes(containerTypes, view.expected);
  const countedEmpties = emptiesTypes.map((type) => ({
    type,
    quantity: parseEmptiesCount(emptiesByType[type.id] ?? ""),
  }));
  const emptiesTotal = countedEmpties.reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  const emptiesAreValid = countedEmpties.every((row) => row.quantity !== null);
  /**
   * El aviso agregado no aparece hasta que alguien escribió algo: un campo
   * vacío vale cero, pero abrir la pantalla ya con una diferencia en rojo
   * gritaría antes de que nadie cuente nada. La tabla, en cambio, sí muestra
   * la diferencia línea por línea desde el arranque — ahí es una columna, no
   * un aviso, y es lo que hace visible que un campo vacío es un cero.
   */
  const someEmptiesTyped = emptiesTypes.some(
    (type) => (emptiesByType[type.id] ?? "").trim() !== "",
  );

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>
            {route ? `Liquidación de la ruta del ${formatBusinessDate(route.date)}` : "Liquidación"}
          </h1>
          <p className="page-header__subtitle">{route ? route.driver.name : "Cargando…"}</p>
        </div>
        <div className="page-header__actions">
          {routeId && (
            <Link to={`/routes/${routeId}`} className="button button--secondary">
              Volver a la ruta
            </Link>
          )}
        </div>
      </div>

      {isSlowLoad && isLoading && (
        <p className="notice notice--info" role="status">
          {SLOW_REQUEST_MESSAGE}
        </p>
      )}

      {isLoading ? (
        <p className="state card" role="status">
          Cargando liquidación…
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
          <p className="state__title">No se pudo cargar la liquidación</p>
          <p role="alert">{loadError.message}</p>
          <div className="state__actions">
            <button type="button" className="button button--secondary" onClick={reload}>
              Reintentar
            </button>
          </div>
        </div>
      ) : route && view ? (
        <>
          <section className="card">
            <div className="card__body">
              <div className="form-grid">
                <div className="stat">
                  <span className="stat__label">Estado de la ruta</span>
                  <span className="stat__value">
                    <RouteStatusBadge status={route.status} />
                  </span>
                </div>
                <div className="stat">
                  <span className="stat__label">Chofer</span>
                  <span className="stat__value">{route.driver.name}</span>
                </div>
              </div>
              {view.unresolvedStops > 0 && (
                <p className="notice notice--warning" role="status">
                  {view.unresolvedStops === 1
                    ? "Queda 1 parada sin resolver: lo que haya pasado ahí no está en estos números."
                    : `Quedan ${view.unresolvedStops} paradas sin resolver: lo que haya pasado ahí no está en estos números.`}
                </p>
              )}
              {route.status === "IN_PROGRESS" && (
                <p className="notice notice--info" role="status">
                  La ruta todavía está en curso. Se puede liquidar cuando esté terminada.
                </p>
              )}
              {route.status === "PLANNED" && (
                <p className="notice notice--info" role="status">
                  La ruta todavía no salió. Se puede liquidar cuando esté terminada.
                </p>
              )}
            </div>
          </section>

          {/* Con la ruta liquidada, el dinero de referencia es el de la fila
              persistida, que se muestra más abajo: repetirlo acá arriba solo
              invita a preguntar cuál de los dos vale. */}
          <ExpectedSection expected={view.expected} showMoney={settlement === null} />

          {settlement === null ? (
            <section className="card">
              <div className="card__body">
                <h2>Lo que se contó en la puerta</h2>
                <p className="text-muted">
                  Lo único que se cuenta a mano. Todo lo demás sale del libro.
                </p>
              </div>
              <form
                className="card__body"
                onSubmit={handleSubmit}
                noValidate
                aria-label="Liquidar la ruta"
              >
                <div className="form-grid">
                  <div className="field">
                    <label className="field__label" htmlFor="fullReturned">
                      Llenos que volvieron sin entregar
                    </label>
                    <input
                      id="fullReturned"
                      type="number"
                      min={0}
                      step={1}
                      value={fullReturned}
                      disabled={isSubmitting || !canSettle}
                      onChange={(event) => {
                        setFullReturned(event.target.value);
                        setValidationError(null);
                      }}
                    />
                    <span className="field__hint">
                      Según el libro deberían volver {expectedFullReturn(view.expected)}.
                    </span>
                  </div>
                  <div className="field form-grid__full">
                    <label className="field__label" htmlFor="settlementNotes">
                      Nota (opcional)
                    </label>
                    <input
                      id="settlementNotes"
                      type="text"
                      value={notes}
                      disabled={isSubmitting || !canSettle}
                      placeholder="Faltaron 2 bidones; el chofer dice que se rompió uno en la ruta"
                      onChange={(event) => setNotes(event.target.value)}
                    />
                    <span className="field__hint">
                      Si hay una diferencia, acá se explica. La diferencia se registra igual.
                    </span>
                  </div>
                </div>

                <h3>Vacíos contados al descargar</h3>
                <p className="text-muted">
                  Uno por tipo de envase: cada línea vuelve al galpón como su propio movimiento. Un
                  campo vacío cuenta como cero.
                </p>
                <SettlementEmptiesCount
                  types={emptiesTypes}
                  pickedUpByType={view.expected.emptiesPickedUpByType}
                  counted={emptiesByType}
                  disabled={isSubmitting || !canSettle}
                  onChange={(containerTypeId, value) => {
                    setEmptiesByType((current) => ({ ...current, [containerTypeId]: value }));
                    setValidationError(null);
                  }}
                />

                <LiveDifferences
                  expected={view.expected}
                  fullReturned={parseCount(fullReturned)}
                  emptiesCollected={someEmptiesTyped && emptiesAreValid ? emptiesTotal : null}
                />

                {validationError && (
                  <div className="notice notice--error" role="alert">
                    {validationError}
                  </div>
                )}
                {submitError && (
                  <div className="notice notice--error" role="alert">
                    {submitError}
                  </div>
                )}
                <div className="form-actions">
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={isSubmitting || !canSettle}
                  >
                    {isSubmitting ? "Liquidando…" : "Liquidar la ruta"}
                  </button>
                </div>
                {!canSettle && (
                  <p className="cell-secondary">Solo se liquida una ruta terminada.</p>
                )}
              </form>
            </section>
          ) : (
            <SettledSection
              settlement={settlement}
              expected={view.expected}
              differences={differences}
              settlementOutdated={view.settlementOutdated}
            />
          )}
        </>
      ) : null}
    </AppShell>
  );
}

function ExpectedSection({
  expected,
  showMoney,
}: {
  expected: RouteSettlementExpected;
  showMoney: boolean;
}) {
  return (
    <section className="card">
      <div className="card__body">
        <h2>Lo que dice el libro</h2>
        <p className="text-muted">
          Todo esto sale de lo ya registrado en la ruta; nadie lo escribe a mano.
        </p>
        <div className="form-grid">
          <div className="stat">
            <span className="stat__label">Llenos que salieron</span>
            <span className="stat__value">{expected.fullOut}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Entregados en canje</span>
            <span className="stat__value">{expected.fullDelivered}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Vendidos completos</span>
            <span className="stat__value">{expected.fullSold}</span>
            <span className="stat__note">Esos envases salieron del parque.</span>
          </div>
          <div className="stat">
            <span className="stat__label">Deberían volver</span>
            <span className="stat__value">{expectedFullReturn(expected)}</span>
            <span className="stat__note">Salieron menos entregados menos vendidos.</span>
          </div>
          <div className="stat">
            <span className="stat__label">Vacíos recogidos</span>
            <span className="stat__value">{expected.emptiesPickedUp}</span>
          </div>
        </div>
      </div>

      {showMoney && (
        <div className="card__body">
          <h3>Dinero</h3>
          <div className="form-grid">
            <div className="stat">
              <span className="stat__label">Total vendido</span>
              <span className="stat__value">{formatMoney(expected.totalSold)}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Cobrado</span>
              <span className="stat__value">{formatMoney(expected.totalCollected)}</span>
            </div>
            <div className="stat">
              <span className="stat__label">En efectivo</span>
              <span className="stat__value">{formatMoney(expected.totalCashCollected)}</span>
              <span className="stat__note">Es lo que el chofer trae en la mano.</span>
            </div>
            <div className="stat">
              <span className="stat__label">Por confirmar</span>
              <span className="stat__value">{formatMoney(expected.totalPendingConfirmation)}</span>
              <span className="stat__note">Yape, Plin o transferencias sin verificar.</span>
            </div>
            <div className="stat">
              <span className="stat__label">Al fiado</span>
              <span className="stat__value">{formatMoney(expected.totalOnCredit)}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Las diferencias antes de enviar, para que quien cuenta las vea y pueda
 * escribir la nota que las explica. No bloquean nada: son un aviso.
 */
function LiveDifferences({
  expected,
  fullReturned,
  emptiesCollected,
}: {
  expected: RouteSettlementExpected;
  fullReturned: number | null;
  emptiesCollected: number | null;
}) {
  if (fullReturned === null && emptiesCollected === null) return null;

  const containers = fullReturned === null ? null : expectedFullReturn(expected) - fullReturned;
  const empties = emptiesCollected === null ? null : expected.emptiesPickedUp - emptiesCollected;

  if ((containers === null || containers === 0) && (empties === null || empties === 0)) {
    return (
      <p className="notice notice--info" role="status">
        Con estos números la ruta cuadra.
      </p>
    );
  }

  return (
    <div className="notice notice--warning" role="status">
      <p>Con estos números va a quedar registrada una diferencia:</p>
      <ul>
        {containers !== null && containers !== 0 && (
          <li>
            Llenos: {formatDifference(containers)} ({containers > 0 ? "faltan" : "sobran"}{" "}
            {Math.abs(containers)} respecto del libro).
          </li>
        )}
        {empties !== null && empties !== 0 && (
          <li>
            Vacíos: {formatDifference(empties)} ({empties > 0 ? "faltan" : "sobran"}{" "}
            {Math.abs(empties)} respecto del libro).
          </li>
        )}
      </ul>
      <p>Se puede liquidar igual: la diferencia queda registrada, no bloquea el cierre.</p>
    </div>
  );
}

/**
 * "(faltan 2)" al lado de un tipo, solo cuando su diferencia no es cero. El
 * total y sus dos diferencias de arriba siguen mostrándose siempre; esto es lo
 * que el total puede estar escondiendo cuando dos tipos se compensan.
 */
function describeTypeDifference(
  differences: RouteSettlementDifferences,
  line: { containerTypeId: string },
): string {
  const found = differences.emptiesByType.find(
    (row) => row.containerTypeId === line.containerTypeId,
  );
  if (found === undefined || found.difference === 0) return "";
  return `(${formatDifference(found.difference)}: ${found.difference > 0 ? "faltan" : "sobran"} ${Math.abs(found.difference)} respecto del libro)`;
}

function SettledSection({
  settlement,
  expected,
  differences,
  settlementOutdated,
}: {
  settlement: RouteSettlement;
  expected: RouteSettlementExpected;
  /**
   * Solo llega en la respuesta del POST. Al volver a entrar, la diferencia de
   * llenos se recalcula de la fila persistida con la misma fórmula que usa la
   * API; la de vacíos se recalcula contra `expected.emptiesPickedUp`.
   */
  differences: RouteSettlementDifferences | null;
  /**
   * Lo manda la vista tal cual (`GET /routes/:id/settlement`); no se deriva
   * de ninguna otra cosa de esta pantalla. Mide una sola cosa: se corrigió
   * una parada después del cierre.
   */
  settlementOutdated: boolean;
}) {
  const containers = differences?.containers ?? containerDifference(settlement);
  const empties = differences?.empties ?? expected.emptiesPickedUp - settlement.emptiesCollected;
  /**
   * Una liquidación congela el dinero del momento en que se cerró. Si después
   * se rechaza un pago que estaba PENDING, el libro cambia y la fila no: eso
   * es una deuda técnica conocida (docs/backlog-tecnico.md, "Una liquidación
   * puede quedar desactualizada"). Mientras exista, la pantalla al menos lo
   * dice en vez de mostrar un número que ya no es cierto sin avisar.
   */
  const moneyDrifted =
    settlement.totalCollected !== expected.totalCollected ||
    settlement.totalPendingConfirmation !== expected.totalPendingConfirmation;

  return (
    <section className="card">
      <div className="card__body">
        {/* Dice lo que el flag mide y nada más: se corrigió una parada después
            del cierre. NO dice que la liquidación esté mal ni que no cuadre —
            corregir una ruta ya liquidada está permitido a propósito. */}
        {settlementOutdated && (
          <p className="notice notice--warning" role="status">
            Se corrigió una parada después de cerrar esta liquidación. Los números de abajo son los
            del momento del cierre.
          </p>
        )}
        <h2>Liquidada</h2>
        <p className="text-muted">Cerrada el {formatBusinessDateTime(settlement.settledAt)}.</p>
        <div className="form-grid">
          <div className="stat">
            <span className="stat__label">Llenos que volvieron</span>
            <span className="stat__value">{settlement.fullReturned}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Vacíos contados</span>
            <span className="stat__value">{settlement.emptiesCollected}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Diferencia de llenos</span>
            <span className={`stat__value ${containers === 0 ? "money--clear" : "money--owed"}`}>
              {containers === 0 ? "Cuadró" : formatDifference(containers)}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Diferencia de vacíos</span>
            <span className={`stat__value ${empties === 0 ? "money--clear" : "money--owed"}`}>
              {empties === 0 ? "Cuadró" : formatDifference(empties)}
            </span>
          </div>
        </div>
        {/* Lo contado, tipo por tipo: es lo que volvió al galpón, reconstruido
            del libro. Las diferencias por tipo solo llegan en la respuesta del
            POST; al volver a entrar quedan el total y las dos de arriba. */}
        {settlement.emptiesCollectedByType.length > 0 && (
          <>
            <h3>Vacíos descargados, por tipo</h3>
            <ul>
              {settlement.emptiesCollectedByType.map((line) => (
                <li key={line.containerTypeId}>
                  {line.containerTypeName}: {line.quantity}
                  {differences !== null && <> {describeTypeDifference(differences, line)}</>}
                </li>
              ))}
            </ul>
          </>
        )}
        {settlement.notes && (
          <p>
            <strong>Nota:</strong> {settlement.notes}
          </p>
        )}
      </div>

      <div className="card__body">
        <h3>Dinero de la ruta</h3>
        {/* La misma deriva tiene dos causas distintas y solo una se puede
            nombrar con certeza. Con `settlementOutdated` en false, lo único
            que pudo mover el dinero es que se resolviera un pago pendiente, y
            el aviso lo dice. Con el flag en true hay además una corrección
            posterior al cierre, que también mueve `totalCollected`: atribuirlo
            entonces a los pagos sería nombrar la causa equivocada, así que
            este aviso se queda en el hecho y la causa la explica el de
            arriba. */}
        {moneyDrifted && (
          <p className="notice notice--warning" role="status">
            {settlementOutdated ? (
              <>
                Estos son los montos del momento en que se liquidó. El libro hoy dice{" "}
                {formatMoney(expected.totalCollected)} cobrado.
              </>
            ) : (
              <>
                Estos son los montos del momento en que se liquidó. Desde entonces se resolvió algún
                pago que estaba por confirmar, así que el libro hoy dice{" "}
                {formatMoney(expected.totalCollected)} cobrado.
              </>
            )}
          </p>
        )}
        <div className="form-grid">
          <div className="stat">
            <span className="stat__label">Total vendido</span>
            <span className="stat__value">{formatMoney(settlement.totalSold)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Cobrado</span>
            <span className="stat__value">{formatMoney(settlement.totalCollected)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">En efectivo</span>
            <span className="stat__value">{formatMoney(settlement.totalCashCollected)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Por confirmar</span>
            <span className="stat__value">{formatMoney(settlement.totalPendingConfirmation)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Al fiado</span>
            <span className="stat__value">{formatMoney(settlement.totalOnCredit)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
