import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { listContainerTypes } from "../api/container-types";
import type { ContainerType } from "../api/container-types";
import { listProductionBatches } from "../api/production-batches";
import type { ProductionBatch } from "../api/production-batches";
import { addRouteLoad, listRouteLoads, removeRouteLoad } from "../api/routes";
import type { Route, RouteLoad } from "../api/routes";
import { useAuth } from "../auth/use-auth";
import { formatBusinessDate } from "../lib/business-date";
import { planFifoLoad } from "../lib/fifo-load-plan";
import type { LoadPlanLine } from "../lib/fifo-load-plan";

/**
 * Tope de `GET /production-batches` (MAX_LIMIT). Con `withStock=true` y el
 * orden por fecha ascendente, esta primera página son SIEMPRE los lotes más
 * antiguos con stock, que es de donde FIFO consume: pedir más no cambiaría
 * ningún reparto.
 */
const BATCHES_LIMIT = 100;

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value.trim());
  return quantity > 0 ? quantity : null;
}

/** "3 lotes: 30 del LOTE-A (01/08/2026), 20 del LOTE-B (03/08/2026)". */
function describePlan(lines: LoadPlanLine[]): string {
  return lines
    .map((line) => `${line.quantity} del ${line.batchCode} (${formatBusinessDate(line.batchDate)})`)
    .join(", ");
}

