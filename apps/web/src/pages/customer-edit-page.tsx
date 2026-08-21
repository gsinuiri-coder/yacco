import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { getCustomer, updateCustomer } from "../api/customers";
import type { Customer, UpdateCustomerBody } from "../api/customers";
import { SLOW_REQUEST_MESSAGE } from "../api/timing";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { CustomerForm, customerToForm } from "../components/customer-form";
import type { CustomerFormValues } from "../components/customer-form";
import { useSlowRequest } from "../hooks/use-slow-request";
import { formatMoney, formatOptionalMoney } from "../lib/money";

/**
 * `debtBalance` is absent by construction: it is a ledger balance the API
 * refuses in a write body, so it is displayed and never edited. A blank
 * optional field is sent as "" only where the API accepts clearing it — for
 * creditLimit and zoneId the API has no null-clearing contract, so a blank
 * field is simply omitted and the stored value is left as it is.
 */
export function toUpdateBody(values: CustomerFormValues): UpdateCustomerBody {
  const zoneId = values.zoneId.trim();
  const creditLimit = values.creditLimit.trim();

  return {
    name: values.name.trim(),
    phone: values.phone.trim(),
    address: values.address.trim(),
    addressReference: values.addressReference.trim(),
    active: values.active,
    ...(zoneId ? { zoneId } : {}),
    ...(creditLimit ? { creditLimit } : {}),
  };
}

export function CustomerEditPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { apiClient } = useAuth();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isSlow = useSlowRequest(isLoading);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    getCustomer(apiClient, customerId)
      .then((response) => {
        if (!cancelled) setCustomer(response);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "No se pudo cargar el cliente.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, customerId]);

  async function handleSubmit(values: CustomerFormValues) {
    if (!customerId) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await updateCustomer(apiClient, customerId, toUpdateBody(values));
      void navigate("/customers");
    } catch (error: unknown) {
      setSubmitError(
        error instanceof Error ? error.message : "No se pudieron guardar los cambios.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>{customer ? customer.name : "Editar cliente"}</h1>
          <p className="page-header__subtitle">
            Para dar de baja a un cliente, desmarca «Cliente activo». No se elimina.
          </p>
        </div>
      </div>

      {isSlow && isLoading && (
        <p className="notice notice--info" role="status">
          {SLOW_REQUEST_MESSAGE}
        </p>
      )}

      {isLoading ? (
        <p className="state card" role="status">
          Cargando cliente…
        </p>
      ) : loadError ? (
        <div className="state card">
          <p className="state__title">No se pudo cargar el cliente</p>
          <p role="alert">{loadError}</p>
          <div className="state__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void navigate("/customers")}
            >
              Volver a clientes
            </button>
          </div>
        </div>
      ) : customer ? (
        <CustomerForm
          initialValues={customerToForm(customer)}
          submitLabel="Guardar cambios"
          isSubmitting={isSubmitting}
          submitError={submitError}
          onSubmit={handleSubmit}
          onCancel={() => void navigate("/customers")}
          showActiveToggle
          readOnlySummary={<DebtSummary customer={customer} />}
        />
      ) : null}
    </AppShell>
  );
}

function DebtSummary({ customer }: { customer: Customer }) {
  return (
    <div className="stat">
      <span className="stat__label">Deuda actual</span>
      <span className="stat__value">{formatMoney(customer.debtBalance)}</span>
      <span className="stat__note">
        Solo lectura: se mueve con las ventas y los pagos, no desde esta pantalla. Límite de crédito
        vigente: {formatOptionalMoney(customer.creditLimit)}.
      </span>
    </div>
  );
}
