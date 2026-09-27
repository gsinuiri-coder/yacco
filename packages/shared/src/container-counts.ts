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

/** Los dos estados de la planta que se cuentan a mano. */
export const PLANT_COUNT_STATE_VALUES = ["EMPTY_AT_PLANT", "FULL_AT_PLANT"] as const;
export type PlantCountState = (typeof PLANT_COUNT_STATE_VALUES)[number];

/** CreatePlantCountDto (`POST /container-counts/plant`, solo ADMIN). */
export interface CreatePlantCountBody {
  containerTypeId: string;
  state: PlantCountState;
  countedQuantity: number;
}

/**
 * PlantCountResponseDto. Sin fila en `container_counts`: el conteo de la
 * planta deja solo sus ajustes en el libro. `adjustments` está vacío cuando
 * lo contado coincidió; con llenos de menos trae un ajuste por lote, del más
 * viejo al más nuevo.
 */
export interface PlantCount {
  containerType: { id: string; name: string };
  state: PlantCountState;
  expectedQuantity: number;
  countedQuantity: number;
  adjustments: {
    id: string;
    quantity: number;
    batch: { id: string; code: string } | null;
  }[];
}
