import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { createOrder } from "../api/orders";
import type { CreateOrderBody } from "../api/orders";
import type { Customer } from "../api/customers";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { CustomerSelect } from "../components/customer-select";
import { OrderItemsForm, emptyOrderItem, validateOrderItem } from "../components/order-items-form";
import type { OrderItemDraft } from "../components/order-items-form";
import { SlowRequestNotice } from "../components/slow-request-notice";
import { useSlowRequest } from "../hooks/use-slow-request";
import { todayInLima } from "../lib/business-date";

function toCreateBody(
  customer: Customer,
  deliveryDate: string,
  items: OrderItemDraft[],
): CreateOrderBody {
  return {
    customerId: customer.id,
    deliveryDate,
    items: items.map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity.trim()),
      unitPrice: item.unitPrice.trim(),
    })),
  };
}

export function OrderCreatePage() {
  const { apiClient } = useAuth();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(todayInLima());
  const [items, setItems] = useState<OrderItemDraft[]>([emptyOrderItem(0)]);

  const [customerError, setCustomerError] = useState<string | undefined>(undefined);
  const [itemErrors, setItemErrors] = useState<(string | undefined)[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isSlow = useSlowRequest(isSubmitting);

  function validate(): boolean {
    const nextCustomerError = customer === null ? "Elige un cliente" : undefined;
    const nextItemErrors = items.map(validateOrderItem);
    setCustomerError(nextCustomerError);
    setItemErrors(nextItemErrors);
    return nextCustomerError === undefined && nextItemErrors.every((error) => error === undefined);
  }

  function handleCustomerChange(next: Customer | null) {
    setCustomer(next);
    // Clears only this field's error: a full re-validate on every change
    // would flag the item lines before the seller has finished them.
    setCustomerError(undefined);
  }

  function handleItemsChange(nextItems: OrderItemDraft[], changedIndex?: number) {
    setItems(nextItems);
    if (changedIndex !== undefined) {
      setItemErrors((current) =>
        current.map((error, index) => (index === changedIndex ? undefined : error)),
      );
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guards a stray second submit event arriving before the disabled button
    // re-renders — the click itself is also blocked by `disabled`.
    if (isSubmitting) return;
    if (!validate() || customer === null) return;

    setIsSubmitting(true);
    setSubmitError(null);
    createOrder(apiClient, toCreateBody(customer, deliveryDate, items))
      .then(() => void navigate("/orders"))
      .catch((error: unknown) => {
        // The API's 400 names the concrete customer/products; shown verbatim
        // so this message never drifts from the one the backend maintains.
        setSubmitError(error instanceof Error ? error.message : "No se pudo registrar el pedido.");
        setIsSubmitting(false);
      });
  }

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Nuevo pedido</h1>
          <p className="page-header__subtitle">Se registra como pendiente.</p>
        </div>
      </div>

      <form className="card" onSubmit={handleSubmit} noValidate>
        <div className="card__body">
          {submitError && (
            <div className="notice notice--error" role="alert">
              {submitError}
            </div>
          )}

          <div className="form-grid">
            <div className="form-grid__full">
              <CustomerSelect
                id="customerId"
                label="Cliente"
                value={customer}
                onChange={handleCustomerChange}
              />
              {customerError && <span className="field__error">{customerError}</span>}
            </div>
            <div className="field">
              <label className="field__label" htmlFor="deliveryDate">
                Fecha de entrega
              </label>
              <input
                id="deliveryDate"
                type="date"
                value={deliveryDate}
                disabled={isSubmitting}
                onChange={(event) => setDeliveryDate(event.target.value)}
              />
            </div>
          </div>

          <OrderItemsForm
            items={items}
            errors={itemErrors}
            disabled={isSubmitting}
            onChange={handleItemsChange}
            customerId={customer?.id ?? null}
          />

          <SlowRequestNotice show={isSlow && isSubmitting} />

          <div className="form-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={isSubmitting}
              onClick={() => void navigate("/orders")}
            >
              Cancelar
            </button>
            <button type="submit" className="button button--primary" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Registrar pedido"}
            </button>
          </div>
        </div>
      </form>
    </AppShell>
  );
}
