/**
 * Contracts derived from apps/api/src/modules/customer-prices. `price` is a
 * 2-decimal string. No `locationId` in the write shapes: no endpoint lists a
 * customer's locations, so the field would ask for an id nobody can know.
 */

/** CustomerPriceResponseDto. `location` is null for a customer-wide price. */
export interface CustomerPrice {
  id: string;
  product: { id: string; name: string };
  location: { id: string; name: string } | null;
  price: string;
}

export interface CreateCustomerPriceBody {
  productId: string;
  price: string;
}

export interface UpdateCustomerPriceBody {
  price: string;
}

export type PriceSource = "LOCATION" | "CUSTOMER" | "LIST";

/** EffectivePriceResponseDto: what applies today and where it came from (ADMIN and SELLER). */
export interface EffectivePrice {
  product: { id: string; name: string };
  price: string;
  source: PriceSource;
}
