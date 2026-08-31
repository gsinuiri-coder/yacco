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

/**
 * RouteStopSaleDto: la venta VIGENTE de la parada. Llega en la respuesta de
 * marcarla o corregirla, y en el detalle de una ruta (`GET /routes/:id`);
 * nunca al listar rutas. Las ventas anuladas no vienen acá: esa historia es
 * del estado de cuenta del cliente y del libro de movimientos.
 */
export interface RouteStopSale {
  id: string;
  total: string;
  /**
   * La venta superó el límite de crédito del cliente. Se registra igual:
   * advierte, nunca bloquea.
   */
  creditLimitExceeded: boolean;
}

/** RouteStopPaymentDto: el cobro VIGENTE de la parada; null si no hay ninguno. */
export interface RouteStopPayment {
  id: string;
  status: PaymentStatus;
  amount: string;
}

/** RouteStopCorrectedByDto: quién corrigió la parada. */
export interface RouteStopCorrectedBy {
  id: string;
  name: string;
}

/**
 * RouteStopCorrectionDto: la corrección de la parada — cuándo, quién y por
 * qué. `null` mientras nunca se corrigió, y guarda SÓLO LA ÚLTIMA: la historia
 * completa vive en las ventas anuladas y en el libro de movimientos.
 *
 * Se pinta en la celda de Estado de la hoja de ruta (RouteDetailPage): el
 * badge "Corregida", quién la corrigió y cuándo, y el motivo si vino.
 */
export interface RouteStopCorrection {
  correctedAt: string;
  correctedBy: RouteStopCorrectedBy;
  correctionReason: string | null;
}

/**
 * RouteStopStockShortfallDto: un tipo de envase del que se registró más de lo
 * que el camión tenía. Solo puede venir de corregir una parada, que registra
 * contra un hecho físico ya consumado y por eso avisa en vez de bloquear.
 *
 * Declarado acá y todavía sin pintar: este archivo es el contrato y se
 * actualiza contra el DTO real, pero avisar el faltante todavía no tiene
 * pantalla — llega sólo en la respuesta de corregir una parada, y ese
 * formulario no existe.
 */
export interface RouteStopStockShortfall {
  containerTypeId: string;
  containerType: RouteStopContainerType;
  /** Lo que el libro decía que quedaba en el camión. */
  available: number;
  /** Lo que se registró como entregado. */
  requested: number;
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
 * RouteStopResponseDto. `sale` y `payment` vienen en la respuesta de
 * `PATCH .../stops/:stopId` y en el detalle de una ruta, nunca al listar
 * rutas. `containerBalances` y `stockShortfall` son exclusivos de la respuesta
 * de una escritura: los saldos son la parte cara y el faltante de stock es un
 * hecho del momento del registro, no un estado de la parada.
 *
 * `correction` viaja SIEMPRE, en las tres lecturas.
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
  correction: RouteStopCorrection | null;
  sale?: RouteStopSale | null;
  payment?: RouteStopPayment | null;
  containerBalances?: RouteStopContainerBalance[];
  stockShortfall?: RouteStopStockShortfall[];
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
