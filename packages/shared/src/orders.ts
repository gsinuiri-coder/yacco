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

export interface OrderLocation {
  id: string;
  name: string;
}

export interface OrderSibling {
  id: string;
  locationId: string;
  locationName: string;
}

export interface RescheduledOrderLink {
  id: string;
  deliveryDate: string;
}

/** OrderResponseDto. `createdAt` is an instant. */
export interface Order {
  id: string;
  locationId: string;
  location?: OrderLocation;
  orderGroupId: string | null;
  rescheduledFromOrderId?: string | null;
  rescheduledFrom?: RescheduledOrderLink | null;
  rescheduledTo?: RescheduledOrderLink | null;
  failureReason?: string | null;
  customerId: string;
  customer: { id: string; name: string; phone: string };
  deliveryDate: string;
  status: OrderStatus;
  createdById: string;
  createdAt: string;
  items: OrderItem[];
  total: string;
  siblingOrders?: OrderSibling[];
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
  /** true: every status except CANCELLED; ignored when status is present. */
  excludeCancelled?: boolean;
  customerId?: string;
  /** Only orders of customers in this zone. */
  zoneId?: string;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  hasRouteStop?: boolean;
  isRescheduled?: boolean;
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

export interface CreateLocationOrderBody {
  locationId: string;
  items: CreateOrderItemBody[];
}

export interface CreateOrdersBatchBody {
  customerId: string;
  deliveryDate: string;
  idempotencyKey?: string;
  locations: CreateLocationOrderBody[];
}

export interface RescheduleOrderBody {
  deliveryDate?: string;
}

export interface RescheduleOrdersByDateBody {
  deliveryDate: string;
  newDeliveryDate?: string;
}

/** MAX_LIMIT in list-orders-query.dto.ts. */
export const ORDERS_PAGE_SIZE = 20;

/** MAX_ITEM_QUANTITY in create-order.dto.ts. */
export const MAX_ITEM_QUANTITY = 100000;
