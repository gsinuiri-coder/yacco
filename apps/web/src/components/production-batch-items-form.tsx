import { useEffect, useRef, useState } from "react";
// CreateProductionBatchItemDto imports its Max(...) limit from the same
// create-order.dto.ts constant, so the two forms share it here too.
import { MAX_ITEM_QUANTITY } from "../api/orders";
import { listContainerTypes } from "../api/container-types";
import type { ContainerType } from "../api/container-types";
import { useAuth } from "../auth/use-auth";
import { ErrorState } from "./error-state";

/** One row of the sub-form. `key` is a stable React key, never sent to the API. */
export interface ProductionBatchItemDraft {
  key: number;
  containerTypeId: string;
  producedQty: string;
}

export function emptyProductionBatchItem(key: number): ProductionBatchItemDraft {
  return { key, containerTypeId: "", producedQty: "" };
}

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Mirrors CreateProductionBatchItemDto's rules so a bad line never reaches the API. */
export function validateProductionBatchItem(item: ProductionBatchItemDraft): string | undefined {
  if (!item.containerTypeId) return "Elige un tipo de envase";

  const quantity = parseQuantity(item.producedQty);
  if (quantity === null || quantity < 1) {
    return "La cantidad producida debe ser un número entero mayor que 0";
  }
  if (quantity > MAX_ITEM_QUANTITY) {
    return `La cantidad producida no puede superar ${MAX_ITEM_QUANTITY}`;
  }

  return undefined;
}

export interface ProductionBatchItemsFormProps {
  items: ProductionBatchItemDraft[];
  errors: (string | undefined)[];
  disabled: boolean;
  /** `changedIndex` is set only for an edit to that line's own fields — never for add/remove. */
  onChange: (items: ProductionBatchItemDraft[], changedIndex?: number) => void;
}

/**
 * Container type and produced quantity per line. Fetches the (unpaginated)
 * container-type catalog itself — the only consumer — mirroring how
 * OrderItemsForm owns its own product catalog fetch.
 *
 * A container type already chosen in another line is never offered again:
 * the backend rejects a repeated line, so each line's own dropdown excludes
 * whatever the other lines currently hold, rather than letting the submit
 * fail on a duplicate.
 */
export function ProductionBatchItemsForm({
  items,
  errors,
  disabled,
  onChange,
}: ProductionBatchItemsFormProps) {
  const { apiClient } = useAuth();
  const [containerTypes, setContainerTypes] = useState<ContainerType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const nextKeyRef = useRef(items.length);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    listContainerTypes(apiClient)
      .then((data) => {
        if (!cancelled) setContainerTypes(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar el catálogo de tipos de envase.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, reloadToken]);

  function updateItem(index: number, patch: Partial<ProductionBatchItemDraft>) {
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      index,
    );
  }

  function handleAdd() {
    onChange([...items, emptyProductionBatchItem(nextKeyRef.current++)]);
  }

  function handleRemove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setReloadToken((token) => token + 1)} />;
  }

  return (
    <div className="order-items">
      <div className="table-scroll">
        <table className="table">
          <caption className="visually-hidden">Líneas del lote de producción</caption>
          <thead>
            <tr>
              <th scope="col">Tipo de envase</th>
              <th scope="col">Cantidad producida</th>
              <th scope="col" className="table__actions">
                <span className="visually-hidden">Quitar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const chosenElsewhere = new Set(
                items
                  .filter((_, i) => i !== index)
                  .map((other) => other.containerTypeId)
                  .filter(Boolean),
              );
              const options = containerTypes.filter(
                (containerType) =>
                  containerType.id === item.containerTypeId ||
                  !chosenElsewhere.has(containerType.id),
              );

              return (
                <tr key={item.key}>
                  <td>
                    <select
                      aria-label={`Tipo de envase (línea ${index + 1})`}
                      value={item.containerTypeId}
                      disabled={disabled || isLoading}
                      onChange={(event) =>
                        updateItem(index, { containerTypeId: event.target.value })
                      }
                    >
                      <option value="">
                        {isLoading ? "Cargando…" : "Selecciona un tipo de envase"}
                      </option>
                      {options.map((containerType) => (
                        <option key={containerType.id} value={containerType.id}>
                          {containerType.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Cantidad producida (línea ${index + 1})`}
                      type="number"
                      min={1}
                      max={MAX_ITEM_QUANTITY}
                      step={1}
                      value={item.producedQty}
                      disabled={disabled}
                      onChange={(event) => updateItem(index, { producedQty: event.target.value })}
                    />
                  </td>
                  <td className="table__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={disabled || items.length <= 1}
                      onClick={() => handleRemove(index)}
                      aria-label={`Quitar línea ${index + 1}`}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {items.some((_, index) => errors[index]) && (
        <ul className="order-items__errors">
          {items.map(
            (item, index) =>
              errors[index] && (
                <li key={item.key} className="field__error">
                  Línea {index + 1}: {errors[index]}
                </li>
              ),
          )}
        </ul>
      )}

      <div className="order-items__footer">
        <button
          type="button"
          className="button button--secondary"
          disabled={disabled || isLoading}
          onClick={handleAdd}
        >
          Agregar línea
        </button>
      </div>
    </div>
  );
}
