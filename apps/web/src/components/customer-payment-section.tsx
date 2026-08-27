import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createOfficePayment } from "../api/payments";
import { ApiError } from "../api/errors";
import { listPaymentMethods } from "../api/payment-methods";
import type { PaymentMethod } from "../api/payment-methods";
import { useAuth } from "../auth/use-auth";
import { formatMoney, isPositiveMoney, isValidMoney } from "../lib/money";
import { ErrorState } from "./error-state";

export interface CustomerPaymentSectionProps {
  customerId: string;
  /** La ficha ya muestra "Deuda actual"; esto la actualiza tras un cobro. */
  onPaymentRegistered: (debtBalance: string) => void;
}

interface LastResult {
  debtBalance: string;
  exceedsDebt: boolean;
}

function describeSubmitError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return (
      "Este cobro no se pudo registrar porque ya se había intentado antes con otro cliente " +
      "o otro monto. Revisá el historial de pagos antes de volver a intentarlo."
    );
  }
  return error instanceof Error ? error.message : "No se pudo registrar el cobro.";
}

/**
 * Cobranza de oficina (HU-18): registra un pago fuera de ruta contra
 * POST /payments. Compuesta en la ficha del cliente, mismo patrón que
 * CustomerPricesSection — sección propia, con su propio módulo de API.
 *
 * No lee `requiresConfirmation` del método elegido — ver la nota en
 * api/payments.ts sobre por qué no aplica en esta pantalla.
 */
export function CustomerPaymentSection({
  customerId,
  onPaymentRegistered,
}: CustomerPaymentSectionProps) {
  const { apiClient } = useAuth();

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoadingMethods, setIsLoadingMethods] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);

  // Un UUID v4 por intento: un reintento tras un error de red reusa el
  // mismo (ver los onChange de abajo), así que el segundo POST nunca
  // duplica el cobro si el primero sí llegó a escribir.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let ignore = false;
    setIsLoadingMethods(true);
    setLoadError(null);

    listPaymentMethods(apiClient)
      .then((methods) => {
        if (!ignore) setPaymentMethods(methods);
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setLoadError(
            error instanceof Error ? error.message : "No se pudieron cargar los métodos de pago.",
          );
        }
      })
      .finally(() => {
        if (!ignore) setIsLoadingMethods(false);
      });

    return () => {
      ignore = true;
    };
  }, [apiClient, reloadToken]);

  // Cambiar método o monto DESPUÉS de un fallo es, para la API, un cobro
  // distinto — reusar la clave ahí respondería 409 (otro monto/cliente no
  // aplica aquí, pero el principio es el mismo: la clave solo protege un
  // reintento IDÉNTICO). Antes de cualquier fallo, la clave sigue sin
  // usarse, así que no hace falta tocarla.
  function handlePaymentMethodChange(value: string) {
    setPaymentMethodId(value);
    if (submitError !== null) {
      setSubmitError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  }

  function handleAmountChange(value: string) {
    setAmount(value);
    if (submitError !== null) {
      setSubmitError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (paymentMethodId === "") {
      setSubmitError("Elige un método de pago");
      return;
    }
    const trimmedAmount = amount.trim();
    if (!isValidMoney(trimmedAmount) || !isPositiveMoney(trimmedAmount)) {
      setSubmitError('El monto debe ser un valor válido y mayor que 0, como "12.50"');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    createOfficePayment(apiClient, {
      customerId,
      paymentMethodId,
      amount: trimmedAmount,
      idempotencyKey,
    })
      .then((result) => {
        setLastResult({ debtBalance: result.debtBalance, exceedsDebt: result.exceedsDebt });
        onPaymentRegistered(result.debtBalance);
        setAmount("");
        setIdempotencyKey(crypto.randomUUID());
      })
      .catch((error: unknown) => {
        setSubmitError(describeSubmitError(error));
      })
      .finally(() => setIsSubmitting(false));
  }

  return (
    <section className="card">
      <div className="card__body">
        <div className="page-header">
          <h2>Registrar cobro</h2>
        </div>

        {loadError ? (
          <ErrorState message={loadError} onRetry={() => setReloadToken((token) => token + 1)} />
        ) : isLoadingMethods ? (
          <p className="state" role="status">
            Cargando métodos de pago…
          </p>
        ) : paymentMethods.length === 0 ? (
          <p className="state">
            No hay métodos de pago activos configurados. Pedile a un administrador que revise el
            catálogo antes de registrar un cobro.
          </p>
        ) : (
          <>
            {submitError && (
              <div className="notice notice--error" role="alert">
                {submitError}
              </div>
            )}

            {lastResult && (
              <div className="notice notice--info" role="status">
                {lastResult.exceedsDebt ? (
                  <p>
                    Cobro registrado. El cliente queda con saldo a favor de{" "}
                    {formatMoney(lastResult.debtBalance.replace(/^-/, ""))}.
                  </p>
                ) : (
                  <p>Cobro registrado. Deuda actual: {formatMoney(lastResult.debtBalance)}.</p>
                )}
              </div>
            )}

            <form className="form-grid" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label className="field__label" htmlFor="paymentMethod">
                  Método de pago
                </label>
                <select
                  id="paymentMethod"
                  value={paymentMethodId}
                  disabled={isSubmitting}
                  onChange={(event) => handlePaymentMethodChange(event.target.value)}
                >
                  <option value="">Selecciona un método</option>
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="paymentAmount">
                  Monto
                </label>
                <input
                  id="paymentAmount"
                  type="text"
                  inputMode="decimal"
                  placeholder="12.50"
                  value={amount}
                  disabled={isSubmitting}
                  onChange={(event) => handleAmountChange(event.target.value)}
                />
              </div>

              <div className="form-actions form-grid__full">
                <button type="submit" className="button button--primary" disabled={isSubmitting}>
                  {isSubmitting ? "Registrando…" : "Registrar cobro"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
