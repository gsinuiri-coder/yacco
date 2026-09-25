/**
 * Contracts derived from apps/api/src/modules/orders. `unitPrice` and `total`
 * are 2-decimal strings; `deliveryDate` is a calendar day "AAAA-MM-DD" in
 * America/Lima, never a Date.
 */

/** Prisma enum OrderStatus. */
export type OrderStatus = "PENDING" | "ON_ROUTE" | "DELIVERED" | "FAILED" | "CANCELLED";

/** OrderItemResponseDto. */
export interface OrderItem {
  id: string;
  productId: string;
  product: { id: string; name: string };
  quantity: number;
  unitPrice: string;
}

/** OrderResponseDto. `createdAt` is an instant. */
export interface Order {
  id: string;
  customerId: string;
  customer: { id: string; name: string; phone: string };
  deliveryDate: string;
  status: OrderStatus;
  createdById: string;
  createdAt: string;
  items: OrderItem[];
  total: string;
}

/**
 * ListOrdersQueryDto. `hasRouteStop: false` means "not on any route yet";
 * together with `status: "PENDING"` it is exactly what POST /routes/:id/stops
 * accepts.
 */
export interface OrderListQuery {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  customerId?: string;
  /** Only orders of customers in this zone. */
  zoneId?: string;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  hasRouteStop?: boolean;
}

/** CreateOrderItemDto. */
export interface CreateOrderItemBody {
  productId: string;
  quantity: number;
  unitPrice: string;
}

/** CreateOrderDto. `status` and `createdById` are assigned by the API. */
export interface CreateOrderBody {
  customerId: string;
  deliveryDate: string;
  items: CreateOrderItemBody[];
}

/** MAX_LIMIT in list-orders-query.dto.ts. */
export const ORDERS_PAGE_SIZE = 20;

/** MAX_ITEM_QUANTITY in create-order.dto.ts. */
export const MAX_ITEM_QUANTITY = 100000;
