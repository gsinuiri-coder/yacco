/**
 * Contracts derived from apps/api/src/modules/zones. Do not invent fields
 * here: if the API changes, this file is updated against the real DTOs.
 *
 * `deliveryDays` may be empty on purpose — see CreateZoneDto's own comment.
 * Forcing a choice here would make the office invent an answer just to get
 * past the form, and that invented answer would look like a real routing
 * fact later. There is no DELETE: withdrawing a zone is `active: false`
 * through `updateZone`, same reasoning as container-types.
 */
import type { ApiClient } from "./api-client";

/** Enum Weekday en Prisma. */
export type Weekday =
  "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

/** ZoneResponseDto. */
export interface Zone {
  id: string;
  name: string;
  deliveryDays: Weekday[];
  active: boolean;
}

/** ListZonesQueryDto. */
export interface ZoneListParams {
  active?: boolean;
}

/** CreateZoneDto: born active; `deliveryDays` omitted is the same as empty. */
export interface CreateZoneBody {
  name: string;
  deliveryDays?: Weekday[];
}

/** UpdateZoneDto: every field optional. `deliveryDays` replaces the whole list. */
export interface UpdateZoneBody {
  name?: string;
  deliveryDays?: Weekday[];
  active?: boolean;
}

/**
 * Unpaginated, mirroring listContainerTypes: a handful of rows managed by
 * hand. With no params, `active` defaults to true server-side — never offer
 * a withdrawn zone where the office is picking one for a customer; only the
 * catalog management screen asks for the withdrawn ones, explicitly.
 */
export function listZones(apiClient: ApiClient, params: ZoneListParams = {}): Promise<Zone[]> {
  const query = params.active === undefined ? "" : `?active=${String(params.active)}`;
  return apiClient.request<Zone[]>(`/zones${query}`);
}

export function createZone(apiClient: ApiClient, body: CreateZoneBody): Promise<Zone> {
  return apiClient.request<Zone>("/zones", { method: "POST", body });
}

export function updateZone(apiClient: ApiClient, id: string, body: UpdateZoneBody): Promise<Zone> {
  return apiClient.request<Zone>(`/zones/${id}`, { method: "PATCH", body });
}
