/**
 * Contracts derived from apps/api/src/modules/container-movements. Do not
 * invent fields here: if the API changes, this file is updated against the
 * real DTOs.
 *
 * `occurredAt` is an ISO instant once serialized — see lib/business-date.ts's
 * `formatBusinessDateTime`, never `deliveryDate`'s calendar-day handling.
 */
import type { ContainerState } from "./container-inventory";
import type { ApiClient } from "./api-client";

/** Enum ContainerMovementType en Prisma — every value, not just the three this
 * screen can register: the history/filter also shows movements other
 * processes emit (production's FILLING, the route app's future entries).
 *
 * "Every value" used to be a claim, not a fact: OPENING_BALANCE and
 * COUNT_ADJUSTMENT existed in the Prisma enum and were missing here, so
 * `Record<ContainerMovementType, string>` in container-movement-labels.ts
 * looked exhaustive while those two rows rendered with an empty label in the
 * history. Completing the union is the real fix — with it, the compiler
 * catches the next omission instead of the screen swallowing it. Keep it in
 * step with the enum. */
export type ContainerMovementType =
  | "FLEET_ENTRY"
  | "FILLING"
  | "ROUTE_LOAD"
  | "LOAN_DELIVERY"
  | "EMPTY_PICKUP"
  | "FULL_RETURN"
  | "EMPTY_UNLOAD"
  | "FULL_SALE"
  | "DAMAGE_WRITE_OFF"
  | "LOSS_WRITE_OFF"
  | "OPENING_BALANCE"
  | "COUNT_ADJUSTMENT";

/** ContainerMovementContainerTypeDto. */
export interface ContainerMovementContainerType {
  id: string;
  name: string;
}

/** ContainerMovementLocationDto. */
export interface ContainerMovementLocation {
  id: string;
  name: string;
}

/** ContainerMovementResponseDto. */
export interface ContainerMovement {
  id: string;
  occurredAt: string;
  type: ContainerMovementType;
  containerTypeId: string;
  containerType: ContainerMovementContainerType;
  quantity: number;
  fromState: ContainerState | null;
  toState: ContainerState | null;
  locationId: string | null;
  location: ContainerMovementLocation | null;
  recordedById: string;
}

/** PaginatedContainerMovementsDto. */
export interface PaginatedContainerMovements {
  data: ContainerMovement[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** ListContainerMovementsQueryDto. */
export interface ContainerMovementListParams {
  page?: number;
  limit?: number;
  type?: ContainerMovementType;
  containerTypeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Matches DEFAULT_LIMIT in the API's list-container-movements-query.dto.ts. */
export const CONTAINER_MOVEMENTS_PAGE_SIZE = 20;

/**
 * CreateContainerMovementDto. No `notes`: the DTO does not have one in this
 * phase. `fromState`/`toState` are omitted (never sent as JSON `null`) when
 * the movement crosses the fleet's boundary on that side.
 */
export interface CreateContainerMovementBody {
  type: ContainerMovementType;
  containerTypeId: string;
  quantity: number;
  fromState?: ContainerState;
  toState?: ContainerState;
  locationId?: string;
}

function buildListQuery(params: ContainerMovementListParams): string {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.type) query.set("type", params.type);
  if (params.containerTypeId) query.set("containerTypeId", params.containerTypeId);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  return query.toString();
}

export function listContainerMovements(
  apiClient: ApiClient,
  params: ContainerMovementListParams = {},
): Promise<PaginatedContainerMovements> {
  const query = buildListQuery(params);
  return apiClient.request<PaginatedContainerMovements>(
    `/container-movements${query ? `?${query}` : ""}`,
  );
}

export function createContainerMovement(
  apiClient: ApiClient,
  body: CreateContainerMovementBody,
): Promise<ContainerMovement> {
  return apiClient.request<ContainerMovement>("/container-movements", { method: "POST", body });
}
