/**
 * Contracts derived from apps/api/src/modules/products. Do not invent fields
 * here: if the API changes, this file is updated against the real DTOs.
 *
 * `listPrice` is a 2-decimal string on the wire and stays a string here —
 * see lib/money.ts.
 */
import type { ApiClient } from "./api-client";

/** Enum ProductType en Prisma. */
export type ProductType = "REFILL" | "CONTAINER_SALE";

/** ProductContainerTypeDto. */
export interface ProductContainerType {
  id: string;
  name: string;
}

/** ProductResponseDto. */
export interface Product {
  id: string;
  name: string;
  type: ProductType;
  containerType: ProductContainerType;
  listPrice: string;
  active: boolean;
}

/**
 * Unpaginated on purpose: the catalog is a handful of seeded rows (ProductsController
 * doc comment). No params sent — `active` defaults to true server-side, which is
 * exactly what order creation needs: never offer a withdrawn product.
 */
export function listProducts(apiClient: ApiClient): Promise<Product[]> {
  return apiClient.request<Product[]>("/products");
}
