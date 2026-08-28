/**
 * Contracts derived from apps/api/src/modules/production-batches. Do not
 * invent fields here: if the API changes, this file is updated against the
 * real DTOs.
 *
 * `date` is a calendar day in America/Lima as "AAAA-MM-DD", never a Date —
 * see lib/business-date.ts.
 */
import type { ApiClient } from "./api-client";

/** ProductionBatchFilledByDto. */
export interface ProductionBatchFilledBy {
  id: string;
  name: string;
}

/** ProductionBatchContainerTypeDto. */
export interface ProductionBatchContainerType {
  id: string;
  name: string;
}

/** ProductionBatchItemResponseDto. */
export interface ProductionBatchItem {
  id: string;
  containerTypeId: string;
  containerType: ProductionBatchContainerType;
  producedQty: number;
  availableQty: number;
}

/** ProductionBatchResponseDto. */
export interface ProductionBatch {
  id: string;
  code: string;
  date: string;
  filledById: string;
  filledBy: ProductionBatchFilledBy;
  notes: string | null;
  items: ProductionBatchItem[];
}

/** PaginatedProductionBatchesDto. */
export interface PaginatedProductionBatches {
  data: ProductionBatch[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** ListProductionBatchesQueryDto. */
export interface ProductionBatchListParams {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  /**
   * `true`: solo lotes con alguna línea disponible. Omitido no filtra, que es
   * lo que la pantalla de producción necesita — es un historial. La carga de
   * ruta sí lo pide: el listado va de la fecha más antigua a la más nueva (el
   * orden FIFO de consumo), así que sin el filtro la primera página son los
   * lotes viejos que ya se consumieron enteros.
   */
  withStock?: boolean;
}

/** Matches DEFAULT_LIMIT in the API's list-production-batches-query.dto.ts. */
export const PRODUCTION_BATCHES_PAGE_SIZE = 20;

/** CreateProductionBatchItemDto. */
export interface CreateProductionBatchItemBody {
  containerTypeId: string;
  producedQty: number;
}

/** CreateProductionBatchDto. `filledById` is absent: the API assigns it from the token. */
export interface CreateProductionBatchBody {
  code: string;
  date: string;
  notes?: string;
  items: CreateProductionBatchItemBody[];
}

/**
 * ProductionBatchWarningDto: one container type's shortfall on this batch —
 * more was filled than the plant had empty. Deliberate, not a bug: the
 * batch still registers, this is only shown alongside the success.
 */
export interface ProductionBatchWarning {
  containerTypeId: string;
  containerType: ProductionBatchContainerType;
  emptyAvailable: number;
  produced: number;
}

/** CreateProductionBatchResponseDto. */
export interface CreateProductionBatchResponse extends ProductionBatch {
  warnings: ProductionBatchWarning[];
}

function buildListQuery(params: ProductionBatchListParams): string {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  // `!== undefined` y no truthiness: `false` también es un filtro real.
  if (params.withStock !== undefined) query.set("withStock", String(params.withStock));
  return query.toString();
}

export function listProductionBatches(
  apiClient: ApiClient,
  params: ProductionBatchListParams = {},
): Promise<PaginatedProductionBatches> {
  const query = buildListQuery(params);
  return apiClient.request<PaginatedProductionBatches>(
    `/production-batches${query ? `?${query}` : ""}`,
  );
}

export function createProductionBatch(
  apiClient: ApiClient,
  body: CreateProductionBatchBody,
): Promise<CreateProductionBatchResponse> {
  return apiClient.request<CreateProductionBatchResponse>("/production-batches", {
    method: "POST",
    body,
  });
}
