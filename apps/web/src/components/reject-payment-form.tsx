import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../api/errors";
import type { PaymentActionResult, PaymentRow } from "../api/payments";
import { rejectPayment } from "../api/payments";
import { useAuth } from "../auth/use-auth";
import { FormSubmitFooter } from "./form-submit-footer";

export interface RejectPaymentFormProps {
  payment: PaymentRow;
  onCancel: () => void;
  onRejected: (result: PaymentActionResult) => void;
  /** 409 (ya no está PENDING) o 404 (ya no existe): el caller avisa y recarga la lista. */
  onStale: (message: string) => void;
}

function describeSubmitError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "No tienes permiso de administrador para rechazar pagos.";
  }
  return error instanceof Error ? error.message : "No se pudo rechazar el pago.";
}

/**
 * RejectPaymentDto exige un motivo no vacío — se pide acá, antes de disparar
 * la llamada, en vez de dejar que el 400 del backend sea la primera noticia.
 * Mismo patrón de fila expandida que ContainerCountForm.
 */
export function RejectPaymentForm({
  payment,
  onCancel,
  onRejected,
  onStale,
}: RejectPaymentFormProps) {
  const { apiClient } = useAuth();
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedReason = reason.trim();
    if (trimmedReason === "") {
      setValidationError("Escribe el motivo del rechazo");
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);
    setSubmitError(null);
    rejectPayment(apiClient, payment.id, { reason: trimmedReason })
      .then((result) => onRejected(result))
      .catch((error: unknown) => {
        // Otro administrador ya lo resolvió entre que se abrió esta fila y
        // este envío: la lista entera se recarga, no solo este formulario.
        if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
          onStale(
            error.status === 409
              ? "Este pago ya no está pendiente: alguien más lo confirmó o rechazó primero."
              : "Este pago ya no existe.",
          );
          return;
        }
        setSubmitError(describeSubmitError(error));
        setIsSubmitting(false);
      });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={`Rechazar pago de ${payment.customer.name}`}
    >
      <div className="field">
        <label className="field__label" htmlFor={`rejectReason-${payment.id}`}>
          Motivo del rechazo
        </label>
        <textarea
          id={`rejectReason-${payment.id}`}
          value={reason}
          disabled={isSubmitting}
          onChange={(event) => {
            setReason(event.target.value);
            setValidationError(null);
          }}
        />
      </div>
      <FormSubmitFooter
        validationError={validationError}
        submitError={submitError}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel="Confirmar rechazo"
        submittingLabel="Rechazando…"
      />
    </form>
  );
}
