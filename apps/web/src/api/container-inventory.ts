/**
 * Contracts derived from apps/api/src/modules/container-movements. Do not
 * invent fields here: if the API changes, this file is updated against the
 * real DTOs (ContainerInventoryItemDto and the ContainerState enum in
 * Prisma).
 */
import type { ApiClient } from "./api-client";

/** Enum ContainerState en Prisma. */
export type ContainerState =
  "EMPTY_AT_PLANT" | "FULL_AT_PLANT" | "FULL_ON_ROUTE" | "EMPTY_ON_ROUTE" | "WITH_CUSTOMER";

/** ContainerMovementContainerTypeDto, reused as-is by the inventory endpoint. */
export interface ContainerInventoryContainerType {
  id: string;
  name: string;
}

/** ContainerInventoryItemDto: one (container type, state) cell of the ledger snapshot. */
export interface ContainerInventoryItem {
  containerTypeId: string;
  containerType: ContainerInventoryContainerType;
  state: ContainerState;
  quantity: number;
}

/**
 * Unpaginated flat rows, one per (container type, state) the ledger has
 * moved. `quantity` can be negative — that is a real signal (fleet entries
 * missing from the ledger), never clamped or hidden here.
 */
export function listContainerInventory(apiClient: ApiClient): Promise<ContainerInventoryItem[]> {
  return apiClient.request<ContainerInventoryItem[]>("/container-movements/inventory");
}
