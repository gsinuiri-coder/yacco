/**
 * Contracts derived from apps/api/src/modules/orders. Do not invent fields
 * here: if the API changes, this file is updated against the real DTOs.
 *
 * Money (`unitPrice`, `total`) is a 2-decimal string on the wire and stays a
 * string here — see lib/money.ts. `deliveryDate` is a calendar day in
 * America/Lima as "AAAA-MM-DD", never a Date — see lib/business-date.ts.
 */
import type { ApiClient } from "./api-client";

/** Enum OrderStatus en Prisma. */
export type OrderStatus = "PENDING" | "ON_ROUTE" | "DELIVERED" | "FAILED" | "CANCELLED";

/** OrderCustomerDto: the minimum to recognise the customer without a second call. */
export interface OrderCustomer {
  id: string;
  name: string;
  phone: string;
}

/** OrderProductDto. */
export interface OrderProduct {
  id: string;
  name: string;
}

/** OrderItemResponseDto. */
export interface OrderItem {
  id: string;
  productId: string;
  product: OrderProduct;
  quantity: number;
  unitPrice: string;
}

/** OrderResponseDto. `createdAt` is an ISO instant once serialized. */
export interface Order {
  id: string;
  customerId: string;
  customer: OrderCustomer;
  deliveryDate: string;
  status: OrderStatus;
  createdById: string;
  createdAt: string;
  items: OrderItem[];
  total: string;
}

/** PaginatedOrdersDto. */
export interface PaginatedOrders {
  data: Order[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** ListOrdersQueryDto. */
export interface OrderListParams {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  customerId?: string;
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  /**
   * `false`: solo pedidos sin parada asignada. Omitido no filtra, que es lo
   * que la bandeja de pedidos necesita. El selector de paradas de una ruta lo
   * pide junto a `status: "PENDING"`: esas dos condiciones juntas son
   * exactamente las que `POST /routes/:id/stops` acepta.
   */
  hasRouteStop?: boolean;
}

/** Matches MAX_LIMIT in the API's list-orders-query.dto.ts. */
export const ORDERS_PAGE_SIZE = 20;

/** Matches MAX_ITEM_QUANTITY in the API's create-order.dto.ts. */
export const MAX_ITEM_QUANTITY = 100000;

/** CreateOrderItemDto. */
export interface CreateOrderItemBody {
  productId: string;
  quantity: number;
  unitPrice: string;
}

/** CreateOrderDto. `status` and `createdById` are absent: the API assigns both. */
export interface CreateOrderBody {
  customerId: string;
  deliveryDate: string;
  items: CreateOrderItemBody[];
}

function buildListQuery(params: OrderListParams): string {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.status) query.set("status", params.status);
  if (params.customerId) query.set("customerId", params.customerId);
  if (params.deliveryDateFrom) query.set("deliveryDateFrom", params.deliveryDateFrom);
  if (params.deliveryDateTo) query.set("deliveryDateTo", params.deliveryDateTo);
  // `!== undefined` y no truthiness: `false` es el valor que importa mandar.
  if (params.hasRouteStop !== undefined) {
    query.set("hasRouteStop", String(params.hasRouteStop));
  }
  return query.toString();
}

export function listOrders(
  apiClient: ApiClient,
  params: OrderListParams = {},
): Promise<PaginatedOrders> {
  const query = buildListQuery(params);
  return apiClient.request<PaginatedOrders>(`/orders${query ? `?${query}` : ""}`);
}

export function createOrder(apiClient: ApiClient, body: CreateOrderBody): Promise<Order> {
  return apiClient.request<Order>("/orders", { method: "POST", body });
}

export function getOrder(apiClient: ApiClient, id: string): Promise<Order> {
  return apiClient.request<Order>(`/orders/${id}`);
}

/** No body: the only transition this endpoint allows is PENDING -> CANCELLED. */
export function cancelOrder(apiClient: ApiClient, id: string): Promise<Order> {
  return apiClient.request<Order>(`/orders/${id}/cancel`, { method: "PATCH" });
}
