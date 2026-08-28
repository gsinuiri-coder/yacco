import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { listContainerTypes } from "../api/container-types";
import type { ContainerType } from "../api/container-types";
import { listEffectivePrices } from "../api/customer-prices";
import type { EffectivePrice } from "../api/customer-prices";
import { getOrder } from "../api/orders";
import { listPaymentMethods } from "../api/payment-methods";
import type { PaymentMethod } from "../api/payment-methods";
import { listProducts } from "../api/products";
import type { Product } from "../api/products";
import { markRouteStop } from "../api/routes";
import type { MarkRouteStopBody, RouteStop } from "../api/routes";
import { listUsers } from "../api/users";
import type { User } from "../api/users";
import { useAuth } from "../auth/use-auth";
import { formatMoney, isValidMoney, multiplyMoney, sumMoney } from "../lib/money";
import { FormSubmitFooter } from "./form-submit-footer";

/** Lo que pasó en la parada, en el vocabulario de la planta. */
type Outcome = "DELIVERED" | "FAILED";

interface ItemDraft {
  key: number;
  productId: string;
  quantity: string;
  /** Vacío = se cobra el precio pactado; la API lo resuelve sola. */
  unitPrice: string;
}

interface ReturnDraft {
  key: number;
  containerTypeId: string;
  quantity: string;
}

function emptyItem(key: number): ItemDraft {
  return { key, productId: "", quantity: "1", unitPrice: "" };
}

function emptyReturn(key: number): ReturnDraft {
  return { key, containerTypeId: "", quantity: "1" };
}

function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value.trim());
  return quantity > 0 ? quantity : null;
}

export interface RouteStopMarkFormProps {
  routeId: string;
  stop: RouteStop;
  onCancel: () => void;
  /** La parada quedó marcada; la respuesta trae venta, cobro y saldos. */
  onMarked: (result: RouteStop) => void;
}

/**
 * Registrar lo que pasó en una parada. Cubre los tres escenarios de HU-12
 * sin ninguna rama especial, porque el dominio ya los distingue por el TIPO
 * de producto:
 *
 * - Canje 1:1 — 3 recargas entregadas y 3 vacíos devueltos: el saldo de
 *   envases del cliente no se mueve.
 * - Deuda de envases — 3 recargas y 1 vacío: el saldo sube en 2, y la
 *   respuesta lo muestra.
 * - Venta completa — 1 recarga más 2 bidones vendidos (producto
 *   CONTAINER_SALE) y 1 vacío: esos 2 envases salen del parque y el saldo no
 *   se mueve.
 *
 * El precio unitario se deja vacío en el camino normal: la API resuelve el
 * precio pactado del cliente. Solo se escribe cuando se cobró algo distinto,
 * y entonces el formulario pide quién lo autorizó — la misma regla que
 * `SalesService` aplica del otro lado.
 */
