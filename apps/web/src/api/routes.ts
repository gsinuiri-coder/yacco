/**
 * Contracts derived from apps/api/src/modules/routes. Do not invent fields
 * here: if the API changes, this file is updated against the real DTOs.
 *
 * `date` is a calendar day in America/Lima as "AAAA-MM-DD", never a Date —
 * see lib/business-date.ts. `createdAt` is the opposite: an instant.
 */
import type { ApiClient } from "./api-client";
import type { PaymentStatus } from "./payments";

/** Enum RouteStatus en Prisma. */
export type RouteStatus = "PLANNED" | "IN_PROGRESS" | "FINISHED" | "SETTLED";

/** Enum StopStatus en Prisma. */
export type StopStatus = "PENDING" | "DELIVERED" | "FAILED";

/** Enum StopOrigin en Prisma. */
export type StopOrigin = "ORDER" | "VAN_SALE";

/** RouteDriverDto. */
export interface RouteDriver {
  id: string;
  name: string;
}

/** RouteZoneDto. */
export interface RouteZone {
  id: string;
  name: string;
}

/** RouteStopCustomerDto: de quién es la ubicación de la parada. */
export interface RouteStopCustomer {
  id: string;
  name: string;
}

/** RouteStopLocationDto: lo mínimo para saber a quién y a dónde va el chofer. */
export interface RouteStopLocation {
  id: string;
  name: string;
  address: string;
  customer: RouteStopCustomer;
}

/** RouteStopSaleDto: solo llega en la respuesta de marcar una parada. */
export interface RouteStopSale {
  id: string;
  total: string;
  /**
   * La venta superó el límite de crédito del cliente. Se registra igual:
   * advierte, nunca bloquea.
   */
  creditLimitExceeded: boolean;
}

/** RouteStopPaymentDto: solo llega cuando el cuerpo trajo un cobro. */
export interface RouteStopPayment {
  id: string;
  status: PaymentStatus;
  amount: string;
}

/** RouteStopContainerBalanceDto: el saldo que le queda al cliente por tipo. */
export interface RouteStopContainerBalance {
  containerTypeId: string;
  containerType: RouteStopContainerType;
  quantity: number;
}

export interface RouteStopContainerType {
  id: string;
  name: string;
}

/**
 * RouteStopResponseDto. `sale`, `payment` y `containerBalances` solo vienen
 * en la respuesta de `PATCH .../stops/:stopId`, nunca al listar la ruta.
 */
export interface RouteStop {
  id: string;
  routeId: string;
  position: number;
  origin: StopOrigin;
  locationId: string;
  location: RouteStopLocation;
  orderId: string | null;
  status: StopStatus;
  failureReason: string | null;
  sale?: RouteStopSale | null;
  payment?: RouteStopPayment | null;
  containerBalances?: RouteStopContainerBalance[];
}

/** RouteResponseDto. Trae siempre sus paradas ordenadas por `position`. */
export interface Route {
  id: string;
  date: string;
  driverId: string;
  driver: RouteDriver;
  zoneId: string | null;
  zone: RouteZone | null;
  status: RouteStatus;
  createdById: string;
  createdAt: string;
  stops: RouteStop[];
}

