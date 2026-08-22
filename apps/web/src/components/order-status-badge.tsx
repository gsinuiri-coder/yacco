import type { OrderStatus } from "../api/orders";

/** Shared between the orders list (filter + row) and the order detail. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pendiente",
  ON_ROUTE: "En ruta",
  DELIVERED: "Entregado",
  FAILED: "No entregado",
  CANCELLED: "Cancelado",
};

const ORDER_STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  PENDING: "badge--warning",
  ON_ROUTE: "badge--info",
  DELIVERED: "badge--active",
  FAILED: "badge--danger",
  CANCELLED: "badge--inactive",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`badge ${ORDER_STATUS_BADGE_CLASS[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
