/**
 * Contracts derived from apps/api/src/modules/container-types. Do not
 * invent fields here: if the API changes, this file is updated against the
 * real DTOs.
 */
import type { ApiClient } from "./api-client";

/** ContainerTypeResponseDto. */
export interface ContainerType {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Unpaginated on purpose: the catalog is a handful of seeded rows
 * (ContainerTypesController doc comment), mirroring listProducts. No params
 * sent — `active` defaults to true server-side, which is exactly what a
 * production batch must have: never offer a withdrawn container type.
 */
export function listContainerTypes(apiClient: ApiClient): Promise<ContainerType[]> {
  return apiClient.request<ContainerType[]>("/container-types");
}
