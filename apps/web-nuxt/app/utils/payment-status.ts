import type { PaymentStatus } from "@yacco/shared";

export const PAYMENT_STATUS: Record<
  PaymentStatus,
  { label: string; color: "warning" | "success" | "error" }
> = {
  PENDING: { label: "Pendiente", color: "warning" },
  CONFIRMED: { label: "Confirmado", color: "success" },
  REJECTED: { label: "Rechazado", color: "error" },
};

/**
 * 409 u 404 al confirmar o rechazar: otro administrador lo resolvió (o dejó de
 * existir) entre que se cargó la bandeja y el clic. No es un error de quien
 * mira: la bandeja entera se recarga. `null` para cualquier otro error.
 */
export function paymentStaleMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409) {
    return "Este pago ya no está pendiente: alguien más lo confirmó o rechazó primero.";
  }
  return error.status === 404 ? "Este pago ya no existe." : null;
}

/** El 403 de Nest es genérico: se dice en el vocabulario de la planta. */
export function paymentActionFailure(error: unknown, action: "confirmar" | "rechazar"): string {
  if (error instanceof ApiError && error.status === 403) {
    return `No tienes permiso de administrador para ${action} pagos.`;
  }
  return describeApiFailure(error);
}