/** Lo que hay arriba del camión, sumado por tipo de envase. */
function summarizeLoads(loads: RouteLoad[]): { name: string; quantity: number }[] {
  const byType = new Map<string, { name: string; quantity: number }>();
  for (const load of loads) {
    const key = load.batchItem.containerTypeId;
    const current = byType.get(key);
    byType.set(key, {
      name: load.batchItem.containerType.name,
      quantity: (current?.quantity ?? 0) + load.quantity,
    });
  }
  return [...byType.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * La carga del camión. La oficina dice qué tipo de envase y cuántas
 * unidades; de qué lotes salen lo decide el reparto FIFO (ver
 * lib/fifo-load-plan.ts), y se muestra antes de enviar.
 *
 * Un pedido que abarca dos lotes son dos `POST /routes/:id/loads`, uno por
 * lote: la API registra un RouteLoad y un movimiento ROUTE_LOAD por llamada,
 * y esa correspondencia uno a uno es justamente lo que después le permite a
 * DELETE revertir una carga sin ambigüedad. Si el segundo POST fallara, el
 * primero queda registrado y a la vista, listo para corregirse.
 */
export function RouteLoadsSection({ route }: { route: Route }) {
  const { apiClient } = useAuth();

  const [loads, setLoads] = useState<RouteLoad[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const [containerTypes, setContainerTypes] = useState<ContainerType[]>([]);

  const [containerTypeId, setContainerTypeId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [removingLoadId, setRemovingLoadId] = useState<string | null>(null);
  const [busyLoadId, setBusyLoadId] = useState<string | null>(null);

  const editable = route.status === "PLANNED" || route.status === "IN_PROGRESS";
  // La API solo deja corregir una carga con la ruta PLANNED: una vez que el
  // camión salió, un error de carga se resuelve en la liquidación.
  const canRemove = route.status === "PLANNED";

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    listRouteLoads(apiClient, route.id)
      .then((response) => {
        if (!cancelled) setLoads(response);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(describeError(error, "No se pudo cargar lo que lleva el camión."));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, route.id, reloadToken]);

  // Lotes con stock, del más antiguo al más nuevo: ese es el orden FIFO en
  // que se consumen. El catálogo de tipos de envase viene de su propio
  // endpoint, nunca derivado de los lotes.
  useEffect(() => {
    let cancelled = false;
    listProductionBatches(apiClient, { withStock: true, limit: BATCHES_LIMIT })
      .then((response) => {
        if (!cancelled) setBatches(response.data);
      })
      .catch(() => {
        if (!cancelled) setBatches([]);
      });
    listContainerTypes(apiClient)
      .then((response) => {
        if (!cancelled) setContainerTypes(response);
      })
      .catch(() => {
        if (!cancelled) setContainerTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const requestedQuantity = parseQuantity(quantity);
  const plan =
    containerTypeId === "" ? null : planFifoLoad(batches, containerTypeId, requestedQuantity ?? 0);

  async function submitPlan(lines: LoadPlanLine[]) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      for (const line of lines) {
        await addRouteLoad(apiClient, route.id, {
          batchItemId: line.batchItemId,
          quantity: line.quantity,
        });
      }
      setQuantity("");
      reload();
    } catch (error: unknown) {
      // El 400 de la API nombra el problema concreto (stock insuficiente,
      // ruta terminada); se muestra tal cual.
      setSubmitError(describeError(error, "No se pudo cargar el camión."));
      // Lo que sí llegó a registrarse tiene que verse: la tabla se recarga
      // aunque una de las llamadas haya fallado.
      reload();
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (containerTypeId === "") {
      setValidationError("Elige qué tipo de envase sube al camión");
      return;
    }
    if (requestedQuantity === null) {
      setValidationError("La cantidad debe ser un número entero mayor que 0");
      return;
    }
    if (plan === null || plan.shortfall > 0) {
      setValidationError(
        `En la planta hay ${plan?.available ?? 0} disponibles de ese envase; no alcanzan para ${requestedQuantity}`,
      );
      return;
    }

    setValidationError(null);
    void submitPlan(plan.lines);
  }

  function remove(load: RouteLoad) {
    if (busyLoadId !== null) return;
    setBusyLoadId(load.id);
    setSubmitError(null);
    removeRouteLoad(apiClient, route.id, load.id)
      .then(() => {
        setRemovingLoadId(null);
        reload();
      })
      .catch((error: unknown) => {
        setSubmitError(describeError(error, "No se pudo corregir la carga."));
        setRemovingLoadId(null);
      })
      .finally(() => setBusyLoadId(null));
  }

  const summary = summarizeLoads(loads);

  return (
    <section className="card">
      <div className="card__body">
        <h2>Carga del camión</h2>
        <p className="page-header__subtitle">
          Lo que sube sale siempre del lote más antiguo que todavía tenga unidades.
          {canRemove && " Mientras la ruta no arranque se puede corregir; después ya no."}
        </p>
        {summary.length > 0 && (
          <p>
            <strong>Arriba del camión:</strong>{" "}
            {summary.map((entry) => `${entry.quantity} × ${entry.name}`).join(", ")}
          </p>
        )}
      </div>

      {editable && (
        <form
          className="card__body"
          onSubmit={handleSubmit}
          noValidate
          aria-label="Cargar el camión"
        >
          <div className="form-grid">
            <div className="field">
              <label className="field__label" htmlFor="loadContainerType">
                Tipo de envase
              </label>
              <select
                id="loadContainerType"
                value={containerTypeId}
                disabled={isSubmitting}
                onChange={(event) => {
                  setContainerTypeId(event.target.value);
                  setValidationError(null);
                }}
              >
                <option value="">Elige un tipo de envase</option>
                {containerTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
              {plan && (
                <span className="field__hint">En la planta hay {plan.available} disponibles.</span>
              )}
            </div>
            <div className="field">
              <label className="field__label" htmlFor="loadQuantity">
                Cantidad
              </label>
              <input
                id="loadQuantity"
                type="number"
                min={1}
                step={1}
                value={quantity}
                disabled={isSubmitting}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setValidationError(null);
                }}
              />
              {plan && requestedQuantity !== null && plan.lines.length > 0 && (
                <span className="field__hint">Sale de: {describePlan(plan.lines)}</span>
              )}
            </div>
          </div>

          {/* Sin botón de cancelar, a diferencia de los formularios que se
              abren y se cierran: este vive siempre en la sección, así que no
              hay nada que cancelar — solo enviar. */}
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
            <button type="submit" className="button button--primary" disabled={isSubmitting}>
              {isSubmitting ? "Cargando…" : "Cargar al camión"}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="state" role="status">
          Cargando lo que lleva el camión…
        </p>
      ) : loadError ? (
        <div className="state">
          <p className="state__title">No se pudo cargar lo que lleva el camión</p>
          <p role="alert">{loadError}</p>
          <div className="state__actions">
            <button type="button" className="button button--secondary" onClick={reload}>
              Reintentar
            </button>
          </div>
        </div>
      ) : loads.length === 0 ? (
        <div className="state">
          <p className="state__title">El camión todavía va vacío</p>
          <p>
            {editable
              ? "Elige el tipo de envase y cuántas unidades suben; el sistema toma primero el lote más antiguo."
              : "Esta ruta salió sin carga registrada."}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <caption className="visually-hidden">
              Lo cargado al camión, con el lote del que salió, el tipo de envase y la cantidad
            </caption>
            <thead>
              <tr>
                <th scope="col">Lote</th>
                <th scope="col">Tipo de envase</th>
                <th scope="col" className="table__numeric">
                  Cantidad
                </th>
                {canRemove && (
                  <th scope="col" className="table__actions">
                    <span className="visually-hidden">Acciones</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loads.map((load) => (
                <tr key={load.id}>
                  <td>{load.batchItem.batch.code}</td>
                  <td>{load.batchItem.containerType.name}</td>
                  <td className="table__numeric">{load.quantity}</td>
                  {canRemove && (
                    <td className="table__actions">
                      {removingLoadId === load.id ? (
                        <span
                          role="group"
                          aria-label={`Confirmar corregir la carga del lote ${load.batchItem.batch.code}`}
                        >
                          ¿Quitar esta carga del camión?{" "}
                          <button
                            type="button"
                            className="button button--ghost"
                            disabled={busyLoadId !== null}
                            onClick={() => setRemovingLoadId(null)}
                          >
                            No
                          </button>
                          <button
                            type="button"
                            className="button button--ghost"
                            disabled={busyLoadId !== null}
                            onClick={() => remove(load)}
                          >
                            Sí, quitar
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="button button--ghost"
                          aria-label={`Corregir la carga del lote ${load.batchItem.batch.code}`}
                          disabled={busyLoadId !== null}
                          onClick={() => setRemovingLoadId(load.id)}
                        >
                          Corregir
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!canRemove && loads.length > 0 && (
            <p className="card__body cell-secondary">
              Con la ruta ya iniciada, una carga mal ingresada no se borra: la diferencia se
              registra al liquidar.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
