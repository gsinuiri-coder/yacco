/** Contratos de GET /sales. Los montos son strings exactos de dos decimales. */
export type SaleOrigin = "ROUTE" | "OFFICE" | "MAQUILA" | "ACCESSORY";

export interface SaleListItem {
  id: string;
  soldAt: string;
  total: string;
  customer: { id: string; name: string };
  location: { id: string; name: string };
  items: Array<{ product: { id: string; name: string }; quantity: number }>;
  origin: SaleOrigin;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface PaginatedSales {
  data: SaleListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  totalAmount: string;
}

export const SALES_PAGE_SIZE = 20;
