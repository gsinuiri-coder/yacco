import { useEffect, useRef, useState } from "react";
import { listEffectivePrices } from "../api/customer-prices";
import type { EffectivePrice, PriceSource } from "../api/customer-prices";
import { MAX_ITEM_QUANTITY } from "../api/orders";
import { listProducts } from "../api/products";
import type { Product } from "../api/products";
import { useAuth } from "../auth/use-auth";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatMoney, isValidMoney, multiplyMoney, sumMoney } from "../lib/money";
import { ErrorState } from "./error-state";
import { SlowRequestNotice } from "./slow-request-notice";

/**
 * One row of the sub-form. `key` is a stable React key, never sent to the
 * API. `priceOrigin` is set whenever `unitPrice` is a computed prefill (from
 * an agreed price or, failing that, the list price) so a customer change
 * knows which lines are safe to reprice; it is cleared to `null` the moment
 * the seller types into the price field by hand, marking that value as
 * theirs to keep.
 */
export interface OrderItemDraft {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  priceOrigin: PriceSource | null;
}

export function emptyOrderItem(key: number): OrderItemDraft {
  return { key, productId: "", quantity: "1", unitPrice: "", priceOrigin: null };
}

/**
 * Prefill for a chosen product: the agreed price when the effective-prices
 * lookup has one and is trustworthy, the catalog list price otherwise. Never
 * reimplements the precedence rule itself — that's `source`, straight from
 * the backend's own resolution.
 */
function resolvePriceForProduct(
  productId: string,
  products: Product[],
  effectivePrices: EffectivePrice[],
  pricesAvailable: boolean,
): { unitPrice: string; priceOrigin: PriceSource | null } {
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) return { unitPrice: "", priceOrigin: null };

  if (pricesAvailable) {
    const match = effectivePrices.find((price) => price.product.id === productId);
    if (match) return { unitPrice: match.price, priceOrigin: match.source };
  }

  return { unitPrice: product.listPrice, priceOrigin: "LIST" };
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
  /**
   * Null until a customer is chosen. There is no effective price without a
   * customer, so product selection stays disabled until then — a prefilled
   * price that turns out to belong to nobody is worse than an empty field.
   */
  customerId: string | null;
}

/**
 * Product select, quantity and unit price per line, plus the live total.
 * Fetches the (unpaginated) product catalog itself — the only consumer —
 * mirroring how CustomerSelect owns its own customer search. Also fetches
 * the chosen customer's effective prices, to prefill each line with the
 * price actually agreed for that customer rather than the catalog's.
 */
export function OrderItemsForm({
  items,
  errors,
  disabled,
  onChange,
  customerId,
}: OrderItemsFormProps) {
  const { apiClient } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const nextKeyRef = useRef(items.length);

  const [effectivePrices, setEffectivePrices] = useState<EffectivePrice[]>([]);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [pricesLoadError, setPricesLoadError] = useState<string | null>(null);
  const isSlowPrices = useSlowRequest(isLoadingPrices);
  const pricesAvailable = customerId !== null && pricesLoadError === null;

  // Latest items, read from the effective-prices effect below without
  // making it re-run (and re-fetch) on every keystroke — only a customer
  // change should trigger a new fetch, but the reprice that follows must
  // still act on whatever the seller has typed since.
  const itemsRef = useRef(items);
  itemsRef.current = items;

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

  useEffect(() => {
    if (!customerId) {
      setEffectivePrices([]);
      setPricesLoadError(null);
      setIsLoadingPrices(false);
      return;
    }

    let cancelled = false;
    setIsLoadingPrices(true);
    setPricesLoadError(null);

    function reprice(nextPrices: EffectivePrice[], nextPricesAvailable: boolean) {
      const repriced = itemsRef.current.map((item) => {
        // A blank line has nothing to reprice; a hand-typed price is the
        // seller's own decision and is never overwritten in silence.
        if (!item.productId || item.priceOrigin === null) return item;
        return {
          ...item,
          ...resolvePriceForProduct(item.productId, products, nextPrices, nextPricesAvailable),
        };
      });
      onChange(repriced);
    }

    listEffectivePrices(apiClient, customerId)
      .then((data) => {
        if (cancelled) return;
        setEffectivePrices(data);
        reprice(data, true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEffectivePrices([]);
        setPricesLoadError(
          error instanceof Error ? error.message : "No se pudieron cargar los precios pactados.",
        );
        reprice([], false);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPrices(false);
      });

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the customer only: `reprice` reads `itemsRef`,
    // not `items`, so editing a line never re-triggers this fetch.
  }, [apiClient, customerId]);

  function updateItem(index: number, patch: Partial<OrderItemDraft>) {
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      index,
    );
  }

  function handleProductChange(index: number, productId: string) {
    updateItem(index, {
      productId,
      ...resolvePriceForProduct(productId, products, effectivePrices, pricesAvailable),
    });
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
  const noCustomer = customerId === null;

  return (
    <div className="order-items">
      {noCustomer && <p className="field__hint">Elige un cliente para ver sus precios.</p>}
      {pricesLoadError && (
        <p className="notice notice--info" role="status">
          No se pudieron cargar los precios pactados: se usa el precio de lista. {pricesLoadError}
        </p>
      )}
      <SlowRequestNotice show={isSlowPrices && isLoadingPrices} />

      <div className="table-scroll">
        <table className="table">
          <caption className="visually-hidden">Productos del pedido</caption>
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
                      aria-label={`Producto ${index + 1}`}
                      value={item.productId}
                      disabled={disabled || isLoading || noCustomer}
                      onChange={(event) => handleProductChange(index, event.target.value)}
                    >
                      <option value="">
                        {noCustomer
                          ? "Elige un cliente primero"
                          : isLoading
                            ? "Cargando…"
                            : "Selecciona un producto"}
                      </option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Cantidad del producto ${index + 1}`}
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
                      aria-label={`Precio unitario del producto ${index + 1}`}
                      type="text"
                      inputMode="decimal"
                      placeholder="12.50"
                      value={item.unitPrice}
                      disabled={disabled}
                      onChange={(event) =>
                        updateItem(index, { unitPrice: event.target.value, priceOrigin: null })
                      }
                    />
                    {item.priceOrigin && item.priceOrigin !== "LIST" && (
                      <span className="badge badge--info">Pactado</span>
                    )}
                  </td>
                  <td className="table__numeric">{subtotal ? formatMoney(subtotal) : "—"}</td>
                  <td className="table__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={disabled || items.length <= 1}
                      onClick={() => handleRemove(index)}
                      aria-label={`Quitar producto ${index + 1}`}
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
                  Producto {index + 1}: {errors[index]}
                </li>
              ),
          )}
        </ul>
      )}

      <div className="order-items__footer">
        <button
          type="button"
          className="button button--secondary"
          disabled={disabled || isLoading || noCustomer}
          onClick={handleAdd}
        >
          Agregar producto
        </button>
        <div className="order-items__total">
          <span>Total</span>
          <strong>{formatMoney(total)}</strong>
        </div>
      </div>
    </div>
  );
}
