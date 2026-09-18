/**
 * Contracts derived from apps/api/src/modules/container-counts. The count
 * book is append-only: there is no PATCH or DELETE route, and the front
 * offers none. A wrong count is corrected by counting again.
 */

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
