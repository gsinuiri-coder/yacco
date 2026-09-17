import type { OrderStatus } from "@yacco/shared";

type BadgeColor = "warning" | "info" | "success" | "error" | "neutral";

/** Cómo se nombra y se colorea cada estado de pedido, en la lista y en el detalle. */
export const ORDER_STATUS: Record<OrderStatus, { label: string; color: BadgeColor }> = {
  PENDING: { label: "Pendiente", color: "warning" },
  ON_ROUTE: { label: "En ruta", color: "info" },
  DELIVERED: { label: "Entregado", color: "success" },
  FAILED: { label: "No entregado", color: "error" },
  CANCELLED: { label: "Cancelado", color: "neutral" },
};
