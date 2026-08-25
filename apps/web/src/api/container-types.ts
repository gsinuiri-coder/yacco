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

/** ListContainerTypesQueryDto. */
export interface ContainerTypeListParams {
  active?: boolean;
}

/** CreateContainerTypeDto: a type is exactly a name, born active. */
export interface CreateContainerTypeBody {
  name: string;
}

/**
 * UpdateContainerTypeDto. `active: false` withdraws the type; there is no
 * DELETE route on purpose (every historical movement must keep resolving
 * its type), so the UI never offers one either.
 */
export interface UpdateContainerTypeBody {
  name?: string;
  active?: boolean;
}

/**
 * Unpaginated on purpose: the catalog is a handful of rows managed by hand
 * (ContainerTypesController doc comment), mirroring listProducts. With no
 * params, `active` defaults to true server-side, which is exactly what a
 * production batch or a movement form must have: never offer a withdrawn
 * container type. Only the catalog management screen asks for the
 * withdrawn ones, explicitly.
 */
export function listContainerTypes(
  apiClient: ApiClient,
  params: ContainerTypeListParams = {},
): Promise<ContainerType[]> {
  const query = params.active === undefined ? "" : `?active=${String(params.active)}`;
  return apiClient.request<ContainerType[]>(`/container-types${query}`);
}

export function createContainerType(
  apiClient: ApiClient,
  body: CreateContainerTypeBody,
): Promise<ContainerType> {
  return apiClient.request<ContainerType>("/container-types", { method: "POST", body });
}

export function updateContainerType(
  apiClient: ApiClient,
  id: string,
  body: UpdateContainerTypeBody,
): Promise<ContainerType> {
  return apiClient.request<ContainerType>(`/container-types/${id}`, { method: "PATCH", body });
}