/** PaginatedRoutesDto. */
export interface PaginatedRoutes {
  data: Route[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** ListRoutesQueryDto. */
export interface RouteListParams {
  page?: number;
  limit?: number;
  date?: string;
  driverId?: string;
  zoneId?: string;
  status?: RouteStatus;
}

/** Matches DEFAULT_LIMIT in the API's list-routes-query.dto.ts. */
export const ROUTES_PAGE_SIZE = 20;

/**
 * CreateRouteDto. `status` y `createdById` están ausentes a propósito: la
 * ruta nace PLANNED y el creador sale del token. `zoneId` es opcional — no
 * todo día de un chofer se acota a una sola zona.
 */
export interface CreateRouteBody {
  driverId: string;
  date: string;
  zoneId?: string;
}

function buildListQuery(params: RouteListParams): string {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.date) query.set("date", params.date);
  if (params.driverId) query.set("driverId", params.driverId);
  if (params.zoneId) query.set("zoneId", params.zoneId);
  if (params.status) query.set("status", params.status);
  return query.toString();
}

export function listRoutes(
  apiClient: ApiClient,
  params: RouteListParams = {},
): Promise<PaginatedRoutes> {
  const query = buildListQuery(params);
  return apiClient.request<PaginatedRoutes>(`/routes${query ? `?${query}` : ""}`);
}

export function getRoute(apiClient: ApiClient, id: string): Promise<Route> {
  return apiClient.request<Route>(`/routes/${id}`);
}

export function createRoute(apiClient: ApiClient, body: CreateRouteBody): Promise<Route> {
  return apiClient.request<Route>("/routes", { method: "POST", body });
}

/**
 * CreateRouteStopDto. `origin` decide cuál de los otros dos campos va: ORDER
 * lleva `orderId` y toma la ubicación del pedido; VAN_SALE lleva `locationId`
 * y nunca toca un pedido. Mandar los dos, o ninguno, lo rechaza la API con
 * 400 — la regla vive en RoutesService.addStop, no acá.
 */
export interface CreateRouteStopBody {
  origin: StopOrigin;
  orderId?: string;
  locationId?: string;
}

export function addRouteStop(
  apiClient: ApiClient,
  routeId: string,
  body: CreateRouteStopBody,
): Promise<RouteStop> {
  return apiClient.request<RouteStop>(`/routes/${routeId}/stops`, { method: "POST", body });
}

/** 204 sin cuerpo: la parada se quita y las posiciones se recompactan. */
export function removeRouteStop(
  apiClient: ApiClient,
  routeId: string,
  stopId: string,
): Promise<void> {
  return apiClient.request<void>(`/routes/${routeId}/stops/${stopId}`, { method: "DELETE" });
}

/**
 * ReorderRouteStopsDto: la lista COMPLETA de paradas en el orden nuevo, no un
 * parche parcial. La API rechaza una lista a la que le falte una parada, que
 * repita una, o que nombre una de otra ruta.
 */
export function reorderRouteStops(
  apiClient: ApiClient,
  routeId: string,
  stopIds: string[],
): Promise<Route> {
  return apiClient.request<Route>(`/routes/${routeId}/stops/reorder`, {
    method: "PATCH",
    body: { stopIds },
  });
}

/** Sin cuerpo: la única transición que permite es PLANNED -> IN_PROGRESS. */
export function startRoute(apiClient: ApiClient, routeId: string): Promise<Route> {
  return apiClient.request<Route>(`/routes/${routeId}/start`, { method: "PATCH" });
}

/** Sin cuerpo: la única transición que permite es IN_PROGRESS -> FINISHED. */
export function finishRoute(apiClient: ApiClient, routeId: string): Promise<Route> {
  return apiClient.request<Route>(`/routes/${routeId}/finish`, { method: "PATCH" });
}

/**
 * DeliverySaleItemDto. `unitPrice` es opcional a propósito: el camino normal
 * deja que la API resuelva el precio pactado. Solo va cuando se cobró algo
 * distinto, y entonces `priceOverrideAuthorizedById` es obligatorio.
 */
export interface DeliverySaleItemBody {
  productId: string;
  quantity: number;
  unitPrice?: string;
}

/** ContainerReturnDto: envases vacíos que devolvió el cliente, por tipo. */
export interface ContainerReturnBody {
  containerTypeId: string;
  quantity: number;
}

/** DeliveryPaymentDto: el cobro de esta parada, si lo hubo. */
export interface DeliveryPaymentBody {
  paymentMethodId: string;
  amount: string;
}

/**
 * MarkRouteStopDto. Solo los dos estados terminales: una parada nace PENDING
 * y nunca vuelve. `failureReason` va con FAILED; el resto, con DELIVERED.
 */
export interface MarkRouteStopBody {
  status: "DELIVERED" | "FAILED";
  failureReason?: string;
  items?: DeliverySaleItemBody[];
  containersReturned?: ContainerReturnBody[];
  payment?: DeliveryPaymentBody;
  priceOverrideAuthorizedById?: string;
}

export function markRouteStop(
  apiClient: ApiClient,
  routeId: string,
  stopId: string,
  body: MarkRouteStopBody,
): Promise<RouteStop> {
  return apiClient.request<RouteStop>(`/routes/${routeId}/stops/${stopId}`, {
    method: "PATCH",
    body,
  });
}

/** RouteLoadContainerTypeDto. */
export interface RouteLoadContainerType {
  id: string;
  name: string;
}

/** RouteLoadBatchDto. */
export interface RouteLoadBatch {
  id: string;
  code: string;
}

/** RouteLoadBatchItemDto: la línea de lote de la que salieron las unidades. */
export interface RouteLoadBatchItem {
  id: string;
  containerTypeId: string;
  containerType: RouteLoadContainerType;
  batchId: string;
  batch: RouteLoadBatch;
}

/** RouteLoadResponseDto. */
export interface RouteLoad {
  id: string;
  routeId: string;
  batchItemId: string;
  batchItem: RouteLoadBatchItem;
  quantity: number;
}

/**
 * CreateRouteLoadDto. `batchItemId` no se le pide al usuario: la pantalla lo
 * resuelve consumiendo los lotes del más antiguo al más nuevo (FIFO), que es
 * la regla del dominio.
 */
export interface CreateRouteLoadBody {
  batchItemId: string;
  quantity: number;
}

export function listRouteLoads(apiClient: ApiClient, routeId: string): Promise<RouteLoad[]> {
  return apiClient.request<RouteLoad[]>(`/routes/${routeId}/loads`);
}

export function addRouteLoad(
  apiClient: ApiClient,
  routeId: string,
  body: CreateRouteLoadBody,
): Promise<RouteLoad> {
  return apiClient.request<RouteLoad>(`/routes/${routeId}/loads`, { method: "POST", body });
}

/** 204 sin cuerpo. Solo con la ruta PLANNED: la API lo rechaza después. */
export function removeRouteLoad(
  apiClient: ApiClient,
  routeId: string,
  loadId: string,
): Promise<void> {
  return apiClient.request<void>(`/routes/${routeId}/loads/${loadId}`, { method: "DELETE" });
}
