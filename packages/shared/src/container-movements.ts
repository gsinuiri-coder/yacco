/**
 * Contracts derived from apps/api/src/modules/container-movements.
 * `container_movements` is an immutable ledger: corrections are inverse
 * movements, never edits. `occurredAt` is an instant.
 */

/** Prisma enum ContainerState, in the order a container travels: plant, truck, customer. */
export const CONTAINER_STATE_VALUES = [
  "EMPTY_AT_PLANT",
  "FULL_AT_PLANT",
  "FULL_ON_ROUTE",
  "EMPTY_ON_ROUTE",
  "WITH_CUSTOMER",
] as const;

export type ContainerState = (typeof CONTAINER_STATE_VALUES)[number];

/**
 * Prisma enum ContainerMovementType — EVERY value, kept in step with the enum:
 * the history shows the whole ledger, including what other processes emit.
 */
export const CONTAINER_MOVEMENT_TYPE_VALUES = [
  "FLEET_ENTRY",
  "FILLING",
  "ROUTE_LOAD",
  "LOAN_DELIVERY",
  "EMPTY_PICKUP",
  "FULL_RETURN",
  "EMPTY_UNLOAD",
  "FULL_SALE",
  "DAMAGE_WRITE_OFF",
  "LOSS_WRITE_OFF",
  "OPENING_BALANCE",
  "COUNT_ADJUSTMENT",
  "LOAN_DELIVERY_VOID",
  "EMPTY_PICKUP_VOID",
  "FULL_SALE_VOID",
] as const;

export type ContainerMovementType = (typeof CONTAINER_MOVEMENT_TYPE_VALUES)[number];

/**
 * ContainerInventoryItemDto: one (container type, state) cell of the ledger
 * snapshot. `quantity` CAN be negative — a real signal (fleet entries missing
 * from the ledger), never clamped or hidden.
 */
export interface ContainerInventoryItem {
  containerTypeId: string;
  containerType: { id: string; name: string };
  state: ContainerState;
  quantity: number;
}

/** ContainerMovementResponseDto. `null` states are outside the fleet. */
export interface ContainerMovement {
  id: string;
  occurredAt: string;
  type: ContainerMovementType;
  containerTypeId: string;
  containerType: { id: string; name: string };
  quantity: number;
  fromState: ContainerState | null;
  toState: ContainerState | null;
  locationId: string | null;
  location: { id: string; name: string } | null;
  recordedById: string;
}

/** ListContainerMovementsQueryDto. */
export interface ContainerMovementListQuery {
  page?: number;
  limit?: number;
  type?: ContainerMovementType;
  containerTypeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const CONTAINER_MOVEMENTS_PAGE_SIZE = 20;

/** CreateContainerMovementDto. A state is OMITTED (never null) when it is outside the fleet. */
export interface CreateContainerMovementBody {
  type: ContainerMovementType;
  containerTypeId: string;
  quantity: number;
  fromState?: ContainerState;
  toState?: ContainerState;
  locationId?: string;
}
