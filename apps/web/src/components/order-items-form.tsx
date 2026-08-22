import { useEffect, useRef, useState } from "react";
import { MAX_ITEM_QUANTITY } from "../api/orders";
import { listProducts } from "../api/products";
import type { Product } from "../api/products";
import { useAuth } from "../auth/use-auth";
import { formatMoney, isValidMoney, multiplyMoney, sumMoney } from "../lib/money";
import { ErrorState } from "./error-state";

/** One row of the sub-form. `key` is a stable React key, never sent to the API. */
export interface OrderItemDraft {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
}

export function emptyOrderItem(key: number): OrderItemDraft {
  return { key, productId: "", quantity: "1", unitPrice: "" };
}

function parseQuantity(quantity: string): number | null {
  if (!/^\d+$/.test(quantity.trim())) return null;
  return Number(quantity.trim());
}

/** Mirrors CreateOrderItemDto's rules so a bad line never reaches the API. */
export function validateOrderItem(item: OrderItemDraft): string | undefined {
  if (!item.productId) return "Elige un producto";

  const quantity = parseQuantity(item.quantity);
  if (quantity === null || quantity < 1) return "La cantidad debe ser un número entero mayor que 0";
  if (quantity > MAX_ITEM_QUANTITY) {
    return `La cantidad no puede superar ${MAX_ITEM_QUANTITY}`;
  }

  if (!isValidMoney(item.unitPrice.trim())) {
    return 'El precio unitario debe ser un monto como "12.50"';
  }

  return undefined;
}

/** Null when the line isn't complete enough yet to price — never thrown. */
function lineSubtotal(item: OrderItemDraft): string | null {
  const quantity = parseQuantity(item.quantity);
  if (quantity === null || quantity < 1 || !isValidMoney(item.unitPrice.trim())) return null;
  return multiplyMoney(item.unitPrice.trim(), quantity);
}

/** Live order total: sums only the lines that currently price cleanly. */
export function orderItemsTotal(items: OrderItemDraft[]): string {
  const subtotals = items
    .map(lineSubtotal)
    .filter((subtotal): subtotal is string => subtotal !== null);
  return sumMoney(subtotals);
}

export interface OrderItemsFormProps {
  items: OrderItemDraft[];
  errors: (string | undefined)[];
  disabled: boolean;
  /** `changedIndex` is set only for an edit to that line's own fields — never for add/remove. */
  onChange: (items: OrderItemDraft[], changedIndex?: number) => void;
}

/**
 * Product select, quantity and unit price per line, plus the live total.
 * Fetches the (unpaginated) product catalog itself — the only consumer —
 * mirroring how CustomerSelect owns its own customer search.
 */
export function OrderItemsForm({ items, errors, disabled, onChange }: OrderItemsFormProps) {
  const { apiClient } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const nextKeyRef = useRef(items.length);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    listProducts(apiClient)
      .then((data) => {
        if (!cancelled) setProducts(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : "No se pudo cargar el catálogo de productos.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, reloadToken]);

  function updateItem(index: number, patch: Partial<OrderItemDraft>) {
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      index,
    );
  }

  function handleProductChange(index: number, productId: string) {
    const product = products.find((candidate) => candidate.id === productId);
    updateItem(index, { productId, unitPrice: product ? product.listPrice : "" });
  }

  function handleAdd() {
    onChange([...items, emptyOrderItem(nextKeyRef.current++)]);
  }

  function handleRemove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setReloadToken((token) => token + 1)} />;
  }

  const total = orderItemsTotal(items);

  return (
    <div className="order-items">
      <div className="table-scroll">
        <table className="table">
          <caption className="visually-hidden">Ítems del pedido</caption>
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Precio unitario</th>
              <th scope="col" className="table__numeric">
                Subtotal
              </th>
              <th scope="col" className="table__actions">
                <span className="visually-hidden">Quitar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const subtotal = lineSubtotal(item);
              return (
                <tr key={item.key}>
                  <td>
                    <select
                      aria-label={`Producto (ítem ${index + 1})`}
                      value={item.productId}
                      disabled={disabled || isLoading}
                      onChange={(event) => handleProductChange(index, event.target.value)}
                    >
                      <option value="">{isLoading ? "Cargando…" : "Selecciona un producto"}</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Cantidad (ítem ${index + 1})`}
                      type="number"
                      min={1}
                      max={MAX_ITEM_QUANTITY}
                      step={1}
                      value={item.quantity}
                      disabled={disabled}
                      onChange={(event) => updateItem(index, { quantity: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Precio unitario (ítem ${index + 1})`}
                      type="text"
                      inputMode="decimal"
                      placeholder="12.50"
                      value={item.unitPrice}
                      disabled={disabled}
                      onChange={(event) => updateItem(index, { unitPrice: event.target.value })}
                    />
                  </td>
                  <td className="table__numeric">{subtotal ? formatMoney(subtotal) : "—"}</td>
                  <td className="table__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={disabled || items.length <= 1}
                      onClick={() => handleRemove(index)}
                      aria-label={`Quitar ítem ${index + 1}`}
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
                  Ítem {index + 1}: {errors[index]}
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
          Agregar ítem
        </button>
        <div className="order-items__total">
          <span>Total</span>
          <strong>{formatMoney(total)}</strong>
        </div>
      </div>
    </div>
  );
}
