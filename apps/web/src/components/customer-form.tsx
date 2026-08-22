import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Customer } from "../api/customers";
import { isValidMoney } from "../lib/money";

export interface CustomerFormValues {
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  zoneId: string;
  creditLimit: string;
  active: boolean;
}

type FieldErrors = Partial<Record<keyof CustomerFormValues, string>>;

// Client-side rules mirror the API's CreateCustomerDto so the seller gets the
// same answer without a round trip. The API stays the authority: whatever it
// rejects is surfaced verbatim by the pages through `submitError`.
const MAX_LENGTHS = { name: 160, phone: 30, address: 255, addressReference: 255 } as const;

export function emptyCustomerForm(): CustomerFormValues {
  return {
    name: "",
    phone: "",
    address: "",
    addressReference: "",
    zoneId: "",
    creditLimit: "",
    active: true,
  };
}

export function customerToForm(customer: Customer): CustomerFormValues {
  return {
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    addressReference: customer.addressReference,
    zoneId: customer.zoneId ?? "",
    creditLimit: customer.creditLimit ?? "",
    active: customer.active,
  };
}

export function validateCustomerForm(values: CustomerFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.name.trim()) {
    errors.name = "El nombre es obligatorio";
  } else if (values.name.trim().length > MAX_LENGTHS.name) {
    errors.name = `El nombre no puede superar los ${MAX_LENGTHS.name} caracteres`;
  }

  if (!values.phone.trim()) {
    errors.phone = "El teléfono es obligatorio";
  } else if (values.phone.trim().length > MAX_LENGTHS.phone) {
    errors.phone = `El teléfono no puede superar los ${MAX_LENGTHS.phone} caracteres`;
  }

  if (!values.address.trim()) {
    errors.address = "La dirección es obligatoria";
  } else if (values.address.trim().length > MAX_LENGTHS.address) {
    errors.address = `La dirección no puede superar los ${MAX_LENGTHS.address} caracteres`;
  }

  if (!values.addressReference.trim()) {
    errors.addressReference = "La referencia de dirección es obligatoria";
  } else if (values.addressReference.trim().length > MAX_LENGTHS.addressReference) {
    errors.addressReference = `La referencia no puede superar los ${MAX_LENGTHS.addressReference} caracteres`;
  }

  if (values.creditLimit.trim() && !isValidMoney(values.creditLimit.trim())) {
    errors.creditLimit = 'El límite de crédito debe ser un monto como "150.00"';
  }

  return errors;
}

interface CustomerFormProps {
  initialValues: CustomerFormValues;
  submitLabel: string;
  isSubmitting: boolean;
  /** Message from the API (a 400 and its validation detail). Never swallowed. */
  submitError: string | null;
  onSubmit: (values: CustomerFormValues) => void;
  onCancel: () => void;
  /** Shown on edit only: the read-only ledger balance. */
  readOnlySummary?: ReactNode;
  /** Deactivation lives here on edit; a new customer is always created active. */
  showActiveToggle?: boolean;
}

export function CustomerForm({
  initialValues,
  submitLabel,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
  readOnlySummary,
  showActiveToggle = false,
}: CustomerFormProps) {
  const [values, setValues] = useState<CustomerFormValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});

  function setField<K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    // Clears only this field's error: a full re-validate on every keystroke
    // would flag fields the user hasn't finished typing into yet.
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateCustomerForm(values);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      onSubmit(values);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit} noValidate>
      <div className="card__body">
        {submitError && (
          <div className="notice notice--error" role="alert">
            {submitError}
          </div>
        )}

        <div className="form-grid">
          <TextField
            id="name"
            label="Nombre"
            value={values.name}
            error={errors.name}
            disabled={isSubmitting}
            onChange={(value) => setField("name", value)}
          />
          <TextField
            id="phone"
            label="Teléfono"
            value={values.phone}
            error={errors.phone}
            disabled={isSubmitting}
            onChange={(value) => setField("phone", value)}
          />
          <TextField
            id="address"
            label="Dirección"
            value={values.address}
            error={errors.address}
            disabled={isSubmitting}
            className="form-grid__full"
            onChange={(value) => setField("address", value)}
          />
          <TextField
            id="addressReference"
            label="Referencia"
            value={values.addressReference}
            error={errors.addressReference}
            disabled={isSubmitting}
            className="form-grid__full"
            hint="Cómo encontrar la puerta: un color, una esquina, un negocio al lado."
            onChange={(value) => setField("addressReference", value)}
          />
          <TextField
            id="creditLimit"
            label="Límite de crédito (opcional)"
            value={values.creditLimit}
            error={errors.creditLimit}
            disabled={isSubmitting}
            placeholder="150.00"
            hint="En soles, con dos decimales. Advierte al superarse; nunca bloquea la venta."
            onChange={(value) => setField("creditLimit", value)}
          />

          {readOnlySummary && <div className="form-grid__full">{readOnlySummary}</div>}

          {showActiveToggle && (
            <div className="form-grid__full checkbox-field">
              <input
                id="active"
                type="checkbox"
                checked={values.active}
                disabled={isSubmitting}
                onChange={(event) => setField("active", event.target.checked)}
              />
              <span className="field">
                <label htmlFor="active" className="field__label">
                  Cliente activo
                </label>
                <span className="field__hint">
                  Al desactivarlo deja de aparecer en el reparto. No se borra: su historial de
                  pedidos y deuda se conserva.
                </span>
              </span>
            </div>
          )}
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button type="submit" className="button button--primary" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  error?: string | undefined;
  hint?: string;
  placeholder?: string;
  disabled: boolean;
  className?: string;
  onChange: (value: string) => void;
}

function TextField({
  id,
  label,
  value,
  error,
  hint,
  placeholder,
  disabled,
  className,
  onChange,
}: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");

  return (
    <div className={`field ${className ?? ""}`.trim()}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...(placeholder === undefined ? {} : { placeholder })}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
