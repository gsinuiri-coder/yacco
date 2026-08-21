import { useState } from "react";
import { useNavigate } from "react-router";
import { createCustomer } from "../api/customers";
import type { CreateCustomerBody } from "../api/customers";
import { useAuth } from "../auth/use-auth";
import { AppShell } from "../components/app-shell";
import { CustomerForm, emptyCustomerForm } from "../components/customer-form";
import type { CustomerFormValues } from "../components/customer-form";

/** Optional fields are omitted when blank, never sent as "". */
export function toCreateBody(values: CustomerFormValues): CreateCustomerBody {
  const zoneId = values.zoneId.trim();
  const creditLimit = values.creditLimit.trim();

  return {
    name: values.name.trim(),
    phone: values.phone.trim(),
    address: values.address.trim(),
    addressReference: values.addressReference.trim(),
    ...(zoneId ? { zoneId } : {}),
    ...(creditLimit ? { creditLimit } : {}),
  };
}

export function CustomerCreatePage() {
  const { apiClient } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(values: CustomerFormValues) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await createCustomer(apiClient, toCreateBody(values));
      void navigate("/customers");
    } catch (error: unknown) {
      // The API's 400 carries the reason (its validation messages are already
      // in Spanish); showing it verbatim beats a generic failure line.
      setSubmitError(error instanceof Error ? error.message : "No se pudo registrar el cliente.");
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Nuevo cliente</h1>
          <p className="page-header__subtitle">
            Se registra con deuda S/ 0.00 y sin envases prestados.
          </p>
        </div>
      </div>

      <CustomerForm
        initialValues={emptyCustomerForm()}
        submitLabel="Registrar cliente"
        isSubmitting={isSubmitting}
        submitError={submitError}
        onSubmit={handleSubmit}
        onCancel={() => void navigate("/customers")}
      />
    </AppShell>
  );
}
