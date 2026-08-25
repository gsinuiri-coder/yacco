/**
 * Contracts derived from apps/api/src/modules/container-counts. Do not
 * invent fields here: if the API changes, this file is updated against the
 * real DTOs.
 */
import type { ApiClient } from "./api-client";

/**
 * ContainerCountResponseDto. `expectedQuantity` is the balance the API
 * snapshotted at the moment of the count; `adjustmentId` is null when the
 * count matched it exactly.
 */
export interface ContainerCount {
  id: string;
  locationId: string;
  location: { id: string; name: string };
  containerTypeId: string;
  containerType: { id: string; name: string };
  countedAt: string;
  countedQuantity: number;
  expectedQuantity: number;
  adjustmentId: string | null;
  countedById: string;
}

/** CreateContainerCountDto. No `countedAt`: the API stamps now(). */
export interface CreateContainerCountBody {
  locationId: string;
  containerTypeId: string;
  countedQuantity: number;
}

/**
 * The count book is append-only: there is no PATCH or DELETE route, and the
 * web offers none. A wrong count is corrected by counting again.
 */
export function createContainerCount(
  apiClient: ApiClient,
  body: CreateContainerCountBody,
): Promise<ContainerCount> {
  return apiClient.request<ContainerCount>("/container-counts", { method: "POST", body });
}
