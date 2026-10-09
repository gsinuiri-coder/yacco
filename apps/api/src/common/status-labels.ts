import type { OrderStatus, PaymentStatus, RouteStatus, StopStatus } from "@prisma/client";

/*
 * Los estados como los dice la planta, para los mensajes de error que llegan a
 * pantalla: la web los muestra tal cual, y el enum crudo (`IN_PROGRESS`) no le
 * dice nada a quien lo lee. Son las mismas palabras que los badges de la web
 * (`route-status.ts`, `order-status.ts` y `payment-status.ts` en
 * `apps/web-nuxt/app/utils/`): si el mensaje y el badge llaman distinto al
 * mismo estado, el usuario cree que son dos cosas distintas. Van en
 * minúscula y conjugadas para caer después de «está»: «esta está en curso»,
 * «ya está entregada».
 */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "pendiente",
  ON_ROUTE: "en ruta",
  DELIVERED: "entregado",
  FAILED: "no entregado",
  CANCELLED: "cancelado",
};

export const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  PLANNED: "planificada",
  IN_PROGRESS: "en curso",
  FINISHED: "terminada",
  SETTLED: "liquidada",
};

export const STOP_STATUS_LABELS: Record<StopStatus, string> = {
  PENDING: "pendiente",
  DELIVERED: "entregada",
  FAILED: "no entregada",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "pendiente",
  CONFIRMED: "confirmado",
  REJECTED: "rechazado",
};
