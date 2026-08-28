/**
 * Contracts derived from apps/api/src/modules/routes. Do not invent fields
 * here: if the API changes, this file is updated against the real DTOs.
 *
 * `date` is a calendar day in America/Lima as "AAAA-MM-DD", never a Date —
 * see lib/business-date.ts. `createdAt` is the opposite: an instant.
 */
import type { ApiClient } from "./api-client";

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

/** RouteStopResponseDto. */
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