export function RouteStopMarkForm({ routeId, stop, onCancel, onMarked }: RouteStopMarkFormProps) {
  const { apiClient } = useAuth();
  const customerId = stop.location.customer.id;

  const [outcome, setOutcome] = useState<Outcome>("DELIVERED");
  const [failureReason, setFailureReason] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem(0)]);
  const [returns, setReturns] = useState<ReturnDraft[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [authorizerId, setAuthorizerId] = useState("");

  const [products, setProducts] = useState<Product[]>([]);
  const [containerTypes, setContainerTypes] = useState<ContainerType[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [authorizers, setAuthorizers] = useState<User[]>([]);
  const [effectivePrices, setEffectivePrices] = useState<EffectivePrice[]>([]);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const nextKeyRef = useRef(1);

  useEffect(() => {
    let cancelled = false;
    listProducts(apiClient)
      .then((response) => {
        if (!cancelled) setProducts(response);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    listContainerTypes(apiClient)
      .then((response) => {
        if (!cancelled) setContainerTypes(response);
      })
      .catch(() => {
        if (!cancelled) setContainerTypes([]);
      });
    listPaymentMethods(apiClient)
      .then((response) => {
        if (!cancelled) setPaymentMethods(response);
      })
      .catch(() => {
        if (!cancelled) setPaymentMethods([]);
      });
    // Cualquier usuario activo puede haber autorizado un precio distinto;
    // el catálogo sale de su propio endpoint, nunca de una lista a mano.
    listUsers(apiClient)
      .then((response) => {
        if (!cancelled) setAuthorizers(response);
      })
      .catch(() => {
        if (!cancelled) setAuthorizers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  // Los precios pactados del cliente, con la misma precedencia que usa la
  // API al registrar la venta: sirven para mostrar qué se va a cobrar y para
  // saber cuándo un precio escrito a mano es realmente distinto.
  useEffect(() => {
    let cancelled = false;
    listEffectivePrices(apiClient, customerId)
      .then((response) => {
        if (!cancelled) setEffectivePrices(response);
      })
      .catch(() => {
        if (!cancelled) setEffectivePrices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, customerId]);

  // Una parada que salió de un pedido ya dice qué se pidió: se precarga para
  // que la oficina confirme en vez de volver a tipearlo. Las cantidades se
  // pueden corregir — lo que se entregó no siempre es lo que se pidió.
  useEffect(() => {
    if (stop.orderId === null) return;
    let cancelled = false;
    getOrder(apiClient, stop.orderId)
      .then((order) => {
        if (cancelled || order.items.length === 0) return;
        setItems(
          order.items.map((item, index) => ({
            key: index,
            productId: item.productId,
            quantity: String(item.quantity),
            unitPrice: "",
          })),
        );
        nextKeyRef.current = order.items.length;
      })
      .catch(() => {
        // El pedido no pudo leerse: se registra a mano, como una autoventa.
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, stop.orderId]);

  function agreedPriceOf(productId: string): string | null {
    return effectivePrices.find((price) => price.product.id === productId)?.price ?? null;
  }

  /** Un precio escrito que difiere del pactado; null si no se puede comparar. */
  function isOverride(item: ItemDraft): boolean {
    const typed = item.unitPrice.trim();
    if (typed === "" || !isValidMoney(typed)) return false;
    const agreed = agreedPriceOf(item.productId);
    return agreed !== null && !sameMoney(typed, agreed);
  }

  const hasOverride = items.some(isOverride);

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setValidationError(null);
  }

  function updateReturn(index: number, patch: Partial<ReturnDraft>) {
    setReturns((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setValidationError(null);
  }

  function buildBody(): MarkRouteStopBody | string {
    if (outcome === "FAILED") {
      if (failureReason.trim() === "") {
        return "Escribe por qué no se pudo entregar";
      }
      return { status: "FAILED", failureReason: failureReason.trim() };
    }

    const saleItems = [];
    for (const [index, item] of items.entries()) {
      if (item.productId === "") {
        return `Elige el producto de la línea ${index + 1}`;
      }
      const quantity = parseQuantity(item.quantity);
      if (quantity === null) {
        return `La cantidad de la línea ${index + 1} debe ser un número entero mayor que 0`;
      }
      const typed = item.unitPrice.trim();
      if (typed !== "" && !isValidMoney(typed)) {
        return `El precio de la línea ${index + 1} debe ser un monto como "12.50"`;
      }
      saleItems.push({
        productId: item.productId,
        quantity,
        ...(typed === "" ? {} : { unitPrice: typed }),
      });
    }
    if (saleItems.length === 0) {
      return "Una entrega tiene que decir qué se entregó";
    }

    const containersReturned = [];
    for (const [index, row] of returns.entries()) {
      if (row.containerTypeId === "") {
        return `Elige el tipo de envase devuelto de la línea ${index + 1}`;
      }
      const quantity = parseQuantity(row.quantity);
      if (quantity === null) {
        return `Los envases devueltos de la línea ${index + 1} deben ser un número entero mayor que 0`;
      }
      containersReturned.push({ containerTypeId: row.containerTypeId, quantity });
    }

    const trimmedAmount = amount.trim();
    if (paymentMethodId !== "" && trimmedAmount === "") {
      return "Escribe cuánto se cobró, o quita el método de pago para dejarlo al fiado";
    }
    if (trimmedAmount !== "" && paymentMethodId === "") {
      return "Elige con qué método se cobró";
    }
    if (trimmedAmount !== "" && !isValidMoney(trimmedAmount)) {
      return 'El monto cobrado debe ser un monto como "25.00"';
    }

    if (hasOverride && authorizerId === "") {
      return "Un precio distinto del pactado necesita quién lo autorizó";
    }

    return {
      status: "DELIVERED",
      items: saleItems,
      ...(containersReturned.length > 0 ? { containersReturned } : {}),
      ...(trimmedAmount === "" ? {} : { payment: { paymentMethodId, amount: trimmedAmount } }),
      ...(authorizerId === "" ? {} : { priceOverrideAuthorizedById: authorizerId }),
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const body = buildBody();
    if (typeof body === "string") {
      setValidationError(body);
      return;
    }

    setValidationError(null);
    setIsSubmitting(true);
    setSubmitError(null);
    markRouteStop(apiClient, routeId, stop.id, body)
      .then((result) => onMarked(result))
      .catch((error: unknown) => {
        // El 400/409 de la API nombra el problema concreto (stock
        // insuficiente en el camión, parada ya resuelta); se muestra tal cual.
        setSubmitError(error instanceof Error ? error.message : "No se pudo registrar la parada.");
        setIsSubmitting(false);
      });
  }

  const total = sumMoney(
    items
      .map((item) => lineSubtotal(item, agreedPriceOf(item.productId)))
      .filter((subtotal): subtotal is string => subtotal !== null),
  );

  return (
    <form
      className="card__body"
      onSubmit={handleSubmit}
      noValidate
      aria-label={`Registrar la parada de ${stop.location.customer.name}`}
    >
      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="stopOutcome">
            ¿Qué pasó en esta parada?
          </label>
          <select
            id="stopOutcome"
            value={outcome}
            disabled={isSubmitting}
            onChange={(event) => {
              setOutcome(event.target.value as Outcome);
              setValidationError(null);
            }}
          >
            <option value="DELIVERED">Se entregó</option>
            <option value="FAILED">No se pudo entregar</option>
          </select>
        </div>
      </div>

      {outcome === "FAILED" ? (
        <div className="field">
          <label className="field__label" htmlFor="failureReason">
            ¿Por qué no se pudo entregar?
          </label>
          <input
            id="failureReason"
            type="text"
            value={failureReason}
            disabled={isSubmitting}
            placeholder="El local estaba cerrado"
            onChange={(event) => {
              setFailureReason(event.target.value);
              setValidationError(null);
            }}
          />
          <span className="field__hint">
            Queda escrito en la parada; es lo que se revisa al liquidar la ruta.
          </span>
        </div>
      ) : (
        <>
          <h3>Lo que se entregó</h3>
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">
                Productos entregados en la parada, con su cantidad y su precio
              </caption>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Cantidad</th>
                  <th scope="col">Precio cobrado</th>
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
                  const agreed = agreedPriceOf(item.productId);
                  const subtotal = lineSubtotal(item, agreed);
                  return (
                    <tr key={item.key}>
                      <td>
                        <select
                          aria-label={`Producto ${index + 1}`}
                          value={item.productId}
                          disabled={isSubmitting}
                          onChange={(event) => updateItem(index, { productId: event.target.value })}
                        >
                          <option value="">Elige un producto</option>
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
                          step={1}
                          value={item.quantity}
                          disabled={isSubmitting}
                          onChange={(event) => updateItem(index, { quantity: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Precio cobrado del producto ${index + 1}`}
                          type="text"
                          inputMode="decimal"
                          placeholder={agreed === null ? "Precio pactado" : agreed}
                          value={item.unitPrice}
                          disabled={isSubmitting}
                          onChange={(event) => updateItem(index, { unitPrice: event.target.value })}
                        />
                        {agreed !== null && (
                          <span className="field__hint">Pactado: {formatMoney(agreed)}</span>
                        )}
                        {isOverride(item) && (
                          <span className="badge badge--warning">Distinto del pactado</span>
                        )}
                      </td>
                      <td className="table__numeric">{subtotal ? formatMoney(subtotal) : "—"}</td>
                      <td className="table__actions">
                        <button
                          type="button"
                          className="button button--ghost"
                          aria-label={`Quitar el producto ${index + 1}`}
                          disabled={isSubmitting || items.length <= 1}
                          onClick={() =>
                            setItems((current) => current.filter((_, i) => i !== index))
                          }
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
          <div className="order-items__footer">
            <button
              type="button"
              className="button button--secondary"
              disabled={isSubmitting}
              onClick={() => setItems((current) => [...current, emptyItem(nextKeyRef.current++)])}
            >
              Agregar producto
            </button>
            <div className="order-items__total">
              <span>Total de la venta</span>
              <strong>{formatMoney(total)}</strong>
            </div>
          </div>

          <h3>Envases vacíos que devolvió</h3>
          <p className="field__hint">
            Si devuelve tantos vacíos como llenos recibe, su saldo de envases no se mueve. Si
            devuelve menos, la diferencia le queda debida — salvo que se le venda el envase.
          </p>
          {returns.length > 0 && (
            <div className="form-grid">
              {returns.map((row, index) => (
                <div className="field" key={row.key}>
                  <label className="field__label" htmlFor={`returnType-${String(row.key)}`}>
                    Tipo de envase {index + 1}
                  </label>
                  <select
                    id={`returnType-${String(row.key)}`}
                    value={row.containerTypeId}
                    disabled={isSubmitting}
                    onChange={(event) =>
                      updateReturn(index, { containerTypeId: event.target.value })
                    }
                  >
                    <option value="">Elige un tipo de envase</option>
                    {containerTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Vacíos devueltos ${index + 1}`}
                    type="number"
                    min={1}
                    step={1}
                    value={row.quantity}
                    disabled={isSubmitting}
                    onChange={(event) => updateReturn(index, { quantity: event.target.value })}
                  />
                  <button
                    type="button"
                    className="button button--ghost"
                    aria-label={`Quitar los vacíos devueltos ${index + 1}`}
                    disabled={isSubmitting}
                    onClick={() => setReturns((current) => current.filter((_, i) => i !== index))}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={isSubmitting}
              onClick={() =>
                setReturns((current) => [...current, emptyReturn(nextKeyRef.current++)])
              }
            >
              Agregar envases devueltos
            </button>
          </div>

          <h3>Cobro</h3>
          <div className="form-grid">
            <div className="field">
              <label className="field__label" htmlFor="stopPaymentMethod">
                Método de pago
              </label>
              <select
                id="stopPaymentMethod"
                value={paymentMethodId}
                disabled={isSubmitting}
                onChange={(event) => {
                  setPaymentMethodId(event.target.value);
                  setValidationError(null);
                }}
              >
                <option value="">No cobró nada (queda al fiado)</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="stopPaymentAmount">
                Monto cobrado
              </label>
              <input
                id="stopPaymentAmount"
                type="text"
                inputMode="decimal"
                placeholder="25.00"
                value={amount}
                disabled={isSubmitting}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setValidationError(null);
                }}
              />
              <span className="field__hint">
                Puede ser menos que el total: la diferencia queda como deuda.
              </span>
            </div>
          </div>

          {hasOverride && (
            <div className="field">
              <label className="field__label" htmlFor="stopPriceAuthorizer">
                ¿Quién autorizó el precio distinto?
              </label>
              <select
                id="stopPriceAuthorizer"
                value={authorizerId}
                disabled={isSubmitting}
                onChange={(event) => {
                  setAuthorizerId(event.target.value);
                  setValidationError(null);
                }}
              >
                <option value="">Elige quién lo autorizó</option>
                {authorizers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <FormSubmitFooter
        validationError={validationError}
        submitError={submitError}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel="Registrar la parada"
        submittingLabel="Registrando…"
      />
    </form>
  );
}

/** Compara dos montos por texto, con la fracción normalizada a dos dígitos. */
function sameMoney(left: string, right: string): boolean {
  return normalizeMoney(left) === normalizeMoney(right);
}

function normalizeMoney(value: string): string {
  const [integerPart = "0", fractionPart = ""] = value.split(".");
  return `${integerPart === "" ? "0" : integerPart}.${fractionPart.padEnd(2, "0").slice(0, 2)}`;
}

/**
 * Subtotal de la línea con el precio que se va a cobrar: el escrito a mano
 * si lo hay, el pactado si no. Null cuando la línea todavía no alcanza para
 * calcular nada — nunca lanza.
 */
function lineSubtotal(item: ItemDraft, agreed: string | null): string | null {
  const quantity = parseQuantity(item.quantity);
  if (quantity === null) return null;
  const typed = item.unitPrice.trim();
  const price = typed === "" ? agreed : typed;
  if (price === null || !isValidMoney(price)) return null;
  return multiplyMoney(price, quantity);
}
