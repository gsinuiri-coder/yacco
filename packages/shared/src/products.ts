/** Contracts derived from apps/api/src/modules/products. `listPrice` is a 2-decimal string. */

/** Prisma enum ProductType. */
export type ProductType = "REFILL" | "CONTAINER_SALE" | "ACCESSORY";

/** ProductResponseDto. */
export interface Product {
  id: string;
  name: string;
  type: ProductType;
  containerType: { id: string; name: string } | null;
  listPrice: string;
  active: boolean;
}

/** ProductPriceChangeResponseDto. Every monetary value is a 2-decimal string. */
export interface ProductPriceChange {
  id: string;
  previousPrice: string | null;
  newPrice: string;
  changedAt: string;
  changedBy: { id: string; name: string };
}
