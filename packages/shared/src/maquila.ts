/** Contracts for maquila module. */

export type MaquilaMovementType =
  "RECEIVED" | "FILLED" | "RETURNED" | "RECEIVED_VOID" | "FILLED_VOID" | "RETURNED_VOID";

export interface MaquilaPaymentInput {
  paymentMethodId: string;
  amount: string;
}

export interface ReceiveMaquilaBody {
  customerId: string;
  containerTypeId: string;
  quantity: number;
}

export interface FillMaquilaBody {
  customerId: string;
  containerTypeId: string;
  quantity: number;
}

export interface ReturnMaquilaBody {
  customerId: string;
  containerTypeId: string;
  quantity: number;
  locationId?: string;
  payment?: MaquilaPaymentInput;
}

export interface VoidMaquilaMovementBody {
  reason: string;
}

export interface MaquilaBalanceItem {
  customerId: string;
  containerTypeId: string;
  containerTypeName: string;
  emptyAtPlant: number;
  fullToReturn: number;
  unitPrice?: string | null;
  productId?: string | null;
}

export interface MaquilaCustomerSummary {
  customerId: string;
  customerName: string;
  emptyAtPlantTotal: number;
  fullToReturnTotal: number;
  balances: MaquilaBalanceItem[];
}

export interface MaquilaMovementItem {
  id: string;
  customerId: string;
  customerName: string;
  containerTypeId: string;
  containerTypeName: string;
  type: MaquilaMovementType;
  quantity: number;
  saleId?: string | null;
  saleTotal?: string | null;
  reversesMovementId: string | null;
  reason: string | null;
  recordedById: string;
  recordedByName: string;
  occurredAt: string;
  createdAt: string;
}

export interface PaginatedMaquilaMovements {
  data: MaquilaMovementItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MaquilaDiscrepancy {
  customerId: string;
  customerName: string;
  containerTypeId: string;
  containerTypeName: string;
  bookEmpty: number;
  bookFull: number;
  ledgerEmpty: number;
  ledgerFull: number;
}

export interface MaquilaReconciliationResult {
  isBalanced: boolean;
  discrepancies: MaquilaDiscrepancy[];
}
