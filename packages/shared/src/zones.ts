/**
 * Contracts derived from apps/api/src/modules/zones.
 *
 * `deliveryDays` may be empty on purpose (see CreateZoneDto): forcing a choice
 * would make the office invent an answer that later looks like a real routing
 * fact. There is no DELETE: a zone is withdrawn with `active: false`.
 */

/** Prisma enum Weekday. */
export type Weekday =
  "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

/** ZoneResponseDto. */
export interface Zone {
  id: string;
  name: string;
  deliveryDays: Weekday[];
  active: boolean;
}

/**
 * ListZonesQueryDto. Unpaginated. With no `active`, the API returns only the
 * active ones: a withdrawn zone is never offered where a customer gets one.
 */
export interface ZoneListQuery {
  active?: boolean;
}

/** CreateZoneDto: born active; no `deliveryDays` is the same as empty. */
export interface CreateZoneBody {
  name: string;
  deliveryDays?: Weekday[];
}

/** UpdateZoneDto: every field optional; `deliveryDays` replaces the whole list. */
export interface UpdateZoneBody {
  name?: string;
  deliveryDays?: Weekday[];
  active?: boolean;
}
