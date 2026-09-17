/**
 * Small catalogs read from their own endpoints: container types, customer
 * locations and production batches. Derived from the real DTOs.
 */

/** ContainerTypeResponseDto. There is no DELETE: a type is withdrawn with `active: false`. */
export interface ContainerType {
  id: string;
  name: string;
  active: boolean;
}

/** ListContainerTypesQueryDto. With no `active`, only active types. */
export interface ContainerTypeListQuery {
  active?: boolean;
}

export interface CreateContainerTypeBody {
  name: string;
}

export interface UpdateContainerTypeBody {
  name?: string;
  active?: boolean;
}

/** CustomerLocationResponseDto. Listed active-only by default. */
export interface CustomerLocation {
  id: string;
  name: string;
  address: string;
  addressReference: string;
  phone: string;
  isPrimary: boolean;
  active: boolean;
}

interface Named {
  id: string;
  name: string;
}

/** ProductionBatchItemResponseDto. */
export interface ProductionBatchItem {
  id: string;
  containerTypeId: string;
  containerType: Named;
  producedQty: number;
  availableQty: number;
}

/** ProductionBatchResponseDto. `date` is a calendar day "AAAA-MM-DD". */
export interface ProductionBatch {
  id: string;
  code: string;
  date: string;
  filledById: string;
  filledBy: Named;
  notes: string | null;
  items: ProductionBatchItem[];
}

/**
 * ListProductionBatchesQueryDto. Listed oldest date first (then code): the
 * FIFO order. `withStock: true` keeps only batches with something available.
 */
export interface ProductionBatchListQuery {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  withStock?: boolean;
}

export const PRODUCTION_BATCHES_PAGE_SIZE = 20;

/** MAX_LIMIT of GET /production-batches. */
export const PRODUCTION_BATCHES_MAX_LIMIT = 100;

/** CreateProductionBatchDto. `filledById` comes from the token. */
export interface CreateProductionBatchBody {
  code: string;
  date: string;
  notes?: string;
  items: Array<{ containerTypeId: string; producedQty: number }>;
}

/** ProductionBatchWarningDto: more filled than empties available. The batch registers anyway. */
export interface ProductionBatchWarning {
  containerTypeId: string;
  containerType: Named;
  emptyAvailable: number;
  produced: number;
}

export interface CreateProductionBatchResponse extends ProductionBatch {
  warnings: ProductionBatchWarning[];
}
