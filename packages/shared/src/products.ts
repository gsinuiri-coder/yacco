/** Contracts derived from apps/api/src/modules/products. `listPrice` is a 2-decimal string. */

/** Prisma enum ProductType. */
export type ProductType = "REFILL" | "CONTAINER_SALE";

/** ProductResponseDto. */
export interface Product {
  id: string;
  name: string;
  type: ProductType;
  containerType: { id: string; name: string };
  listPrice: string;
  active: boolean;
}
